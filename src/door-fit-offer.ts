// vivijure-cf#930 (dual panel with vivijure-cf src/door-fit-offer.ts): the doors a film offers core for a
// per-shot door fit. Conrad's ruling (2026-11-11): a per-shot motion door applies to that one clip only,
// and the film's door stays the default for every other shot. Core decides, per lined shot and after the
// lines are bought, whether the film door's clip floor would leave the speaker mouthing silence; if so it
// moves that one shot to the first door offered here that takes it without a tail (core door-fit.ts).

import { servingForHook } from "@skyphusion-labs/vivijure-core/modules/registry";
import type { RegisteredModule } from "@skyphusion-labs/vivijure-core";

/** Whether a film door the CALLER named may still have a shot moved off it. Same value as vivijure-cf. A
 *  door the caller set on a SHOT is never moved either way; that is core's rule, not this one. */
// Conrad's ruling on vivijure-cf#930 (2026-11-11): B. An explicit film door is the default for every
// shot, and a short-line shot may still move off it for that one clip.
export const DOOR_FIT_FOR_EXPLICIT_FILM_DOOR = true;

export interface DoorFitOffer {
  door_fit?: string[];
  motion_configs?: Record<string, Record<string, unknown>>;
}

function locality(m: RegisteredModule | undefined): unknown {
  return (m?.ui as { locality?: unknown } | undefined)?.locality;
}

/** The config a driven door gets for a spoken shot, as vivijure-cf's prepareSpokenClip gives it: a door
 *  that only follows the line (driving_audio, not native_audio) is told not to invent audio. */
function spokenConfig(m: RegisteredModule): Record<string, unknown> {
  const drivingOnly = m.usage?.driving_audio === true && m.usage?.native_audio !== true;
  return drivingOnly && Object.prototype.hasOwnProperty.call(m.config_schema ?? {}, "generate_audio")
    ? { generate_audio: false }
    : {};
}

/** The offer for a film rendering on `filmDoor` (the caller's, or core's default: the first serving
 *  motion door). Empty unless the film has lines, the film door is driven by audio, and the door was not
 *  the caller's own choice (unless DOOR_FIT_FOR_EXPLICIT_FILM_DOOR). Offered: every other serving driven
 *  motion door with the film door's locality, in ui.order. */
export function doorFitOffer(
  modules: RegisteredModule[],
  filmDoor: string | undefined,
  opts: { spoken: boolean; explicit: boolean },
): DoorFitOffer {
  if (!opts.spoken) return {};
  if (opts.explicit && !DOOR_FIT_FOR_EXPLICIT_FILM_DOOR) return {};
  const serving = servingForHook(modules, "motion.backend");
  const film = filmDoor ? serving.find((m) => m.name === filmDoor) : serving[0];
  if (!film || film.usage?.driving_audio !== true) return {};
  const names: string[] = [];
  const configs: Record<string, Record<string, unknown>> = {};
  for (const m of serving) {
    if (m.name === film.name || m.usage?.driving_audio !== true || locality(m) !== locality(film)) continue;
    names.push(m.name);
    configs[m.name] = spokenConfig(m);
  }
  return names.length ? { door_fit: names, motion_configs: configs } : {};
}
