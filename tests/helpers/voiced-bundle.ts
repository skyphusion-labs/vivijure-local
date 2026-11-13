// A real bundles/*.tar.gz carrying a storyboard.yaml, so tests drive core's REAL readBundleScenes
// (gzip + ustar walk + YAML parse) instead of a stub of it. local#326.
import { gzipSync } from "node:zlib";

function header(name: string, size: number): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, off: number) => h.set(new TextEncoder().encode(s), off);
  put(name, 0);
  put("0000644\0", 100);
  put("0000000\0", 108);
  put("0000000\0", 116);
  put(size.toString(8).padStart(11, "0") + "\0", 124);
  put("00000000000\0", 136);
  put("        ", 148);
  put("0", 156);
  put("ustar\0", 257);
  put("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}

/** gzip(ustar) with storyboard.yaml plus any extra entries (e.g. clips/<id>_keyframe.png). */
export function bundleTarGz(storyboardYaml: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
  const files: [string, Uint8Array][] = [["storyboard.yaml", new TextEncoder().encode(storyboardYaml)], ...Object.entries(extra)];
  const parts: Uint8Array[] = [];
  for (const [name, body] of files) {
    parts.push(header(name, body.length), body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const tar = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { tar.set(p, off); off += p.length; }
  return new Uint8Array(gzipSync(tar));
}

export interface ShotSpec {
  id: string;
  prompt: string;
  line?: { slot: string; text: string };
}

/** The storyboard.yaml shape core's serializeStoryboardYaml emits (scenes, per-shot dialogue). */
export function storyboardYaml(shots: ShotSpec[]): string {
  const out = ["title: \"t\"", "scenes:"];
  for (const s of shots) {
    out.push(`  - prompt: "${s.prompt}"`);
    out.push(`    id: "${s.id}"`);
    out.push("    target_seconds: 4");
    if (s.line) {
      out.push("    dialogue:");
      out.push(`      slot: ${s.line.slot}`);
      out.push(`      text: "${s.line.text}"`);
    }
  }
  return out.join("\n") + "\n";
}

/** An env whose R2_RENDERS serves exactly these objects, for direct calls into core helpers. */
export function storeEnv(objects: Record<string, Uint8Array>): { R2_RENDERS: { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> } } {
  return {
    R2_RENDERS: {
      get: async (key: string) => {
        const b = objects[key];
        if (!b) return null;
        return { arrayBuffer: async () => b.slice().buffer as ArrayBuffer };
      },
    },
  };
}
