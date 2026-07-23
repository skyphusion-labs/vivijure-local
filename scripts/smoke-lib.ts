/** Shared helpers for homelab smoke scripts (bundle -> render -> poll). */

export const BASE = (process.env.STUDIO_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
export const TOKEN = process.env.STUDIO_API_TOKEN || "change-me-local-dev-only";

export interface SmokeScene {
  id: string;
  prompt: string;
  target_seconds: number;
}

export interface SmokeStoryboard {
  title: string;
  full_prompt: string;
  duration_seconds: number;
  clip_seconds: number;
  style_prefix: string;
  style_category: string;
  style_preset: string;
  use_characters: string[];
  scenes: SmokeScene[];
}

export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export function fail(msg: string): never {
  console.error(`smoke: FAIL -- ${msg}`);
  process.exit(1);
}
