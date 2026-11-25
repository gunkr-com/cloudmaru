export type ExplorerValue = string | number | null;
export type ExplorerRow = { id: string; values: Record<string, ExplorerValue>; labels?: Record<string, string>; order?: Record<string, number> };
export type ExplorerState = { q: string; filters: Record<string, string>; sort: string; direction: "asc" | "desc"; page: number };
export function countValues(rows: ExplorerRow[], key: string) {
  const counts = new Map<string, number>();
  for (const row of rows) { const value = String(row.values[key] ?? ""); counts.set(value, (counts.get(value) ?? 0) + 1); }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
export function exploreRows<T extends ExplorerRow>(rows: T[], state: ExplorerState, pageSize = 50) {
  const q = state.q.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => Object.entries(state.filters).every(([key, value]) => String(row.values[key] ?? "") === value)
    && (!q || [row.id, ...Object.values(row.values), ...Object.values(row.labels ?? {})].join(" ").toLocaleLowerCase().includes(q)));
  filtered.sort((a, b) => {
    const av = a.order?.[state.sort] ?? a.values[state.sort], bv = b.order?.[state.sort] ?? b.values[state.sort];
    const order = av === bv ? 0 : av === null || av === undefined ? 1 : bv === null || bv === undefined ? -1
      : typeof av === "number" && typeof bv === "number" ? av - bv : String(a.labels?.[state.sort] ?? av).localeCompare(String(b.labels?.[state.sort] ?? bv));
    return (state.direction === "desc" ? -order : order) || a.id.localeCompare(b.id);
  });
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.min(pageCount, Math.max(1, Number.isInteger(state.page) ? state.page : 1));
  return { rows: filtered.slice((page - 1) * size, page * size), all: filtered, matched: filtered.length, page, pageCount };
}
export function readExplorerState(params: URLSearchParams, scope: string, columns: string[], facets: Record<string, string[]>): ExplorerState {
  const key = (name: string) => params.get(`${scope}_${name}`) ?? "";
  const filters: Record<string, string> = {};
  for (const [name, values] of Object.entries(facets)) if (params.has(`${scope}_${name}`) && values.includes(key(name))) filters[name] = key(name);
  const page = Number(key("page"));
  return { q: key("q").slice(0, 200), filters, sort: columns.includes(key("sort")) ? key("sort") : columns[0], direction: key("direction") === "desc" ? "desc" : "asc", page: Number.isSafeInteger(page) && page > 0 ? page : 1 };
}
export function writeExplorerState(params: URLSearchParams, scope: string, state: ExplorerState) {
  const next = new URLSearchParams(params);
  for (const key of [...next.keys()]) if (key.startsWith(`${scope}_`)) next.delete(key);
  if (state.q) next.set(`${scope}_q`, state.q);
  for (const [key, value] of Object.entries(state.filters)) next.set(`${scope}_${key}`, value);
  if (state.sort) next.set(`${scope}_sort`, state.sort);
  if (state.direction === "desc") next.set(`${scope}_direction`, "desc");
  if (state.page > 1) next.set(`${scope}_page`, String(state.page));
  return next;
}
export function csvDocument(headers: string[], rows: ExplorerValue[][]): string {
  const cell = (value: ExplorerValue) => {
    let text = String(value ?? "");
    if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n");
}
export function signedCostGroups<T extends { currency: string; amount: number }>(rows: T[]) {
  return [...new Set(rows.map(row => row.currency))].sort().flatMap(currency => (["positive", "negative", "zero"] as const).flatMap(sign => {
    const selected = rows.filter(row => row.currency === currency && (row.amount > 0 ? "positive" : row.amount < 0 ? "negative" : "zero") === sign);
    return selected.length ? [{ currency, sign, rows: selected }] : [];
  }));
}
