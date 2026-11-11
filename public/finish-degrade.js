// Pure helpers for the finish-degrade projection (cf#118). No DOM: unit-tested under
// plain Node (tests/finish-degrade.test.ts) and loaded as a classic <script> as
// `window.finishDegrade`. Same UMD-ish shape as hook-availability-checks.js /
// cast-select.js / model-catalog.js. No framework, no build step.
//
// THE PROBLEM THIS EXISTS FOR (cf#118):
// When the video-finish tier is unavailable (VIDEO_FINISH_VPC unbound, the hosted-tenant
// case), the orchestrator degrades HONESTLY rather than failing: it ships the per-shot
// clips at assemble, or the silent film at mux, and says so. The poll payload has carried
// that fact all along, `output.finish_unavailable {at, reason, delivered}` plus
// `output.clips` (core film-render-bridge.js), and the panel dropped it on the floor. The
// user saw a green "completed" and a JSON blob.
//
// Worse, the assemble degrade sets `output_key` to UNDEFINED (core film-output-key.js:
// `delivered === "clips"` -> undefined), and the old completed-branch only touched the
// download anchors INSIDE `if (typeof out.output_key === "string")`. Nothing ever reset
// them. So a degraded render following a successful one in the same session left
// "download silent MP4" pointing at the PREVIOUS render film: the wrong artifact,
// presented as this render output. That is the opposite of an honest degrade, and it is
// why `deliverable()` below returns a decision for ALL THREE cases rather than a boolean.
//
// Deliberately generic about the reason: the studio wrote the truest available description
// of why the step is dead, and this file renders it VERBATIM. It never rewrites, prettifies
// or softens it. `deliveredSummary()` states only what WE know STRUCTURALLY (which step,
// what was handed over) and is displayed BESIDE the verbatim reason, never instead of it.
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.finishDegrade = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  // Used when the studio reports a degrade but gives no readable reason. We still disclose
  // that the finishing step did not run; we just cannot say why, and we say THAT rather
  // than inventing a cause.
  var NO_REASON =
    "This studio could not run the finishing step, and it did not say why. Nothing you do here will fix it; tell whoever runs this studio.";

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  // Every clip the payload names, as {shot_id, key}. A junk entry is skipped rather than
  // failing the whole list: one malformed clip must not hide the clips that ARE deliverable.
  function clipsFrom(output) {
    var raw = output && output.clips;
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (!c || typeof c !== "object") continue;
      if (!isNonEmptyString(c.shot_id) || !isNonEmptyString(c.key)) continue;
      out.push({ shot_id: c.shot_id.trim(), key: c.key.trim() });
    }
    return out;
  }

  // Normalize `output.finish_unavailable` into a plain object, or null for "no degrade".
  //
  // Total and forgiving in ONE direction only: junk anywhere resolves to "nothing to
  // report" (null), never to a scary banner on a render that is perfectly fine. A parse
  // failure must not tell a user their good film is broken.
  function degradeFrom(output) {
    if (!output || typeof output !== "object") return null;
    var raw = output.finish_unavailable;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var at = isNonEmptyString(raw.at) ? raw.at.trim() : null;
    var delivered = isNonEmptyString(raw.delivered) ? raw.delivered.trim() : null;
    // A degrade object carrying neither structural fact is indistinguishable from junk.
    // Report nothing rather than a contentless warning.
    if (!at && !delivered) return null;
    return {
      at: at,
      delivered: delivered,
      reason: isNonEmptyString(raw.reason) ? raw.reason.trim() : NO_REASON,
      clips: clipsFrom(output),
    };
  }

  // THE single decision the UI needs: what, concretely, can this person download?
  //   "film"  -> one assembled artifact at .key (the normal path, and the mux degrade,
  //              which still produces a complete silent video).
  //   "clips" -> no assembled film; the per-shot clips in .clips ARE the delivered render.
  //   "none"  -> nothing downloadable was named. The links must be CLEARED, not left
  //              pointing at whatever they pointed at last.
  function deliverable(output) {
    var degrade = degradeFrom(output);
    var key = output && isNonEmptyString(output.output_key) ? output.output_key.trim() : null;
    if (key) return { kind: "film", key: key, clips: degrade ? degrade.clips : [] };
    var clips = degrade ? degrade.clips : [];
    if (clips.length) return { kind: "clips", key: null, clips: clips };
    return { kind: "none", key: null, clips: [] };
  }

  // What the studio actually handed over, stated structurally. This is OUR sentence, built
  // from the two enum fields; it is never a paraphrase of the operator reason, which is
  // rendered verbatim alongside it.
  function deliveredSummary(degrade) {
    if (!degrade) return null;
    var where =
      degrade.at === "mux"
        ? "The audio mux step"
        : degrade.at === "assemble"
          ? "The assemble step"
          : "The finishing step";
    if (degrade.delivered === "clips") {
      var n = degrade.clips.length;
      var what = n ? n + " per-shot clip" + (n === 1 ? "" : "s") : "the per-shot clips";
      return where + " did not run, so this render delivered " + what + " instead of one assembled film.";
    }
    if (degrade.delivered === "silent_film") {
      return where + " did not run, so this render delivered the SILENT film: the video is complete, the audio was never mixed onto it.";
    }
    return where + " did not run, so part of the finishing pass is missing from this render.";
  }

  // ---- local#539: the render signals core carries to the render row ----
  // Ported from vivijure-cf (cf#916, cf#1282, cf#1283, cf#1385), with the same wording. Local has no
  // stage-band machinery, so each signal renders as one plain line on the row (renderSignalLines) and
  // as warnings beside the affected still (shotWarnings). Every signal follows the same ladder: the
  // key ABSENT means the check never ran and renders nothing; a clean result renders nothing; only a
  // reported problem renders. A shape we do not recognise renders nothing, never "clean".

  function isCount(v) {
    return typeof v === "number" && isFinite(v) && v >= 0 && Math.floor(v) === v;
  }

  function stringList(v) {
    var out = [];
    if (!Array.isArray(v)) return out;
    for (var i = 0; i < v.length; i++) {
      if (isNonEmptyString(v[i])) out.push(String(v[i]).trim());
    }
    return out;
  }

  /** `output.content_validation` (core 1.25.0): `{ checked, unmeasured, reasons, degraded? }`, the clip
   *  picture check. `degraded` lists the clips that FAILED it, `unmeasured` those it could not look at. */
  function parseContentValidation(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (!isCount(raw.checked) || !isCount(raw.unmeasured)) return null;
    if (raw.reasons !== undefined && !Array.isArray(raw.reasons)) return null;
    if (raw.degraded !== undefined && !Array.isArray(raw.degraded)) return null;
    var failedShots = [];
    var failedReasons = [];
    var list = Array.isArray(raw.degraded) ? raw.degraded : [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d || typeof d !== "object" || !isNonEmptyString(d.shot_id)) continue;
      var shot = String(d.shot_id).trim();
      failedShots.push(shot);
      if (isNonEmptyString(d.reason)) failedReasons.push(shot + ": " + String(d.reason).trim());
    }
    return {
      failed: failedShots.length,
      failedShots: failedShots,
      unmeasured: raw.unmeasured,
      reasons: failedReasons.concat(raw.unmeasured > 0 ? stringList(raw.reasons) : []),
    };
  }

  /** `output.plate_check` (core 1.31.0): `{ checked, unclean: [{ shot_id, expected, faces }] }`, the
   *  stills made from a plate that may show an extra person. */
  function parsePlateCheck(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (!isCount(raw.checked) || !Array.isArray(raw.unclean)) return null;
    var shots = [];
    for (var i = 0; i < raw.unclean.length; i++) {
      var u = raw.unclean[i];
      if (u && typeof u === "object" && isNonEmptyString(u.shot_id)) shots.push(String(u.shot_id).trim());
    }
    return { shots: shots };
  }

  /** `output.keyframes_incomplete` (core 1.31.0): `{ adopted, expected, dropped }`, shots that got no
   *  still and were left out of the film. */
  function parseKeyframesIncomplete(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (!isCount(raw.adopted) || !isCount(raw.expected)) return null;
    if (raw.dropped !== undefined && !Array.isArray(raw.dropped)) return null;
    var shots = stringList(raw.dropped);
    return { missing: Math.max(shots.length, raw.expected - raw.adopted, 0), shots: shots, expected: raw.expected };
  }

  function isOutput(output) {
    return !!output && typeof output === "object" && !Array.isArray(output);
  }

  /** The shot ids `output.plate_check` names as unclean. Empty for clean, absent, or junk. */
  function plateUncleanShots(output) {
    if (!isOutput(output)) return [];
    var parsed = parsePlateCheck(output.plate_check);
    return parsed ? parsed.shots : [];
  }

  /** vivijure-cf#930 (dual panel with vivijure-cf): `output.door_fit` (core 1.47.0, door-fit.ts):
   *  `{ swapped: [{ shot_id, from, to, line_seconds, planned_seconds, from_clip_seconds }], tails:
   *  [{ shot_id, door, line_seconds, clip_seconds }] }`. Absent when no lined shot had a tail. STRICT on
   *  the two arrays, so junk is null and never reads as clean. Entries without a shot id are dropped. */
  function parseDoorFit(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (!Array.isArray(raw.swapped) || !Array.isArray(raw.tails)) return null;
    var num = function (v) { return typeof v === "number" && isFinite(v) && v > 0 ? v : null; };
    var swapped = [];
    var tails = [];
    for (var i = 0; i < raw.swapped.length; i++) {
      var s = raw.swapped[i];
      if (!s || typeof s !== "object" || !isNonEmptyString(s.shot_id) || !isNonEmptyString(s.from) || !isNonEmptyString(s.to)) continue;
      swapped.push({ shot_id: String(s.shot_id).trim(), from: String(s.from).trim(), to: String(s.to).trim(),
        line_seconds: num(s.line_seconds), clip_seconds: num(s.from_clip_seconds) });
    }
    for (var j = 0; j < raw.tails.length; j++) {
      var t = raw.tails[j];
      if (!t || typeof t !== "object" || !isNonEmptyString(t.shot_id) || !isNonEmptyString(t.door)) continue;
      tails.push({ shot_id: String(t.shot_id).trim(), door: String(t.door).trim(),
        line_seconds: num(t.line_seconds), clip_seconds: num(t.clip_seconds) });
    }
    return { swapped: swapped, tails: tails };
  }

  /** "1.4 s", one decimal at most. */
  function secondsText(v) {
    return typeof v === "number" ? (Math.round(v * 10) / 10) + " s" : "?";
  }

  /** True only on this keyframe entry's own explicit `plate_count.clean === false`. */
  function keyframeUnclean(kf) {
    if (!kf || typeof kf !== "object") return false;
    var pc = kf.plate_count;
    return !!pc && typeof pc === "object" && !Array.isArray(pc) && pc.clean === false;
  }

  var STILL_EXTRA_PERSON = "This still may show an extra person. Regenerate it to try again.";

  /** The warnings beside ONE shot's still, in plain words. Empty for the common, clean case. */
  function shotWarnings(output, shotId, kf) {
    var out = [];
    var id = isNonEmptyString(shotId) ? String(shotId).trim() : "";
    if (keyframeUnclean(kf) || (!!id && plateUncleanShots(output).indexOf(id) !== -1)) out.push(STILL_EXTRA_PERSON);
    if (id && isOutput(output)) {
      var cv = parseContentValidation(output.content_validation);
      if (cv && cv.failedShots.indexOf(id) !== -1) out.push("This clip failed the picture check and may look wrong.");
    }
    return out;
  }

  /** The warning lines for a render row, from every signal that reported a problem. Each line is
   *  `{ text, reasons }`: our sentence, plus the studio's reasons verbatim (content check only). */
  function renderSignalLines(output) {
    var out = [];
    if (!isOutput(output)) return out;
    var cv = parseContentValidation(output.content_validation);
    if (cv && (cv.failed > 0 || cv.unmeasured > 0)) {
      var parts = [];
      if (cv.failed > 0) parts.push(cv.failed + " clip" + (cv.failed === 1 ? "" : "s") + " failed the picture check and may look wrong.");
      if (cv.unmeasured > 0) parts.push(cv.unmeasured + " clip" + (cv.unmeasured === 1 ? " was" : "s were") + " not checked for picture problems.");
      out.push({ text: parts.join(" "), reasons: cv.reasons });
    }
    var pc = parsePlateCheck(output.plate_check);
    if (pc && pc.shots.length) {
      var k = pc.shots.length;
      out.push({
        text: (k === 1 ? "1 still" : k + " stills") + " may show an extra person (" + pc.shots.join(", ") + "). Regenerate "
          + (k === 1 ? "that still" : "those stills") + " to try again.",
        reasons: [],
      });
    }
    var kfi = parseKeyframesIncomplete(output.keyframes_incomplete);
    if (kfi && kfi.missing > 0) {
      var m = kfi.missing;
      var of = kfi.expected > 0 ? " of " + kfi.expected : "";
      out.push({
        text: m + of + " shot" + (m === 1 && !of ? "" : "s") + " got no still, so this film was made without "
          + (m === 1 ? "it" : "them") + (kfi.shots.length ? " (" + kfi.shots.join(", ") + ")" : "") + ".",
        reasons: [],
      });
    }
    // vivijure-cf#930: same sentences as vivijure-cf's panel (finish-degrade.js stageSummary, door_fit).
    var df = parseDoorFit(output.door_fit);
    if (df) {
      for (var a = 0; a < df.swapped.length; a++) {
        var sw = df.swapped[a];
        out.push({
          text: sw.shot_id + " was made on " + sw.to + ", not " + sw.from + ": its " + secondsText(sw.line_seconds)
            + " line is shorter than the " + secondsText(sw.clip_seconds) + " clip " + sw.from
            + " makes, and the speaker would keep mouthing words after it.",
          reasons: [],
        });
      }
      for (var b = 0; b < df.tails.length; b++) {
        var tl = df.tails[b];
        out.push({
          text: tl.shot_id + ": its " + secondsText(tl.line_seconds) + " line ends before the " + secondsText(tl.clip_seconds)
            + " clip on " + tl.door + ", so the speaker keeps mouthing words after it.",
          reasons: [],
        });
      }
    }
    return out;
  }

  /** `output.keyframe_reuse` (core 1.45.0, core#532): `{ stills, reused: [shot_id] }`, the stills the
   *  backend returned from its store instead of drawing. Absent when none was reused, so absent, junk
   *  and an empty list are null. Absent cannot tell a door that never reports the mark from one that
   *  drew every still. */
  function parseKeyframeReuse(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (typeof raw.stills !== "number" || !isFinite(raw.stills) || raw.stills < 0) return null;
    if (!Array.isArray(raw.reused)) return null;
    var reused = [];
    for (var i = 0; i < raw.reused.length; i++) {
      var id = raw.reused[i];
      if (typeof id === "string" && id && reused.indexOf(id) === -1) reused.push(id);
    }
    if (!reused.length) return null;
    return { stills: Math.max(raw.stills, reused.length), reused: reused };
  }

  function keyframeReusedShots(output) {
    if (!isOutput(output)) return [];
    var parsed = parseKeyframeReuse(output.keyframe_reuse);
    return parsed ? parsed.reused : [];
  }

  /** True when this still came back from the store: its own `reused: true`, or the render-level list. */
  function keyframeReused(output, kf) {
    if (kf && kf.reused === true) return true;
    var id = kf && typeof kf.shot_id === "string" ? kf.shot_id : "";
    return !!id && keyframeReusedShots(output).indexOf(id) !== -1;
  }

  var STILL_REUSED_TAG = "reused";
  var STILL_REUSED_TITLE = "This still came back from an earlier render with the same settings. It was not redrawn.";
  var NEW_PICTURE_HINT = "To get a different picture, set a new keyframe seed and render again. A seed of -1 draws the same picture every time.";

  /** One line for a render row that reused any still, or "" when none was. */
  function reuseNote(output) {
    if (!isOutput(output)) return "";
    var parsed = parseKeyframeReuse(output.keyframe_reuse);
    if (!parsed) return "";
    var n = parsed.reused.length;
    var lead = n === parsed.stills
      ? (n === 1 ? "The still was" : "All " + n + " stills were")
      : n + " of " + parsed.stills + " stills " + (n === 1 ? "was" : "were");
    return lead + " reused from an earlier render with the same settings, not redrawn. " + NEW_PICTURE_HINT;
  }

  return {
    NO_REASON: NO_REASON,
    clipsFrom: clipsFrom,
    degradeFrom: degradeFrom,
    deliverable: deliverable,
    deliveredSummary: deliveredSummary,
    parseContentValidation: parseContentValidation,
    parsePlateCheck: parsePlateCheck,
    parseKeyframesIncomplete: parseKeyframesIncomplete,
    parseDoorFit: parseDoorFit,
    plateUncleanShots: plateUncleanShots,
    keyframeUnclean: keyframeUnclean,
    shotWarnings: shotWarnings,
    renderSignalLines: renderSignalLines,
    STILL_EXTRA_PERSON: STILL_EXTRA_PERSON,
    parseKeyframeReuse: parseKeyframeReuse,
    keyframeReusedShots: keyframeReusedShots,
    keyframeReused: keyframeReused,
    reuseNote: reuseNote,
    STILL_REUSED_TAG: STILL_REUSED_TAG,
    STILL_REUSED_TITLE: STILL_REUSED_TITLE,
    NEW_PICTURE_HINT: NEW_PICTURE_HINT,
  };
});
