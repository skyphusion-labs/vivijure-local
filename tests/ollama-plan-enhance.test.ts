import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callOllama,
  DEFAULT_OLLAMA_PLAN_MODEL,
  ensureOllamaUnloadedForGpu,
  isOllamaModelId,
  OLLAMA_CHAT_TEMPERATURE,
  OLLAMA_STRUCTURED_TEMPERATURE,
  ollamaPlanModel,
  stripThinkingContent,
  unloadOllamaModel,
} from "../src/modules/chain/ollama.js";
import {
  augmentSystemForOllama,
  OLLAMA_CHAT_SYSTEM_DEFAULT,
  OLLAMA_STRUCTURED_PREAMBLE,
} from "../src/modules/chain/ollama-prompts.js";
import { buildMessages, parseEnhanced, parsePlanStoryboard } from "../src/modules/chain/plan-enhance-core.js";
import { pickProvider } from "../src/modules/chain/plan-enhance-provider.js";
import { unloadOllamaBeforeRender } from "../src/ollama-handoff.js";
import { invokeLocalGpu, invokeLocalKeyframe } from "../src/modules/local-gpu/handlers.js";

describe("ollama plan.enhance helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to qwen3:14b for the 16GB homelab planner", () => {
    expect(DEFAULT_OLLAMA_PLAN_MODEL).toBe("qwen3:14b");
    expect(ollamaPlanModel({})).toBe(DEFAULT_OLLAMA_PLAN_MODEL);
    expect(ollamaPlanModel({}, "ollama/deepseek-r1:14b")).toBe("deepseek-r1:14b");
  });

  it("recognizes ollama catalog ids", () => {
    expect(isOllamaModelId("ollama/qwen3:14b")).toBe(true);
    expect(isOllamaModelId("qwen3:14b")).toBe(true);
    expect(isOllamaModelId("deepseek-r1:14b")).toBe(true);
    expect(isOllamaModelId("anthropic/claude-opus-4-8")).toBe(false);
    expect(isOllamaModelId("plan-enhance")).toBe(false);
  });

  it("strips residual thinking chrome before structured use", () => {
    expect(stripThinkingContent("<think>scratch</think>\n[\"a\"]")).toBe('["a"]');
    expect(parseEnhanced('<think>x</think>\n["shot one directed", "shot two"]', 2)).toEqual([
      "shot one directed",
      "shot two",
    ]);
    expect(
      parsePlanStoryboard('<think>plan</think>\n{"scenes":[{"prompt":"dock at dawn"}]}'),
    ).toEqual({ scenes: [{ prompt: "dock at dawn" }] });
  });

  it("calls /api/chat with think:false, structured temperature, and unloads via keep_alive 0", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/chat")) {
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("qwen3:14b");
        expect(body.think).toBe(false);
        expect(body.options?.temperature).toBe(OLLAMA_STRUCTURED_TEMPERATURE);
        expect(body.options?.num_ctx).toBe(8192);
        return new Response(JSON.stringify({ message: { content: '["a directed"]' } }), {
          status: 200,
        });
      }
      if (url.endsWith("/api/generate")) {
        expect(JSON.parse(String(init?.body)).keep_alive).toBe(0);
        return new Response("{}", { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = { OLLAMA_BASE_URL: "http://ollama:11434" };
    expect(pickProvider(env)).toBe("ollama");
    await expect(callOllama(env, [{ role: "user", content: "hi" }])).resolves.toBe('["a directed"]');
    await unloadOllamaModel(env);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors think:true and creative temperature for chat/ideation", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.think).toBe(true);
      expect(body.options?.temperature).toBe(OLLAMA_CHAT_TEMPERATURE);
      return new Response(JSON.stringify({ message: { content: "harbor short" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      callOllama({ OLLAMA_BASE_URL: "http://ollama:11434" }, [{ role: "user", content: "idea" }], undefined, {
        think: true,
      }),
    ).resolves.toBe("harbor short");
  });

  it("hints to run ollama-pull when the model is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"model not found"}', { status: 404 })),
    );
    await expect(
      callOllama({ OLLAMA_BASE_URL: "http://ollama:11434" }, [{ role: "user", content: "hi" }]),
    ).rejects.toThrow(/ollama-pull/);
  });

  it("augments Ollama systems toward filmable creative direction", () => {
    expect(augmentSystemForOllama(undefined, "chat")).toBe(OLLAMA_CHAT_SYSTEM_DEFAULT);
    expect(augmentSystemForOllama("schema rules", "plan")).toContain(OLLAMA_STRUCTURED_PREAMBLE);
    expect(augmentSystemForOllama("schema rules", "plan")).toContain("schema rules");
    const enhance = buildMessages(["dock at dawn"], "medium");
    expect(enhance[0]?.content).toMatch(/keyframe|filmable|SDXL/i);
  });
});

describe("sequential VRAM handoff (local#265 / local#325)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ensureOllamaUnloadedForGpu POSTs keep_alive:0 and returns status:unloaded", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      ensureOllamaUnloadedForGpu({ OLLAMA_BASE_URL: "http://ollama:11434", OLLAMA_PLAN_MODEL: "qwen3:14b" }),
    ).resolves.toEqual({ status: "unloaded", model: "qwen3:14b" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string | URL, RequestInit?];
    expect(String(call[0])).toBe("http://ollama:11434/api/generate");
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({
      model: "qwen3:14b",
      keep_alive: 0,
    });
  });

  it("DISCRIMINATES: not-configured is skipped, not failed (local#325)", async () => {
    // Pre-#325 both paths returned false; a monitor could not tell them apart.
    await expect(ensureOllamaUnloadedForGpu({})).resolves.toEqual({
      status: "skipped",
      reason: "not-configured",
    });
  });

  it("DISCRIMINATES: unload throw is status:failed with error (local#325)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const r = await ensureOllamaUnloadedForGpu({
      OLLAMA_BASE_URL: "http://ollama:11434",
      OLLAMA_PLAN_MODEL: "qwen3:14b",
    });
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.model).toBe("qwen3:14b");
      expect(r.error).toMatch(/ECONNREFUSED/);
    }
  });

  it("fail-open: failed unload does not throw (render continues)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    await expect(
      ensureOllamaUnloadedForGpu({ OLLAMA_BASE_URL: "http://ollama:11434" }),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("failed unload emits a monitorable ollama_unload warn (local#325)", async () => {
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await ensureOllamaUnloadedForGpu({ OLLAMA_BASE_URL: "http://ollama:11434" });
    const parsed = warns
      .map((w) => {
        try {
          return JSON.parse(w) as { event?: string; status?: string };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    expect(parsed.some((p) => p?.event === "ollama_unload" && p?.status === "failed")).toBe(true);
  });

  it("unloadOllamaBeforeRender returns the structured result (not void)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      unloadOllamaBeforeRender({ OLLAMA_BASE_URL: "http://ollama:11434", OLLAMA_PLAN_MODEL: "qwen3:14b" }),
    ).resolves.toEqual({ status: "unloaded", model: "qwen3:14b" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(unloadOllamaBeforeRender({})).resolves.toEqual({
      status: "skipped",
      reason: "not-configured",
    });
  });

  it("local-gpu keyframe and motion unload Ollama before door /run", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/api/generate")) return new Response("{}", { status: 200 });
        if (url.endsWith("/run")) return new Response(JSON.stringify({ id: "a".repeat(32) }), { status: 200 });
        return new Response("nope", { status: 404 });
      }),
    );

    const env = {
      LOCAL_BACKEND_URL: "http://door:8000",
      OLLAMA_BASE_URL: "http://ollama:11434",
      OLLAMA_PLAN_MODEL: "qwen3:14b",
    };

    await invokeLocalKeyframe(env, {
      hook: "keyframe",
      input: { project: "film", bundle_key: "bundles/film.tar.gz", shot_ids: ["shot_01"] },
      config: {},
      context: { project: "film", job_id: "j1" },
    });
    expect(calls[0]).toBe("http://ollama:11434/api/generate");
    expect(calls.some((u) => u.endsWith("/run"))).toBe(true);

    calls.length = 0;
    await invokeLocalGpu(env, {
      hook: "motion.backend",
      input: {
        shot_id: "shot_01",
        prompt: "push in",
        keyframe_url: "https://example.test/kf.png",
        seconds: 5,
      },
      config: {},
      context: { project: "film", job_id: "j2" },
    });
    expect(calls[0]).toBe("http://ollama:11434/api/generate");
    expect(calls.some((u) => u.endsWith("/run"))).toBe(true);
  });
});
