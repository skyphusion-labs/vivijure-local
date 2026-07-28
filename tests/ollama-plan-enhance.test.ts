import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callOllama,
  DEFAULT_OLLAMA_PLAN_MODEL,
  ensureOllamaUnloadedForGpu,
  isOllamaModelId,
  ollamaPlanModel,
  stripThinkingContent,
  unloadOllamaModel,
} from "../src/modules/chain/ollama.js";
import { parseEnhanced, parsePlanStoryboard } from "../src/modules/chain/plan-enhance-core.js";
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

  it("calls /api/chat with think:false and unloads via keep_alive 0", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/chat")) {
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("qwen3:14b");
        expect(body.think).toBe(false);
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

  it("honors think:true for chat/ideation", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.think).toBe(true);
      return new Response(JSON.stringify({ message: { content: "harbor short" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      callOllama({ OLLAMA_BASE_URL: "http://ollama:11434" }, [{ role: "user", content: "idea" }], undefined, {
        think: true,
      }),
    ).resolves.toBe("harbor short");
  });
});

describe("sequential VRAM handoff (local#265)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ensureOllamaUnloadedForGpu POSTs keep_alive:0 and fail-opens when Ollama is down", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      ensureOllamaUnloadedForGpu({ OLLAMA_BASE_URL: "http://ollama:11434", OLLAMA_PLAN_MODEL: "qwen3:14b" }),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string | URL, RequestInit?];
    expect(String(call[0])).toBe("http://ollama:11434/api/generate");
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({
      model: "qwen3:14b",
      keep_alive: 0,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(ensureOllamaUnloadedForGpu({ OLLAMA_BASE_URL: "http://ollama:11434" })).resolves.toBe(
      false,
    );
    await expect(ensureOllamaUnloadedForGpu({})).resolves.toBe(false);
  });

  it("unloadOllamaBeforeRender is the studio alias for the same helper", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await unloadOllamaBeforeRender({ OLLAMA_BASE_URL: "http://ollama:11434" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
