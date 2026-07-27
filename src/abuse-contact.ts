// WHERE A REPORTER IS SENT, ON A STUDIO WHOSE READER IS ITS OPERATOR (control-plane#130 twin).
//
// SAME-WAVE PARITY TWIN of vivijure-cf src/abuse-contact.ts. Parity is the SET and the BIAS, never
// the bytes, so what is identical here is the CONTRACT (an optional operator var projected as
// host.abuse_report_url on GET /api/modules, refused unless it is an absolute http(s) URL) and what
// differs is who the reader is.
//
// THE CONSTRAINT THAT DECIDES THE DESIGN IS THE SAME ONE, arrived at from the other end. On the
// hosted panel the rule is "our abuse address must never ship inside the bundle a self-hoster
// installs". THIS IS THAT BUNDLE. So the rule is not inherited politeness, it is the local panel own
// requirement: nothing about anyone else abuse channel belongs in this code, and a self-hoster who
// wants their own contact published sets the var and their panel shows theirs.
//
// WHAT IS DIFFERENT HERE, and it is the reason this is not a straight copy: on vivijure-cf the
// reader is a hosted TENANT who cannot set the var and must not be told to. Here the reader IS the
// operator, so the same absence means something else -- not "nobody told you where to report" but
// "you have not published a contact for your own studio yet". The panel says nothing either way; the
// difference lives in the Settings catalog entry, which names the knob for the person who can turn
// it (platform-secrets-catalog.ts), exactly as this panel does for every other operator var.

/** The narrow env this reads. Kept narrow so a test cannot satisfy it by accident with a whole env. */
export interface AbuseContactEnv {
  ABUSE_REPORT_URL?: string;
}

/**
 * The report destination for this studio, or null when there is none to advertise.
 *
 * REFUSES RATHER THAN PASSES THROUGH, identical to the hosted twin because the hazard is identical:
 * a host-payload string ends up in an href, so the scheme check is a real DOM boundary rather than
 * tidiness (`javascript:` and `data:` are the reason), and a relative path is dropped because it
 * would resolve against the STUDIO origin and send a reporter to a page that does not exist there.
 *
 * The refusal is LOUD on the server side on purpose. A silently ignored misconfiguration is how an
 * operator sets a var, sees nothing happen, and concludes the feature is broken -- and on THIS panel
 * that operator is the person reading the log, so the message is the whole repair path.
 */
export function abuseReportUrl(env: AbuseContactEnv): string | null {
  const raw = (env.ABUSE_REPORT_URL ?? "").trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    console.warn("abuse_report_url ignored: not an absolute URL", { value: raw });
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    console.warn("abuse_report_url ignored: scheme is not http(s)", { scheme: parsed.protocol });
    return null;
  }
  return parsed.toString();
}
