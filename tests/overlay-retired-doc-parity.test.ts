// The /overlay retirement (cf#24 parity) left three artifacts describing a route that no
// longer serves, and one justification pointing at it. A removal that stops at the code is
// the shape that reads as complete: the code is right, and every document a reader consults
// still says the old thing.
//
// What was left behind:
//   README.md:5   summary line listed overlay among the served film.finish text routes
//   README.md:41  the ROUTE TABLE presented it as live, 27 lines below the same file
//                 saying it is retired (410) -- a file contradicting itself, each line
//                 plausible on its own, and the table is the part a reader consults
//   app.py:16     `import base64`, 1 occurrence in the file, zero uses
//   Dockerfile    fonts-dejavu-core + fontconfig justified ENTIRELY by "the /overlay route
//                 added in #190"
//
// The Dockerfile one is the dangerous member and it is not a docs nit. /film-titles builds
// drawtext filters with font="DejaVu Sans" -- a NAME, so fontconfig's alias resolution is
// what turns it into a file. Both packages are load-bearing for a LIVE route. Anyone trimming
// the image would have read a justification naming a retired route, concluded the packages
// were dead with it, and broken title and credit cards. A justification pointing at a dead
// consumer is worse than none: it invites the removal it looks like it guards against.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (p: string): string => readFileSync(resolve(root, p), "utf8");

const README = "containers/video-finish/README.md";
const APP = "containers/video-finish/app.py";
const DOCKERFILE = "containers/video-finish/Dockerfile";

describe("/overlay retirement is finished in the documents too", () => {
  it("CONTROL: all three artifacts read, and are non-trivial", () => {
    // Denominator beside the claim. An empty read makes every absence below vacuous.
    for (const p of [README, APP, DOCKERFILE]) {
      const n = read(p).split("\n").filter((l) => l.trim() !== "").length;
      expect(n, `${p} read as ${n} non-blank lines`).toBeGreaterThan(10);
    }
  });

  it("the route table does not present /overlay as live", () => {
    const rows = read(README)
      .split("\n")
      .filter((l) => /^\|\s*`\/overlay`\s*\|/.test(l));
    // Control: the table row exists at all, so a pass is not "the row vanished".
    expect(rows.length, "no /overlay row found; did the table format change?").toBe(1);
    expect(
      rows[0],
      `the table is what a reader consults, and it still described a retired route: ${rows[0]}`,
    ).toMatch(/RETIRED|410/i);
  });

  it("the README does not list overlay among the routes it serves", () => {
    const md = read(README);
    expect(md).not.toMatch(/text routes \(overlay/);
    // Control: the sentence still exists, so the absence above is about the word and not
    // about the sentence having been deleted.
    expect(md).toMatch(/text routes \(title\/credit cards, subtitles\)/);
  });

  it("app.py has no unused base64 import left over from the removal", () => {
    const py = read(APP);
    const imports = py.split("\n").filter((l) => /^(import|from)\s/.test(l));
    expect(imports.length, "no import lines found; did the file move?").toBeGreaterThan(5);
    const usesBase64 = py.split("\n").filter((l) => /\bbase64\b/.test(l) && !/^import\s/.test(l));
    const importsBase64 = imports.filter((l) => /\bbase64\b/.test(l));
    expect(
      `imports=${importsBase64.length} uses=${usesBase64.length}`,
      "an import with zero uses is what a removal leaves behind",
    ).toBe("imports=0 uses=0");
  });

  // THE ONE THAT MATTERS. Not a docs assertion: a real coupling that reddens if the image
  // is trimmed on the strength of the retired route.
  it("COUPLING: drawtext uses font NAMES, so the image must install the font stack", () => {
    const py = read(APP);
    const nameFonts = py.split("\n").filter((l) => /drawtext=font='/.test(l));
    // Denominator FIRST: if this is zero the coupling no longer exists and the assertion
    // below would pass vacuously.
    expect(
      nameFonts.length,
      "no drawtext font=<name> usage found; if that is deliberate, this guard is obsolete",
    ).toBeGreaterThan(0);

    const df = read(DOCKERFILE);
    const install = df.split(/^RUN apt-get update/m)[1]?.split(/rm -rf/)[0] ?? "";
    expect(install.length, "could not isolate the apt-get install block").toBeGreaterThan(10);
    expect(
      install,
      `${nameFonts.length} drawtext font=<name> call(s) need fontconfig's alias resolution`,
    ).toMatch(/fontconfig/);
    expect(install, "font=<name> resolves to a file that must be installed").toMatch(
      /fonts-dejavu-core/,
    );
    // Control: the scoped matcher can return a negative.
    expect(install).not.toMatch(/imagemagick/);
  });

  it("the Dockerfile justifies the font stack by a LIVE consumer, not the retired route", () => {
    const df = read(DOCKERFILE);
    expect(
      df,
      "a justification naming only a retired route invites the removal it looks like it guards",
    ).toMatch(/film-titles/);
  });
});
