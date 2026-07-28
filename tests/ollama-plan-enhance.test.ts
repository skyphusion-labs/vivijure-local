import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callOllama,
  DEFAULT_OLLAMA_PLAN_MODEL,
  isOllamaModelId,
  ollamaPlanModel,
  unloadOllamaModel,
} from "../src/modules/chain/ollama.js";
import { pickProvider } from "../src/modules/chain/plan-enhance-provider.js";

describe("ollama plan.enhance helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults the open-weight planner model", () => {
    expect(ollamaPlanModel({})).toBe(DEFAULT_OLLAMA_PLAN_MODEL);
    expect(ollamaPlanModel({}, "ollama/qwen2.5:32b")).toBe("qwen2.5:32b");
  });

  it("recognizes ollama catalog ids", () => {
    expect(isOllamaModelId("ollama/qwen2.5:14b")).toBe(true);
    expect(isOllamaModelId("qwen2.5:14b")).toBe(true);
    expect(isOllamaModelId("anthropic/claude-opus-4-8")).toBe(false);
    expect(isOllamaModelId("plan-enhance")).toBe(false);
  });

  it("calls /api/chat and unloads via keep_alive 0", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/chat")) {
        expect(JSON.parse(String(init?.body)).model).toBe("qwen2.5:14b");
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
});
