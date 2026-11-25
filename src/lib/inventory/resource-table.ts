import type { ResourceTablePage, ResourceTableQuery } from "@/types/inventory";
import type { ScanInventory } from "@/types/scan";

export const RESOURCE_TABLE_PAGE_SIZE = 50;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export function parseResourceTableQuery(searchParams: Record<string, string | string[] | undefined>): ResourceTableQuery {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const page = Number(first(searchParams.page));
  return {
    q: first(searchParams.q).trim().slice(0, 200),
    type: first(searchParams.type).toLowerCase() || null,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

export function queryInventoryResources(inventory: ScanInventory, query: ResourceTableQuery, pageSize = RESOURCE_TABLE_PAGE_SIZE): ResourceTablePage {
  const counts = new Map<string, number>();
  for (const resource of inventory.resources) counts.set(resource.type, (counts.get(resource.type) ?? 0) + 1);
  const types = [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => compare(a.type, b.type));
  // 존재하지 않는 타입은 모든 종류로 취급한다. 파서에는 인벤토리가 없으므로 여기서 검증한다.
  const type = query.type && counts.has(query.type) ? query.type : null;
  const q = query.q.toLowerCase();
  const matches = inventory.resources.filter(row => (!type || row.type === type) && (!q || row.name.toLowerCase().includes(q) || row.id.toLowerCase().includes(q)))
    .sort((a, b) => compare(a.type, b.type) || compare(a.name, b.name) || compare(a.id, b.id));
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : RESOURCE_TABLE_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(matches.length / size));
  const page = Math.min(pageCount, Number.isInteger(query.page) && query.page >= 1 ? query.page : 1);
  const offset = (page - 1) * size;
  const subscriptions = new Map(inventory.containers.filter(row => row.kind === "subscription").map(row => [row.subscriptionId, row.name]));
  const rows = matches.slice(offset, offset + size).map(row => ({
    id: row.id, name: row.name, type: row.type, resourceGroup: row.resourceGroup, location: row.location,
    subscriptionId: row.subscriptionId, subscriptionName: subscriptions.get(row.subscriptionId) ?? null, tagCount: Object.keys(row.tags).length,
  }));
  return { rows, total: inventory.resources.length, matched: matches.length, page, pageCount, from: matches.length ? offset + 1 : 0, to: Math.min(offset + size, matches.length), types, appliedType: type };
}
