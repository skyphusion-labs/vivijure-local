// Deepgram Aura-1 narration: the creds-free (CF AI) default tier for the score `narration` engine
// (local#202). RunPod MiniMax Speech 02 HD stays the opt-in high-fidelity tier (chosen when
// RUNPOD_API_KEY is present). CF has no MiniMax speech model (verified against the Workers AI
// catalog), so the default tier is a DIFFERENT engine; the MiniMax-only knobs degrade HONESTLY here
// (named, never silent) and `voice_id` maps to a stable Aura speaker so distinct cast voices stay
// distinct. aiRun already speaks this model (its binary-TTS branch returns the audio bytes directly).

export const AURA_MODEL = "@cf/deepgram/aura-1";

/** Aura-1 speakers (the model`s fixed voice set). */
export const AURA_SPEAKERS = [
  "angus", "asteria", "arcas", "orion", "orpheus", "athena",
  "luna", "zeus", "perseus", "helios", "hera", "stella",
] as const;
export type AuraSpeaker = (typeof AURA_SPEAKERS)[number];

/** A natural narration default when no voice_id is given. */
export const DEFAULT_AURA_SPEAKER: AuraSpeaker = "asteria";

/** Map a (MiniMax-shaped) voice_id onto a STABLE Aura speaker: an explicit Aura name passes through,
 *  blank -> default, anything else hashes deterministically so the same voice_id always yields the
 *  same speaker AND different voice_ids spread across the set (distinct cast voices stay distinct). */
export function auraSpeakerFor(voiceId: string | undefined | null): AuraSpeaker {
  const v = (voiceId ?? "").trim();
  if (!v) return DEFAULT_AURA_SPEAKER;
  const lower = v.toLowerCase();
  if ((AURA_SPEAKERS as readonly string[]).includes(lower)) return lower as AuraSpeaker;
  let h = 0;
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) >>> 0;
  return AURA_SPEAKERS[h % AURA_SPEAKERS.length]!;
}

export type NarrationFormat = "mp3" | "wav" | "flac";
export function narrationFormat(raw: unknown): NarrationFormat {
  return raw === "wav" ? "wav" : raw === "flac" ? "flac" : "mp3";
}
export function narrationMime(format: NarrationFormat): string {
  return format === "wav" ? "audio/wav" : format === "flac" ? "audio/flac" : "audio/mpeg";
}

/** Aura-1 request body. wav = linear16 PCM in a wav container; mp3/flac use the codec directly. */
export function buildAuraParams(
  text: string,
  voiceId: string | undefined | null,
  format: NarrationFormat,
): Record<string, unknown> {
  const speaker = auraSpeakerFor(voiceId);
  if (format === "wav") {
    return { text, speaker, encoding: "linear16", container: "wav", sample_rate: 44100 };
  }
  return { text, speaker, encoding: format };
}

/** The MiniMax knobs Aura-1 has no equivalent for. Named so the degrade is honest, never silent. */
export const AURA_UNSUPPORTED_KNOBS = ["emotion", "pitch", "speed", "volume"] as const;

/** An honest degrade note IF the caller set any MiniMax-only knob away from its default (so Aura could
 *  not honor it); null when the request maps cleanly (plain narration). Defaults mirror the manifest:
 *  emotion "neutral", pitch 0, speed 1, volume 1. */
export function narrationAuraDegrade(config: Record<string, unknown> | undefined): string | null {
  const c = config ?? {};
  const used: string[] = [];
  if (typeof c.emotion === "string" && c.emotion && c.emotion !== "neutral") used.push("emotion");
  if (c.pitch !== undefined && Number(c.pitch) !== 0) used.push("pitch");
  if (c.speed !== undefined && Number(c.speed) !== 1) used.push("speed");
  if (c.volume !== undefined && Number(c.volume) !== 1) used.push("volume");
  if (!used.length) return null;
  return `aura-1 (CF default tier) ignores MiniMax knobs: ${used.join(", ")}; set RUNPOD_API_KEY for the MiniMax HD tier`;
}


// ---- engine-honest manifest projection (local#202) ----------------------------------------------
// The committed manifest identity is cf-canonical + drift-locked (vivijure-cf#211/#219, 2026-07-25:
// reworded to "Narration (Deepgram Aura on Cloudflare; MiniMax HD with RunPod)", the exact string
// NARRATION_HONEST_LABEL sets below, so the picker-label half of this override is now a same-value
// no-op). The score app still augments the RUNTIME /module.json (the local-finish/app.ts precedent):
// the tier menu + active-tier fields below are additive, a module never reads them (the panel / an
// operator does), and they still need a live env read the committed static file cannot do. The
// committed file is untouched, so upstream parity holds.

export type NarrationEngine = "minimax-runpod" | "aura-1" | "none";

export const NARRATION_TIERS = [
  { id: "aura-1", label: "Deepgram Aura-1 (Cloudflare AI, no RunPod)", requires: "cf-ai-gateway" },
  { id: "minimax-runpod", label: "MiniMax Speech 02 HD (RunPod, high fidelity)", requires: "runpod-api-key" },
] as const;

/** The engine-honest picker identity: names both tiers, not just the RunPod one. */
export const NARRATION_HONEST_LABEL = "Narration (Deepgram Aura on Cloudflare; MiniMax HD with RunPod)";

/** Which narration tier is live for this env: RunPod key => MiniMax HD; else CF gateway => Aura-1; else none. */
export function narrationEngineFor(hasRunpodKey: boolean, hasCfGateway: boolean): NarrationEngine {
  if (hasRunpodKey) return "minimax-runpod";
  if (hasCfGateway) return "aura-1";
  return "none";
}

/** A shallow, engine-honest view of the manifest for the runtime /module.json (never mutates input). */
export function narrationManifestView(
  manifest: Record<string, unknown>,
  engine: NarrationEngine,
): Record<string, unknown> {
  let provides = manifest.provides;
  if (Array.isArray(provides) && provides.length) {
    provides = provides.map((row, i) =>
      i === 0 && row && typeof row === "object"
        ? { ...(row as Record<string, unknown>), label: NARRATION_HONEST_LABEL }
        : row,
    );
  }
  return { ...manifest, provides, narration_engine: engine, narration_tiers: NARRATION_TIERS };
}
