// Pure helpers for the EMPTY-HOOK projection in the planner render panel (local#291). No DOM:
// unit-tested under plain Node (tests/finish-rife-not-local-291.test.ts) and loaded as a classic
// <script> as `window.renderHookGaps`. Same UMD-ish shape as hook-availability-checks.js /
// finish-degrade.js / cast-select.js / model-catalog.js. No framework, no build step.
//
// THE PROBLEM THIS EXISTS FOR (local#291):
// The panel is a projection of the registry, so a hook with no serving module projects to NOTHING --
// no section, no line, no trace. The render panel was therefore silent about steps this studio does
// not run. That silence is only correct if the reader already knows the pipeline, and the reader who
// most needs to know is exactly the one who does not.
//
// local#291 arrived from the other end of the same wire: finish-rife was STOOD UP in the documented
// local fleet while having no local implementation at all, so the finish step rendered a full set of
// RIFE knobs whose only path was a cloud call. Removing it is the fix (an absent capability is
// absent -- local#280). But removing it turns a dishonest section into a blank space, and a blank
// space is how "vivijure-local finishes renders on CPU, without frame interpolation" reads as
// "something is missing here". The honest local answer deserves to be stated as an ANSWER.
//
// THE RULE, AND IT IS READ OFF THE CATALOG, NOT OFF FEATURE KNOWLEDGE. Nothing in this file knows
// what RIFE, finishing, or mastering are, and nothing here may ever name a module:
//
//   CHAIN hook, zero serving modules      -> an EMPTY CHAIN. The core folds every installed module
//                                            for a chain hook, so folding none is a no-op the render
//                                            passes straight through. Structurally, the render IS
//                                            delivered without it. Say so, positively.
//
//   PICK_ONE hook, zero serving modules   -> a HOLE, not an empty chain: there is no module to pick
//                                            and the step cannot run. That story belongs to the HOST
//                                            (`host.hooks_unavailable`, src/local-door-availability.ts),
//                                            which can say what to install and why. Say nothing here
//                                            rather than paper a hole over with a reassuring line.
//
// WHERE THE HOST HAS ALREADY SPOKEN, THE HOST WINS. If `host.hooks_unavailable` carries the hook, its
// reason is returned VERBATIM (never rewritten, prettified or softened -- the same doctrine
// hook-availability-checks.js and finish-degrade.js hold). Without this branch a host-declared reason
// on an empty hook has no control to attach to and would be rendered by nobody at all.
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.renderHookGaps = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  // The blurb the core publishes for a hook (GET /api/modules `catalog[].blurb`), or "" when the
  // catalog carries none. Never invented here: an unblurbed hook is named by its hook name alone.
  function blurbFor(catalog, hook) {
    var rows = Array.isArray(catalog) ? catalog : [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].name === hook) {
        return isNonEmptyString(rows[i].blurb) ? rows[i].blurb.trim() : "";
      }
    }
    return "";
  }

  // The generic empty-chain sentence. Two halves, both load-bearing:
  //   1. the FACT (no module installed for this step) -- so nobody hunts for a control that is not
  //      there, or reports the blank space as a bug;
  //   2. the OUTCOME (the render is delivered without it, and that is a complete render) -- so an
  //      empty step does not read as a broken or half-finished pipeline. local#291 item 4.
  function emptyChainNote(hook, blurb) {
    var head = blurb ? hook + " (" + blurb + ")" : hook;
    return (
      head +
      ": no module is installed for this step on this studio, so the chain is empty and the step is " +
      "skipped. Renders are delivered without it; this is a complete render, not a missing piece."
    );
  }

  /**
   * The lines the render panel should show for hooks that project to nothing.
   *
   * panelHooks   [{hook, pickOne}] in display order, as the panel already computed them.
   * catalog      GET /api/modules `catalog` (for blurbs only).
   * hooksIndex   GET /api/modules `hooks` -- {hook: [moduleName]}. The authority on "does anything
   *              serve this", because it is what the panel itself renders sections from.
   * unavailable  the normalized host.hooks_unavailable map (hookAvailabilityChecks.unavailableHooks).
   *
   * Returns [{hook, text, source}] where source is "host" (verbatim host reason) or "empty-chain".
   * Total and forgiving: junk anywhere yields [], never a wall of scary lines on a healthy studio.
   */
  function gaps(panelHooks, catalog, hooksIndex, unavailable) {
    var out = [];
    var hooks = Array.isArray(panelHooks) ? panelHooks : [];
    var index = hooksIndex && typeof hooksIndex === "object" ? hooksIndex : {};
    var un = unavailable && typeof unavailable === "object" ? unavailable : {};
    for (var i = 0; i < hooks.length; i++) {
      var h = hooks[i];
      if (!h || !isNonEmptyString(h.hook)) continue;
      // A hole is the host's story, not ours. See the header.
      if (h.pickOne) continue;
      var serving = index[h.hook];
      if (Array.isArray(serving) && serving.length > 0) continue;
      if (Object.prototype.hasOwnProperty.call(un, h.hook) && isNonEmptyString(un[h.hook])) {
        out.push({ hook: h.hook, text: un[h.hook].trim(), source: "host" });
        continue;
      }
      out.push({ hook: h.hook, text: emptyChainNote(h.hook, blurbFor(catalog, h.hook)), source: "empty-chain" });
    }
    return out;
  }

  return {
    blurbFor: blurbFor,
    emptyChainNote: emptyChainNote,
    gaps: gaps,
  };
});
