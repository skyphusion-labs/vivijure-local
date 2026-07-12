import type { FinishInput, FinishOutput } from "@skyphusion-labs/vivijure-core";

export function passthroughOutput(
  input: FinishInput,
  reason: string,
  opts: { degraded?: boolean; detail?: string } = {},
): FinishOutput {
  const degraded = opts.degraded ?? true;
  const out: FinishOutput = {
    shot_id: input.shot_id,
    clip_key: input.clip_key,
    out_fps: input.src_fps ?? 24,
    frames: input.frames ?? 0,
    applied: [`${degraded ? "passthrough" : "noop"}:${reason}`],
  };
  if (degraded) out.degraded = opts.detail ? `${reason}: ${opts.detail}` : reason;
  return out;
}

export function outputClipKey(clipKey: string): string {
  const dot = clipKey.lastIndexOf(".");
  if (dot > 0) return `${clipKey.slice(0, dot)}_overlay${clipKey.slice(dot)}`;
  return `${clipKey}_overlay`;
}

export interface OverlayConfig {
  font: string;
  size: number;
  color: string;
  safe_margin: number;
}

export function coerceConfig(raw: Record<string, unknown>): OverlayConfig {
  return {
    font: typeof raw.font === "string" && raw.font.trim() ? raw.font.trim() : "DejaVu Sans",
    size: Math.max(8, Math.min(400, Math.round(Number(raw.size) || 48))),
    color: typeof raw.color === "string" && raw.color.trim() ? raw.color.trim() : "white",
    safe_margin: Math.max(0, Math.min(500, Math.round(Number(raw.safe_margin) || 50))),
  };
}

export interface OverlaySpec {
  text: string;
  kind?: string;
  start?: number;
  end?: number;
}

export function coerceOverlays(raw: unknown): OverlaySpec[] {
  if (!Array.isArray(raw)) return [];
  const out: OverlaySpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) continue;
    out.push({
      text,
      kind: typeof o.kind === "string" ? o.kind : undefined,
      start: typeof o.start === "number" ? o.start : 0,
      end: typeof o.end === "number" ? o.end : undefined,
    });
  }
  return out;
}

/** Minimal drawtext filter: one chain per overlay, bottom-centered subtitles. */
export function buildDrawtextFilter(overlays: OverlaySpec[], cfg: OverlayConfig): string {
  if (!overlays.length) return "";
  const parts: string[] = [];
  for (const o of overlays) {
    const escaped = o.text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
    const enable =
      o.end != null ? `between(t,${o.start ?? 0},${o.end})` : `gte(t,${o.start ?? 0})`;
    parts.push(
      `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${escaped}':fontsize=${o.kind === "title" ? cfg.size + 8 : cfg.size}:fontcolor=${cfg.color}:x=(w-text_w)/2:y=h-${cfg.safe_margin}-text_h:enable='${enable}'`,
    );
  }
  return parts.join(",");
}

export function buildContainerSpec(filter: string, outputKey: string): Record<string, unknown> {
  return { filter, outputKey };
}
