// Bundle tar/gzip parsing for cloud-keyframe (ported from vivijure/modules/cloud-keyframe/src/bundle.ts).

import type { ArtifactStore } from "../../platform/create-storage.js";

export interface BundleScene {
  shot_id: string;
  prompt: string;
  slots: string[];
}

export interface RegistryCharacter {
  name: string;
  prompt: string;
  image: string;
}

function readTarString(header: Uint8Array, offset: number, width: number): string {
  let s = "";
  for (let i = 0; i < width; i++) {
    const c = header[offset + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function parseTarOctal(header: Uint8Array, offset: number, width: number): number {
  const raw = readTarString(header, offset, width).trim();
  if (!raw) return 0;
  return parseInt(raw, 8) || 0;
}

export function listTarNames(tar: Uint8Array): string[] {
  const names: string[] = [];
  let offset = 0;
  for (;;) {
    if (offset + 512 > tar.length) break;
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = readTarString(header, 0, 100);
    const size = parseTarOctal(header, 124, 12);
    offset += 512;
    if (offset + size > tar.length) break;
    offset += Math.ceil(size / 512) * 512;
    if (name) names.push(name);
  }
  return names;
}

export function extractTarBytes(tar: Uint8Array, wantName: string): Uint8Array | null {
  let offset = 0;
  for (;;) {
    if (offset + 512 > tar.length) break;
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = readTarString(header, 0, 100);
    const size = parseTarOctal(header, 124, 12);
    offset += 512;
    if (offset + size > tar.length) break;
    const content = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (name === wantName) return content;
  }
  return null;
}

export function extractTarText(tar: Uint8Array, wantName: string): string | null {
  const bytes = extractTarBytes(tar, wantName);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

function parseSlotList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  return inner.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

export function parseScenes(yaml: string): BundleScene[] {
  const out: BundleScene[] = [];
  let inScenes = false;
  let idx = 0;
  let curId: string | null = null;
  let curPrompt: string | null = null;
  let curSlots: string[] = [];
  const flush = (): void => {
    if (idx === 0 || curPrompt === null) return;
    const shot = curId || `shot_${String(idx).padStart(2, "0")}`;
    out.push({ shot_id: shot, prompt: curPrompt, slots: curSlots });
  };
  for (const line of yaml.split(/\r?\n/)) {
    if (!inScenes) {
      if (/^scenes:\s*$/.test(line)) inScenes = true;
      continue;
    }
    const promptM = line.match(/^ {2}- prompt: "((?:[^"\\]|\\.)*)"\s*$/);
    if (promptM) {
      flush();
      idx++;
      curId = null;
      curSlots = [];
      curPrompt = promptM[1].replace(/\\(.)/g, "$1");
      continue;
    }
    const idM = line.match(/^ {4}id:\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (idM) {
      curId = idM[1].replace(/\\(.)/g, "$1");
      continue;
    }
    const slotsM = line.match(/^ {4}character_slots:\s*(\[.*\])\s*$/);
    if (slotsM) curSlots = parseSlotList(slotsM[1]);
  }
  flush();
  return out;
}

export function parseStylePrefix(yaml: string): string {
  for (const line of yaml.split(/\r?\n/)) {
    const m = line.match(/^style_prefix:\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (m) return m[1].replace(/\\(.)/g, "$1");
  }
  return "";
}

export function parseRegistry(json: string): Record<string, RegistryCharacter> {
  const out: Record<string, RegistryCharacter> = {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return out;
  }
  const chars = (parsed as { characters?: unknown })?.characters;
  if (!chars || typeof chars !== "object") return out;
  for (const [slot, v] of Object.entries(chars as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const c = v as Record<string, unknown>;
    out[slot] = {
      name: typeof c.name === "string" ? c.name : "",
      prompt: typeof c.prompt === "string" ? c.prompt : "",
      image: typeof c.image === "string" ? c.image : "",
    };
  }
  return out;
}

export function refsForSlot(tarNames: string[], slot: string): string[] {
  const prefix = `characters/refs/${slot}/`;
  return tarNames.filter((n) => n.startsWith(prefix) && /\.(png|jpe?g|webp)$/i.test(n)).sort();
}

export async function gunzipBundle(store: ArtifactStore, bundleKey: string): Promise<Uint8Array | null> {
  const compressed = await store.get(bundleKey);
  if (!compressed) return null;
  const tarStream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(tarStream).arrayBuffer());
}
