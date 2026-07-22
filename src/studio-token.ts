export const STUDIO_API_TOKEN_PLACEHOLDER = "change-me-local-dev-only";

export function isStudioApiTokenPlaceholder(value: string | undefined): boolean {
  const v = (value ?? "").trim();
  return !v || v === STUDIO_API_TOKEN_PLACEHOLDER;
}
