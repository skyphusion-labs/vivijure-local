// Types for the pure helpers in render-hook-gaps.js (local#291).
// Hand-authored (no build step) so tests typecheck under the CI tsc gate.

/** One entry of the panel's hook list: the hook name plus whether it resolves to ONE module
 *  (pick_one) or folds every installed module (chain). Both come from GET /api/modules `catalog`. */
export interface PanelHook {
  hook: string;
  pickOne: boolean;
}

/** A GET /api/modules `catalog` row. Only `name` and `blurb` are read here. */
export interface CatalogRow {
  name?: unknown;
  blurb?: unknown;
  cardinality?: unknown;
  order?: unknown;
}

export interface HookGap {
  /** The first hook this note covers. */
  hook: string;
  /** Every hook this note covers. More than one when the host gave them the same reason. */
  hooks: string[];
  /** The line to render. VERBATIM from the host when source is "host". */
  text: string;
  source: "host" | "empty-chain";
}

export function blurbFor(catalog: unknown, hook: string): string;
export function emptyChainNote(hook: string, blurb: string): string;
export function gaps(
  panelHooks: PanelHook[] | null | undefined,
  catalog: CatalogRow[] | null | undefined,
  hooksIndex: Record<string, string[]> | null | undefined,
  unavailable?: Record<string, string> | null,
): HookGap[];
