import "server-only";
import { z } from "zod";
import { CONTAINERS_QUERY, RESOURCES_QUERY } from "@/lib/inventory/arg-query";
import { AzureRequestError, azureRequest, type AzureRequestDeps } from "./request";

// REST 규격: https://learn.microsoft.com/en-us/rest/api/azureresourcegraph/resourcegraph/resources/resources?view=rest-azureresourcegraph-resourcegraph-2022-10-01
const RESOURCE_GRAPH_PATH = "/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01";
const pageSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  $skipToken: z.string().optional(),
});

export async function queryResourceGraph(
  args: { subscriptions: string[]; query: string },
  deps: AzureRequestDeps & { maxPages?: number; maxRows?: number },
): Promise<unknown[]> {
  const maxPages = deps.maxPages ?? 100;
  const maxRows = deps.maxRows ?? 50_000;
  if (!args.subscriptions.length || args.subscriptions.some((id) => !id.trim())
    || !Number.isSafeInteger(maxPages) || maxPages <= 0
    || !Number.isSafeInteger(maxRows) || maxRows <= 0) {
    throw new AzureRequestError("disallowed");
  }
  const rows: unknown[] = [];
  let skipToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const response = await azureRequest({
      method: "POST",
      path: RESOURCE_GRAPH_PATH,
      body: {
        subscriptions: args.subscriptions,
        query: args.query,
        options: { $top: 1000, resultFormat: "objectArray", ...(skipToken === undefined ? {} : { $skipToken: skipToken }) },
      },
    }, deps);
    const parsed = pageSchema.safeParse(response);
    if (!parsed.success) throw new AzureRequestError("invalid-response");
    if (rows.length + parsed.data.data.length > maxRows) throw new AzureRequestError("too-many-rows");
    rows.push(...parsed.data.data);
    skipToken = parsed.data.$skipToken;
    if (!skipToken) return rows;
  }
  // 부분 인벤토리를 완전한 결과로 취급하지 않는다.
  throw new AzureRequestError("invalid-response");
}

// 가져오기와 같은 상한: 리소스와 컨테이너를 합해 50,000행.
export const INVENTORY_MAX_ROWS = 50_000;

export async function collectInventoryRows(
  subscriptions: string[], deps: AzureRequestDeps,
): Promise<{ resourceRows: unknown[]; containerRows: unknown[] }> {
  const resourceRows = await queryResourceGraph({ subscriptions, query: RESOURCES_QUERY }, { ...deps, maxRows: INVENTORY_MAX_ROWS });
  const remaining = INVENTORY_MAX_ROWS - resourceRows.length;
  if (remaining <= 0) throw new AzureRequestError("too-many-rows");
  const containerRows = await queryResourceGraph({ subscriptions, query: CONTAINERS_QUERY }, { ...deps, maxRows: remaining });
  return { resourceRows, containerRows };
}
