/**
 * notify-email composition (ported from vivijure/modules/notify-email/notify.ts).
 */
import type { NotifyInput } from "@skyphusion-labs/vivijure-core/modules/types";

export const FROM = { email: "render@skyphusion.org", name: "Vivijure" } as const;

const MAX_EMAIL_FIELD = 200;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clampField(s: string): string {
  return s.length > MAX_EMAIL_FIELD ? `${s.slice(0, MAX_EMAIL_FIELD)}...` : s;
}

export function renderCompleteEmail(input: NotifyInput): { subject: string; html: string; text: string } {
  const title = clampField(input.project || "your film");
  const url = input.download_url || "";
  return {
    subject: `Your film "${title}" is ready`,
    text: `Your Vivijure render "${title}" is complete.\n\nDownload (link valid 24 hours):\n${url}\n`,
    html:
      `<p>Your Vivijure render <strong>"${escapeHtml(title)}"</strong> is complete.</p>` +
      `<p><a href="${escapeHtml(url)}">Download your film</a> (link valid for 24 hours).</p>`,
  };
}
