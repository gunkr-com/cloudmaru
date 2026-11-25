export type ShellNavKey = "overview" | "new" | "history" | "inventory" | "assessments" | "network" | "extensions" | "workspaces";

export const OVERVIEW_HREF = "/overview";
export const NEW_ANALYSIS_HREF = "/analyses/new";
export const HISTORY_HREF = "/analyses";
export const INVENTORY_HREF = "/inventory";

export const ASSESSMENTS_HREF = "/assessments";
export const NETWORK_HREF = "/network";
export const EXTENSIONS_HREF = "/extensions";

export function getActiveNavKey(pathname: string): ShellNavKey | null {
  if (pathname === OVERVIEW_HREF || pathname.startsWith(`${OVERVIEW_HREF}/`)) return "overview";
  if (pathname === NEW_ANALYSIS_HREF || pathname.startsWith(`${NEW_ANALYSIS_HREF}/`)) return "new";
  if (pathname === HISTORY_HREF || pathname.startsWith(`${HISTORY_HREF}/`)) return "history";
  if (pathname === INVENTORY_HREF || pathname.startsWith(`${INVENTORY_HREF}/`)) return "inventory";
  for (const [href, key] of [[ASSESSMENTS_HREF, "assessments"], [NETWORK_HREF, "network"], [EXTENSIONS_HREF, "extensions"]] as const) {
    if (pathname === href || pathname.startsWith(`${href}/`)) return key;
  }
  if (pathname === "/workspaces" || pathname.startsWith("/workspaces/")) return "workspaces";
  return null;
}
