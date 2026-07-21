import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import type { FetcherLike, ModuleTransport, Platform } from "../src/platform/types.js";
import { MODULE_API } from "@skyphusion-labs/vivijure-core/modules/types";
import { _resetModuleDiscoveryCache } from "@skyphusion-labs/vivijure-core";
import {
  projectWanLorasIntoModuleConfig,
  shouldProjectWanLoras,
  ensureModuleOverrideConfig,
  WAN_LORA_BACKEND,
  WAN_LORA_DEFAULT_SCALE,
  WAN_LORA_PRESIGN_TTL_SECONDS,
  MAX_LORAS_PER_PASS,
} from "../src/wan-lora-projection.js";
import type { OrchestratorEnv } from "@skyphusion-labs/vivijure-core/platform";
import { orch } from "./orchestrator-env.js";

vi.mock("@skyphusion-labs/vivijure-core/presign", async (orig) => {
  const actual = await orig<typeof import("@skyphusion-labs/vivijure-core/presign")>();
  return {
    ...actual,
    presignR2Get: vi.fn(async (_env: unknown, key: string, ttl?: number) =>
      `https://presign.test/${key}?sig=X&ttl=${ttl}`,
    ),
  };
});

const WAN_HIGH = "loras/cast-5/1700000000.high.safetensors";
const WAN_LOW = "loras/cast-5/1700000000.low.safetensors";
const SDXL_KEY = "loras/cast-9/1700000000.safetensors";

function castResult(marker: unknown) {
  if (marker === "wan") {
    return {
      pretrained: {},
      wanPretrained: { A: { high: WAN_HIGH, low: WAN_LOW } },
      voices: {},
      castIds: { A: 5 },
      skipped: [],
      skippedDetail: [],
    };
  }
  if (marker === "sdxl") {
    return {
      pretrained: { A: SDXL_KEY },
      wanPretrained: {},
      voices: {},
      castIds: { A: 9 },
      skipped: [],
      skippedDetail: [],
    };
  }
  return { pretrained: {}, wanPretrained: {}, voices: {}, castIds: {}, skipped: [], skippedDetail: [] };
}

vi.mock("@skyphusion-labs/vivijure-core/cast-loras", async (orig) => {
  const actual = await orig<typeof import("@skyphusion-labs/vivijure-core/cast-loras")>();
  return {
    ...actual,
    resolveCastLoras: vi.fn(async (_env: unknown, castLoras: Record<string, unknown> | undefined) =>
      castResult(castLoras?.A),
    ),
  };
});

const cap = vi.hoisted(() => ({
  film: [] as Array<Record<string, unknown>>,
  scatter: [] as Array<Record<string, unknown>>,
  wanTrainId: null as number | null,
}));

vi.mock("@skyphusion-labs/vivijure-core/film-orchestrator", async (orig) => {
  const actual = await orig<typeof import("@skyphusion-labs/vivijure-core/film-orchestrator")>();
  return {
    ...actual,
    startFilmJob: vi.fn(async (_env: unknown, args: Record<string, unknown>) => {
      cap.film.push(args);
      return { film_id: "film-wan-test", phase: "keyframe", scenes: args.scenes, project: "p", created_at: 0 };
    }),
  };
});

vi.mock("@skyphusion-labs/vivijure-core/scatter-orchestrator", async (orig) => {
  const actual = await orig<typeof import("@skyphusion-labs/vivijure-core/scatter-orchestrator")>();
  return {
    ...actual,
    startScatterRender: vi.fn(async (_env: unknown, args: Record<string, unknown>) => {
      cap.scatter.push(args);
      return { scatter_id: "scatter-wan-test", phase: "shards" };
    }),
    scatterJobToPollView: vi.fn(() => ({ jobId: "scatter-wan-test", status: "in_progress" })),
  };
});

vi.mock("@skyphusion-labs/vivijure-core/bundle-storyboard", async (orig) => {
  const actual = await orig<typeof import("@skyphusion-labs/vivijure-core/bundle-storyboard")>();
  return { ...actual, readBundleScenes: vi.fn(async () => []) };
});

vi.mock("@skyphusion-labs/vivijure-core/renders-db", async (orig) => {
  const actual = await orig<typeof import("@skyphusion-labs/vivijure-core/renders-db")>();
  return { ...actual, insertRender: vi.fn(async () => {}) };
});

vi.mock("@skyphusion-labs/vivijure-core/cast-lora-train", async (orig) => {
  const actual = await orig<typeof import("@skyphusion-labs/vivijure-core/cast-lora-train")>();
  return {
    ...actual,
    handleCastTrainWanLora: vi.fn(async (_req: unknown, _env: unknown, id: number) =>
      Response.json({ ok: true, via: "wan-train-handler" }, { status: 202 }),
    ),
  };
});

vi.mock("@skyphusion-labs/vivijure-core/cast-db", async (orig) => {
  const actual = await orig<typeof import("@skyphusion-labs/vivijure-core/cast-db")>();
  return { ...actual, getCastIdByPublicId: vi.fn(async () => 5) };
});

const SECRET = "a".repeat(32) + "b".repeat(32);
const SCENES = [{ shot_id: "shot_01", prompt: "a shot", seconds: 4 }];
const WAN_LORA_SCHEMA = {
  high_noise_loras: { type: "string", default: "[]", label: "high" },
  low_noise_loras: { type: "string", default: "[]", label: "low" },
  seed: { type: "int", default: -1, min: -1, label: "seed" },
};

let dir: string;

function wanModuleTransport(): ModuleTransport {
  return {
    listBindings: () => ["MODULE_KEYFRAME", "MODULE_ALIBABA_WAN_LORA"],
    resolve: (name: string) => {
      const manifest =
        name === "MODULE_KEYFRAME"
          ? { name: "cloud-keyframe", version: "0.1.0", api: MODULE_API, hooks: ["keyframe"] }
          : {
              name: "alibaba-wan-lora",
              version: "0.1.1",
              api: MODULE_API,
              hooks: ["motion.backend"],
              config_schema: WAN_LORA_SCHEMA,
              ui: { order: 75, locality: "cloud" },
            };
      return {
        fetch: async () =>
          new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } }),
      } satisfies FetcherLike;
    },
  };
}

function makePlatform(): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-wan-proj-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}),
    modules: wanModuleTransport(),
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
  };
}

async function authJson(app: ReturnType<typeof createApp>, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const anyEnv = orch({}) as OrchestratorEnv;

beforeEach(() => {
  cap.film = [];
  cap.scatter = [];
  cap.wanTrainId = null;
  _resetModuleDiscoveryCache();
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function parseLoras(v: unknown): Array<{ path: string; scale: number }> {
  return JSON.parse(String(v)) as Array<{ path: string; scale: number }>;
}

describe("projectWanLorasIntoModuleConfig", () => {
  it("presigns Wan experts at scale 1.5", async () => {
    const cfg: Record<string, unknown> = { high_noise_loras: "[]", low_noise_loras: "[]" };
    const r = await projectWanLorasIntoModuleConfig(anyEnv, WAN_LORA_BACKEND, { A: { high: WAN_HIGH, low: WAN_LOW } }, cfg);
    expect(r.applied).toBe(true);
    expect(parseLoras(cfg.high_noise_loras)[0].scale).toBe(WAN_LORA_DEFAULT_SCALE);
  });
});

describe("cross-wire control at ALL THREE render paths", () => {
  it("RENDER: Wan cast projects high/low_noise_loras only", async () => {
    const app = createApp(testSettingsHost(makePlatform()));
    const res = await authJson(app, "/api/storyboard/render", {
      bundleKey: "bundles/x.tar.gz",
      scenes: SCENES,
      motion_backend: WAN_LORA_BACKEND,
      castLoras: { A: "wan" },
    });
    expect(res.status).toBe(201);
    const args = cap.film[0];
    const mc = args.motion_config as Record<string, unknown>;
    expect(parseLoras(mc.high_noise_loras)[0].path).toContain(WAN_HIGH);
    expect(args.pretrained_loras).toBeUndefined();
  });

  it("FILM: SDXL cast projects pretrained_loras only", async () => {
    const app = createApp(testSettingsHost(makePlatform()));
    const res = await authJson(app, "/api/render/film", {
      bundle_key: "bundles/x.tar.gz",
      scenes: SCENES,
      motion_backend: WAN_LORA_BACKEND,
      cast_loras: { A: "sdxl" },
    });
    expect(res.status).toBe(201);
    expect(cap.film[0].pretrained_loras).toEqual({ A: SDXL_KEY });
  });

  it("SCATTER: Wan cast injects render_overrides.config", async () => {
    const app = createApp(testSettingsHost(makePlatform()));
    const res = await authJson(app, "/api/storyboard/render/scatter", {
      bundleKey: "bundles/x.tar.gz",
      shotIds: ["shot_01", "shot_02"],
      motion_backend: WAN_LORA_BACKEND,
      castLoras: { A: "wan" },
    });
    expect(res.status).toBe(201);
    const ro = cap.scatter[0].render_overrides as { config?: Record<string, Record<string, unknown>> };
    expect(parseLoras(ro.config?.[WAN_LORA_BACKEND]?.high_noise_loras)[0].path).toContain(WAN_HIGH);
  });
});

describe("POST /api/cast/:id/train-wan-lora route", () => {
  const PUBLIC_ID = "12345678-1234-4123-8123-1234567890ab";
  it("dispatches to handleCastTrainWanLora", async () => {
    const { handleCastTrainWanLora } = await import("@skyphusion-labs/vivijure-core/cast-lora-train");
    const app = createApp(testSettingsHost(makePlatform()));
    const res = await authJson(app, `/api/cast/${PUBLIC_ID}/train-wan-lora`, {});
    expect(res.status).toBe(202);
    expect(vi.mocked(handleCastTrainWanLora)).toHaveBeenCalled();
  });
});

describe("shouldProjectWanLoras", () => {
  it("gates on backend and wanPretrained", () => {
    expect(shouldProjectWanLoras(WAN_LORA_BACKEND, { A: {} })).toBe(true);
    expect(shouldProjectWanLoras("own-gpu", { A: {} })).toBe(false);
  });
});

describe("ensureModuleOverrideConfig", () => {
  it("creates nested module config", () => {
    const r = ensureModuleOverrideConfig(undefined, WAN_LORA_BACKEND);
    expect(r.overrides.config).toEqual({ [WAN_LORA_BACKEND]: {} });
  });
});

describe("MAX_LORAS_PER_PASS overflow logs", () => {
  it("drops overflow slots", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const many: Record<string, { high: string; low: string }> = {};
    for (let i = 0; i < MAX_LORAS_PER_PASS + 2; i++) many[`slot${i}`] = { high: `loras/h${i}`, low: `loras/l${i}` };
    const cfg: Record<string, unknown> = {};
    const r = await projectWanLorasIntoModuleConfig(anyEnv, WAN_LORA_BACKEND, many, cfg);
    expect(r.dropped).toBe(2);
    warn.mockRestore();
  });
});
