// local#326: ONE dialogue resolution for every render door (parity half of vivijure-cf#334).
//
// Before this, authored per-shot dialogue reached core from exactly one door here (the agent film
// route, m9). The panel main render, render-from-keyframes and the finalize family (finalize,
// animate-cloud, animate-hybrid) started their films with no dialogue_lines at all, so a voiced
// storyboard rendered silent and nothing said so. vivijure-cf fixed its half in cf#334 by deriving
// lines from the bundle storyboard at each door; this module is that same resolution, written once
// and called by all four local doors, so the doors cannot drift apart again one at a time.
//
// The ladder, in order (the same as vivijure-cf):
//   1. Explicit lines from the caller win. Lines with no voice_id get the cast voice for their slot
//      (resolveExplicitLineVoices), and the bundle is read only when that is needed.
//   2. Otherwise derive lines from the bundle storyboard, judged on the shots THIS render makes
//      (bundleScenesForRender, vivijure-cf#1056).
//   3. A bundle read or a cast resolution that FAILS is a refusal (503), never a silent film
//      (vivijure-cf fc#2250, see dialogue-derivation.ts). A MISSING bundle is not a failure:
//      readBundleScenes returns [] for it, and the render proceeds silent, as before.
//
// Hosts differ in wire shape, so each door still reads its own body. What is shared is everything
// between "the door knows its bundle, its shots and its cast voices" and "dialogue_lines is set".
import type { DialogueLine } from "@skyphusion-labs/vivijure-core/modules/types";
import { readBundleScenes } from "@skyphusion-labs/vivijure-core/bundle-storyboard";
import {
  dialogueLinesFromBundleScenes,
  resolveExplicitLineVoices,
} from "@skyphusion-labs/vivijure-core/dialogue-lines";
import { bundleScenesForRender, dialogueUndeterminedMessage } from "./dialogue-derivation.js";

type BundleScenes = Awaited<ReturnType<typeof readBundleScenes>>;

export interface RenderDialogueInput {
  bundleKey: string;
  /** The shot ids THIS render makes. Empty means "judge the whole board". */
  renderedShotIds: string[];
  /** Resolved slot -> voice_id map (resolveCastLoras().voices). Empty when no cast is bound. */
  voices: Record<string, string>;
  /** Lines the caller sent explicitly. Only the agent route accepts these. */
  explicit?: DialogueLine[];
  /** The bundle scenes when the door has already read them, so the bundle is not read twice. */
  bundleScenes?: BundleScenes;
}

export type RenderDialogue =
  | { ok: true; lines: DialogueLine[] | undefined }
  | { ok: false; status: 503; error: string };

/** The refusal for a door whose dialogue state could not be established (cast or bundle failure). */
export function dialogueUndetermined(e: unknown): RenderDialogue {
  return { ok: false, status: 503, error: dialogueUndeterminedMessage(e) };
}

export async function resolveRenderDialogue(
  env: Parameters<typeof readBundleScenes>[0],
  input: RenderDialogueInput,
): Promise<RenderDialogue> {
  const scenes = async (): Promise<BundleScenes> =>
    input.bundleScenes ?? (await readBundleScenes(env, input.bundleKey));
  try {
    if (input.explicit && input.explicit.length) {
      const needsVoices =
        Object.keys(input.voices).length > 0 &&
        input.explicit.some((l) => !(typeof l.voice_id === "string" && l.voice_id.trim()));
      if (!needsVoices) return { ok: true, lines: input.explicit };
      return { ok: true, lines: resolveExplicitLineVoices(input.explicit, await scenes(), input.voices) };
    }
    const all = await scenes();
    const lines = dialogueLinesFromBundleScenes(bundleScenesForRender(all, input.renderedShotIds), input.voices);
    if (!lines.length) return { ok: true, lines: undefined };
    return { ok: true, lines: resolveExplicitLineVoices(lines, all, input.voices) };
  } catch (e) {
    return dialogueUndetermined(e);
  }
}
