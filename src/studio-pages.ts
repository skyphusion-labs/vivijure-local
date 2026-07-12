// Pretty studio page paths -> public/*.html (parity with vivijure STUDIO_PAGE_ASSETS).

export const STUDIO_PAGE_ASSETS: Record<string, string> = {
  "/": "/modules.html",
  "/index.html": "/modules.html",
  "/planner": "/planner.html",
  "/planner/": "/planner.html",
  "/cast": "/cast.html",
  "/cast/": "/cast.html",
  "/modules": "/modules.html",
  "/modules/": "/modules.html",
  "/settings": "/settings.html",
  "/settings/": "/settings.html",
};

export function resolveStudioPage(pathname: string): string | null {
  return STUDIO_PAGE_ASSETS[pathname] ?? null;
}
