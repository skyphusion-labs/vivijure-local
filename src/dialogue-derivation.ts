// Ported from vivijure-cf src/dialogue-derivation.ts (fc#2250 item 7, vivijure-cf#1056) for
// local#326. Keep the two in step: the refusal text and the shot filter are the same on both hosts.
//
// WHAT A FAILED DERIVATION MEANS. `readBundleScenes` returns `[]` when the bundle object is missing
// or carries no storyboard.yaml, and THROWS only on a real failure (a storage error, a corrupt gzip,
// unparseable YAML). So:
//   []     -- the storyboard genuinely has nothing to voice. Render silent.
//   throw  -- whether this storyboard has spoken lines is UNDETERMINED. Refuse with 503 rather than
//             spend GPU on a film that may come back silently wrong and be reported as a success.
// 503, not 400: the render is refused because a gate could not be evaluated, not because the request
// was malformed. The underlying reason is carried through verbatim.

/** The refusal text for a render whose dialogue state could not be established. */
export function dialogueUndeterminedMessage(e: unknown): string {
  const reason = e instanceof Error ? e.message : String(e);
  return (
    "could not determine whether this storyboard has spoken lines, so the render was refused "
    + "rather than risk shipping a silent film: " + reason
  );
}

// vivijure-cf#1056: the spoken lines are about the shots THIS render makes. The bundle scenes are
// kept to the rendered shots ONLY when the mapping is proven: every rendered shot id is a shot id in
// the bundle. If any rendered id is missing from the bundle, the ids do not describe the same board,
// and dropping lines on a guess could ship a voiced film silent, so every scene is kept.
export function bundleScenesForRender<S extends { shot_id: string }>(bundleScenes: S[], renderedShotIds: string[]): S[] {
  const inBundle = new Set(bundleScenes.map((s) => s.shot_id));
  if (!renderedShotIds.length || !renderedShotIds.every((id) => inBundle.has(id))) return bundleScenes;
  const rendered = new Set(renderedShotIds);
  return bundleScenes.filter((s) => rendered.has(s.shot_id));
}
