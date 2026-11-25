import { readFile, mkdir, mkdtemp, open, realpath, rename, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { componentSchema, priceSnapshotSchema } from "../src/lib/catalog/schema";
import { operatorPricesPath, validateOperatorPrices } from "../src/services/operator-prices";
import { SUPPORTED_REGIONS } from "../src/lib/workspace/regions";
import type { Component, PriceSnapshot } from "../src/types/catalog";

export type RetailPriceRow = {
  meterId: string; productName: string; skuName: string; meterName: string;
  type: string; tierMinimumUnits: number; unitOfMeasure: string;
  retailPrice: number; currencyCode: string; armRegionName: string;
};
const pageSchema = z.object({ Items: z.array(z.object({ type: z.string() }).passthrough()), NextPageLink: z.url().nullable() });
const koreanErrors = { error: z.locales.ko().localeError };
type Entry = PriceSnapshot["prices"][string][string];
type Wait = (milliseconds: number) => Promise<void>;
const sleep: Wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function buildPriceQueryUrl(pricing: Extract<Component["pricing"], { kind: "metered" }>, region: string, currency: "CAD" | "USD"): string {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const fields = { armRegionName: pricing.priceRegion ?? region, productName: pricing.productName, skuName: pricing.skuName, meterName: pricing.meterName };
  const url = new URL("https://prices.azure.com/api/retail/prices");
  url.searchParams.set("currencyCode", quote(currency));
  url.searchParams.set("$filter", Object.entries(fields).map(([key, value]) => `${key} eq ${quote(value)}`).join(" and "));
  return url.href;
}

export function selectPriceEntry(component: Component, rows: RetailPriceRow[], region: string, currency: "CAD" | "USD"): Entry {
  const { pricing } = component;
  if (pricing.kind !== "metered") throw new Error("무료 구성요소에는 가격 항목을 만들 수 없습니다.");
  const consumption = rows.filter(row => row.type === "Consumption");
  if (consumption.length === 0) throw new Error("Consumption 가격 행이 없습니다.");
  for (const row of consumption) {
    const expected = { productName: pricing.productName, skuName: pricing.skuName, meterName: pricing.meterName, unitOfMeasure: pricing.unitOfMeasure, armRegionName: pricing.priceRegion ?? region, currencyCode: currency };
    for (const [field, value] of Object.entries(expected)) {
      if (row[field as keyof RetailPriceRow] !== value) throw new Error(`${field} 불일치: 예상 ${value}, 응답 ${row[field as keyof RetailPriceRow]}`);
    }
  }
  if (new Set(consumption.map(row => row.meterId)).size !== 1) throw new Error("meterId가 여러 개입니다.");
  const entry = { meterId: consumption[0].meterId, unitOfMeasure: pricing.unitOfMeasure, tiers: consumption.map(row => ({ minUnits: row.tierMinimumUnits, unitPrice: row.retailPrice })).sort((a, b) => a.minUnits - b.minUnits) };
  return priceSnapshotSchema.shape.prices.parse({ [component.id]: { [region]: entry } }, koreanErrors)[component.id][region];
}

export async function syncPrices(components: Component[], fetchImpl: typeof fetch, today: string, wait: Wait = sleep): Promise<PriceSnapshot> {
  const regions = SUPPORTED_REGIONS.map(region => region.id);
  const pairs: { id: string; region: string; cad: Entry; usd: Entry }[] = [];
  const ratios: number[] = [];
  async function query(component: Component, region: string, currency: "CAD" | "USD") {
    if (component.pricing.kind !== "metered") throw new Error("무료 구성요소");
    let url: string | null = buildPriceQueryUrl(component.pricing, region, currency);
    const visited = new Set<string>(); const rows: RetailPriceRow[] = [];
    while (url !== null) {
      const pageUrl = new URL(url);
      if (pageUrl.origin !== "https://prices.azure.com" || pageUrl.username || pageUrl.password) {
        throw new Error("Invalid Azure Retail Prices pagination URL");
      }
      if (visited.has(url)) throw new Error("다음 페이지 주소가 반복됩니다.");
      visited.add(url);
      let response: Response;
      let retries = 0;
      while (true) {
        await wait(300);
        response = await fetchImpl(url, { redirect: "error" });
        if (response.status !== 429 || retries >= 5) break;
        retries++;
        const retryAfter = response.headers.get("Retry-After");
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const dateDelay = retryAfter === null ? NaN : Date.parse(retryAfter) - Date.now();
        await wait(Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Number.isFinite(dateDelay) ? Math.max(0, dateDelay) : 5000 * retries);
      }
      if (!response.ok) throw new Error(`가격 API HTTP ${response.status}`);
      const page = pageSchema.parse(await response.json(), koreanErrors);
      rows.push(...page.Items as RetailPriceRow[]);
      url = page.NextPageLink;
    }
    return selectPriceEntry(component, rows, region, currency);
  }
  for (const component of [...components].sort((a, b) => a.id.localeCompare(b.id))) {
    if (component.pricing.kind === "free") continue;
    // 지역 무관 미터는 같은 행을 한 번만 조회하고 각 스냅샷 지역에 적용한다.
    const queryRegions = component.pricing.priceRegion ? [regions[0]] : regions;
    for (const region of queryRegions) {
      try {
        const cad = await query(component, region, "CAD");
        const usd = await query(component, region, "USD");
        if (JSON.stringify(cad.tiers.map(t => t.minUnits)) !== JSON.stringify(usd.tiers.map(t => t.minUnits))) throw new Error("CAD/USD 구간 불일치");
        if (cad.meterId !== usd.meterId) throw new Error("CAD/USD meterId 불일치");
        cad.tiers.forEach((tier, i) => { if (tier.unitPrice >= 0.1 && usd.tiers[i].unitPrice > 0) ratios.push(tier.unitPrice / usd.tiers[i].unitPrice); });
        for (const target of component.pricing.priceRegion ? regions : [region]) pairs.push({ id: component.id, region: target, cad, usd });
      } catch (error) { throw new Error(`가격 동기화 실패 (저장하지 않음): ${component.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  if (ratios.length < 5) throw new Error("환율 근거 쌍이 5개 미만입니다.");
  ratios.sort((a, b) => a - b);
  const middle = Math.floor(ratios.length / 2);
  const rate = ratios.length % 2 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2;
  if (ratios.some(ratio => Math.abs(ratio / rate - 1) > 0.01)) throw new Error("환율 비율이 중앙값에서 1% 넘게 벗어납니다.");
  const prices: PriceSnapshot["prices"] = {};
  for (const { id, region, cad, usd } of pairs) {
    prices[id] ??= {};
    prices[id][region] = { ...cad, tiers: cad.tiers.map((tier, i) => {
      if (usd.tiers[i].unitPrice === 0) return { ...tier, unitPrice: 0 };
      if (tier.unitPrice >= 0.005) return tier;
      return { ...tier, unitPrice: Number((usd.tiers[i].unitPrice * rate).toPrecision(10)), convertedFromUsd: true };
    }) };
  }
  return priceSnapshotSchema.parse({ asOf: today, currency: "CAD", regions, usdToCad: { rate, pairs: ratios.length }, prices }, koreanErrors);
}

function checkWritablePriceTarget(file: string): void {
  const checkout = fileURLToPath(new URL("..", import.meta.url));
  const candidate = relative(checkout, file);
  if (candidate === ".." || candidate.startsWith("../") || isAbsolute(candidate)) return;
  if (["src", "public", ".git", "node_modules", ".next"].includes(candidate.split("/")[0])) {
    throw new Error("Select a pricing path outside application source and build files");
  }
  const gitOptions = { cwd: checkout, encoding: "utf8" as const, stdio: ["ignore", "pipe", "ignore"] as const };
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { ...gitOptions, stdio: "ignore" });
  } catch (error) {
    // Release archives may be installed without a Git checkout or binary.
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as { status?: number }).status === 128) return;
    throw error;
  }
  const tracked = execFileSync("git", ["--literal-pathspecs", "ls-files", "--", candidate], { ...gitOptions, stdio: "pipe" });
  if (tracked) throw new Error("Select an untracked pricing path");
}

export async function writeOperatorSnapshot(snapshot: PriceSnapshot, file = operatorPricesPath()): Promise<void> {
  const validated = validateOperatorPrices(snapshot);
  if (!validated.ok) throw new Error(`Invalid operator pricing: ${validated.reason}`);
  if (!isAbsolute(file)) throw new Error("The pricing path must be absolute");
  const directory = dirname(file);
  checkWritablePriceTarget(file);
  // Resolve the nearest existing ancestor before creating any directories, including through symlinks.
  let ancestor = directory;
  for (;;) {
    try {
      const actual = await realpath(ancestor);
      checkWritablePriceTarget(resolve(actual, relative(ancestor, file)));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || ancestor === dirname(ancestor)) throw error;
      ancestor = dirname(ancestor);
    }
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(await realpath(directory), basename(file));
  checkWritablePriceTarget(target);
  const scratch = await mkdtemp(join(dirname(target), ".prices-"));
  const temporary = join(scratch, "snapshot.json");
  try {
    const handle = await open(temporary, "wx", 0o640);
    try {
      await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await handle.chmod(0o640);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function main() {
  const file = operatorPricesPath();
  checkWritablePriceTarget(file);
  const components = z.array(componentSchema).parse(JSON.parse(await readFile(new URL("../src/catalog/components.json", import.meta.url), "utf8")), koreanErrors);
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const snapshot = await syncPrices(components, fetch, today);
  await writeOperatorSnapshot(snapshot, file);
  console.log(`가격 동기화 완료: ${Object.keys(snapshot.prices).length}개 구성요소, 기준일 ${today}, 환율 ${snapshot.usdToCad.rate} (${snapshot.usdToCad.pairs}쌍)`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
