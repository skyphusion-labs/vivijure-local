// Minimal synthesized audio for the dialogue-gen silent fallback (#50).
//
// This file used to also hold the GPU mock's fabricated RENDER artifacts (a 1x1 red PNG standing in
// for a keyframe, and a hand-assembled mp4 box tree standing in for a rendered clip). Those are
// deleted (local#229): nothing in this repo may manufacture a render artifact and report it as work
// done. Do not reintroduce that class of helper here.
//
// What remains is not a stand-in for a render: the dialogue-gen fallback writes real silence and
// tags it honestly (`SILENT_FALLBACK_TAG`, src/modules/chain/dialogue-gen-core.ts), so the caller
// can see it is silence rather than synthesized speech.

/** Minimal mono 16-bit PCM WAV (for the dialogue-gen silent fallback). */
export function buildSilentWav(seconds = 0.25, sampleRate = 16000): Uint8Array {
  const numSamples = Math.max(1, Math.round(seconds * sampleRate));
  const dataBytes = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buf);
}
