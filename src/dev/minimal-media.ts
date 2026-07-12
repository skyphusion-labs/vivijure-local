// Tiny media fixtures for local GPU mocks and smoke tests.

/** 1x1 PNG (red pixel). */
export const MIN_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

function be32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}
function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [...be32(size), ...ascii(type), ...payload];
}
function zeros(n: number): number[] {
  return new Array(n).fill(0);
}
function mvhd(timescale: number, duration: number): number[] {
  const p = zeros(100);
  [...be32(timescale)].forEach((b, i) => (p[12 + i] = b));
  [...be32(duration)].forEach((b, i) => (p[16 + i] = b));
  return box("mvhd", p);
}
function tkhd(width: number, height: number): number[] {
  const p = zeros(84);
  [...be32(width << 16)].forEach((b, i) => (p[76 + i] = b));
  [...be32(height << 16)].forEach((b, i) => (p[80 + i] = b));
  return box("tkhd", p);
}
function hdlr(kind: string): number[] {
  return box("hdlr", [...zeros(8), ...ascii(kind), ...zeros(12)]);
}
function stsz(count: number): number[] {
  return box("stsz", [...zeros(8), ...be32(count)]);
}
function videoTrak(width: number, height: number, frames: number): number[] {
  const stbl = box("stbl", stsz(frames));
  const minf = box("minf", stbl);
  const mdia = box("mdia", [...hdlr("vide"), ...minf]);
  return box("trak", [...tkhd(width, height), ...mdia]);
}
function moov(opts: {
  timescale: number;
  duration: number;
  width: number;
  height: number;
  frames: number;
}): number[] {
  return box("moov", [...mvhd(opts.timescale, opts.duration), ...videoTrak(opts.width, opts.height, opts.frames)]);
}
function ftyp(): number[] {
  return box("ftyp", [...ascii("isom"), ...be32(0x200), ...ascii("isommp42")]);
}
function mdat(payloadBytes: number): number[] {
  return box("mdat", zeros(payloadBytes));
}

/** Structural mp4 for clip validation (ffmpeg may still reject it; prefer writeMockClip). */
export function buildStructuralMp4(seconds = 4): Uint8Array {
  const timescale = 600;
  const duration = Math.max(timescale, Math.round(seconds * timescale));
  const frames = Math.max(24, Math.round(seconds * 24));
  const parts = [...ftyp(), ...moov({ timescale, duration, width: 320, height: 240, frames }), ...mdat(4000)];
  return new Uint8Array(parts);
}
