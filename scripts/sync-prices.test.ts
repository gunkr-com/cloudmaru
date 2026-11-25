// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createMeteredComponent } from "../src/lib/catalog/fixtures.test-data";
import { loadCatalog } from "../src/lib/catalog/load";
import { buildPriceQueryUrl, selectPriceEntry, syncPrices, type RetailPriceRow } from "./sync-prices";
const component = () => createMeteredComponent();
function row(currency = "CAD", overrides: Partial<RetailPriceRow> = {}): RetailPriceRow {
  const { pricing } = component();
  return { ...pricing, meterId: "meter", armRegionName: "canadacentral", type: "Consumption", currencyCode: currency, tierMinimumUnits: 0, retailPrice: currency === "CAD" ? 1.4 : 1, ...overrides };
}
function mockFetch(change: (r: RetailPriceRow, id: number) => RetailPriceRow = r => r) {
  return vi.fn<typeof fetch>(async url => {
    const query = new URL(String(url)).searchParams;
    const currency = query.get("currencyCode")!.replaceAll("'", "");
    const armRegionName = query.get("$filter")!.match(/^armRegionName eq '([^']+)'/)![1];
    const rows = Array.from({ length: 6 }, (_, id) => change(row(currency, { armRegionName, tierMinimumUnits: id * 100 }), id));
    return Response.json({ Items: rows, NextPageLink: null });
  });
}
it("queries names and priceRegion with OData escaping", () => {
  const url = new URL(buildPriceQueryUrl({ ...component().pricing, priceRegion: "Zone 1", productName: "product'name" }, "canadacentral", "USD"));
  expect(url.searchParams.get("currencyCode")).toBe("'USD'");
  expect(url.searchParams.get("$filter")).toBe("armRegionName eq 'Zone 1' and productName eq 'product''name' and skuName eq 'Test SKU' and meterName eq 'Test Meter'");
});
it("calculates median FX and marks only small nonzero USD conversions", async () => {
  const fetcher = mockFetch((r, id) => id === 5 ? { ...r, retailPrice: r.currencyCode === "CAD" ? 0 : 0.000034 } : r);
  const snapshot = await syncPrices([component()], fetcher, "2026-11-06", async () => {});
  expect(snapshot.usdToCad).toEqual({ rate: 1.4, pairs: 15 });
  expect(snapshot.regions).toEqual(["canadacentral", "westus2", "centralus"]);
  for (const region of snapshot.regions) {
    expect(snapshot.prices[component().id][region].tiers[5]).toEqual({ minUnits: 500, unitPrice: 0.0000476, convertedFromUsd: true });
  }
});
it("uses USD zero as zero and preserves CAD precision", async () => {
  const snapshot = await syncPrices([component()], mockFetch((r, id) => id === 5 ? { ...r, retailPrice: 0 } : r), "2026-11-06", async () => {});
  expect(snapshot.prices[component().id].canadacentral.tiers[5]).toEqual({ minUnits: 500, unitPrice: 0 });
});
it.each(["productName", "skuName", "meterName", "unitOfMeasure", "currencyCode", "armRegionName"] as const)("rejects mismatched %s", field => {
  expect(() => selectPriceEntry(component(), [row("CAD", { [field]: "wrong" })], "canadacentral", "CAD")).toThrow();
});
it("rejects multiple meters, invalid tiers and missing Consumption", () => {
  expect(() => selectPriceEntry(component(), [row(), row("CAD", { meterId: "other", tierMinimumUnits: 1 })], "canadacentral", "CAD")).toThrow(/meterId/);
  expect(() => selectPriceEntry(component(), [row("CAD", { tierMinimumUnits: 1 })], "canadacentral", "CAD")).toThrow();
  expect(() => selectPriceEntry(component(), [row("CAD", { type: "Reservation" })], "canadacentral", "CAD")).toThrow(/Consumption/);
});
it("rejects unmatched CAD/USD tiers", async () => {
  await expect(syncPrices([component()], mockFetch(r => r.currencyCode === "USD" && r.tierMinimumUnits === 500 ? { ...r, tierMinimumUnits: 501 } : r), "2026-11-06", async () => {})).rejects.toThrow(/구간/);
});
it("rejects fewer than five FX pairs and inconsistent ratios", async () => {
  for (const change of [(r: RetailPriceRow) => ({ ...r, retailPrice: 0 }), (r: RetailPriceRow, id: number) => id === 5 && r.currencyCode === "CAD" ? { ...r, retailPrice: 2 } : r]) {
    await expect(syncPrices([component()], mockFetch(change), "2026-11-06", async () => {})).rejects.toThrow(/환율/);
  }
});
it("retries 429 using Retry-After and fallback delay", async () => {
  const good = mockFetch();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "2" } })).mockResolvedValueOnce(new Response(null, { status: 429 })).mockImplementation(good);
  const wait = vi.fn<(ms: number) => Promise<void>>(async () => {});
  await syncPrices([component()], fetcher, "2026-11-06", wait);
  expect(wait).toHaveBeenCalledWith(2000);
  expect(wait).toHaveBeenCalledWith(10000);
});
it("stops after five 429 retries", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }));
  await expect(syncPrices([component()], fetcher, "2026-11-06", async () => {})).rejects.toThrow(/429/);
  expect(fetcher).toHaveBeenCalledTimes(6);
});
it("fetches priceRegion once per currency", async () => {
  const c = component(); const fetcher = mockFetch(r => ({ ...r, armRegionName: "eastus2" }));
  const snapshot = await syncPrices([{ ...c, pricing: { ...c.pricing, priceRegion: "eastus2" } }], fetcher, "2026-11-06", async () => {});
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(snapshot.usdToCad.pairs).toBe(6);
  for (const region of ["westus2", "centralus"]) {
    expect(snapshot.prices[c.id][region]).toEqual(snapshot.prices[c.id].canadacentral);
  }
});

it("keeps regional meters and prices separate without Canada fallback", async () => {
  const rates: Record<string, number> = { canadacentral: 1, westus2: 2, centralus: 3 };
  const fetcher = mockFetch(r => ({ ...r, meterId: `meter-${r.armRegionName}`, retailPrice: r.retailPrice * rates[r.armRegionName] }));
  const snapshot = await syncPrices([component()], fetcher, "2026-11-11", async () => {});
  expect(fetcher).toHaveBeenCalledTimes(6);
  expect(snapshot.asOf).toBe("2026-11-11");
  for (const region of Object.keys(rates)) {
    expect(snapshot.prices[component().id][region]).toMatchObject({
      meterId: `meter-${region}`,
      tiers: Array.from({ length: 6 }, (_, i) => ({ minUnits: i * 100, unitPrice: 1.4 * rates[region] })),
    });
  }
});

it("derives FX from evidence across regions rather than a fixed rate", async () => {
  const ratios: Record<string, number> = { canadacentral: 1.4, westus2: 1.405, centralus: 1.41 };
  const fetcher = mockFetch((r, id) => ({
    ...r,
    retailPrice: id === 5 ? (r.currencyCode === "CAD" ? 0 : 0.00001) : (r.currencyCode === "CAD" ? ratios[r.armRegionName] : 1),
  }));
  const snapshot = await syncPrices([component()], fetcher, "2026-11-11", async () => {});
  expect(snapshot.usdToCad).toEqual({ rate: 1.405, pairs: 15 });
  for (const region of Object.keys(ratios)) {
    expect(snapshot.prices[component().id][region].tiers[5]).toEqual({ minUnits: 500, unitPrice: 0.00001405, convertedFromUsd: true });
  }
});

it.each(["westus2", "centralus"])("aborts the snapshot for missing or mismatched %s rows", async region => {
  for (const override of [{ armRegionName: "canadacentral" }, { type: "Reservation" }, { meterId: "usd-other-meter" }]) {
    const fetcher = mockFetch(r => r.armRegionName === region && r.currencyCode === "USD" ? { ...r, ...override } : r);
    await expect(syncPrices([component()], fetcher, "2026-11-11", async () => {})).rejects.toThrow(/저장하지 않음/);
  }
});
it("validates numeric tiers and ignores reservation or DevTest rows", () => {
  for (const override of [{ retailPrice: -1 }, { retailPrice: Infinity }, { tierMinimumUnits: -1 }]) {
    expect(() => selectPriceEntry(component(), [row("CAD", override)], "canadacentral", "CAD")).toThrow();
  }
  expect(() => selectPriceEntry(component(), [row(), row()], "canadacentral", "CAD")).toThrow();
  const entry = selectPriceEntry(component(), [row("USD", { type: "Reservation", productName: "wrong" }), row("USD", { type: "DevTestConsumption" }), row()], "canadacentral", "CAD");
  expect(entry.tiers).toEqual([{ minUnits: 0, unitPrice: 1.4 }]);
});
it("reads paginated prices and rejects repeating page URLs", async () => {
  const complete = mockFetch();
  const fetcher = vi.fn<typeof fetch>(async url => {
    if (String(url).includes("page=2")) return complete(String(url));
    const next = new URL(String(url)); next.searchParams.set("page", "2");
    return Response.json({ Items: [row(new URL(String(url)).searchParams.get("currencyCode")!.replaceAll("'", ""), { type: "Reservation" })], NextPageLink: next.href });
  });
  await expect(syncPrices([component()], fetcher, "2026-11-06", async () => {})).resolves.toMatchObject({ currency: "CAD" });
  expect(fetcher).toHaveBeenCalledTimes(12);
  const repeating = vi.fn<typeof fetch>(async url => Response.json({ Items: [], NextPageLink: String(url) }));
  await expect(syncPrices([component()], repeating, "2026-11-06", async () => {})).rejects.toThrow(/반복/);
});
it("rejects HTTP errors, malformed pages and empty consumption results", async () => {
  for (const response of [new Response(null, { status: 500 }), Response.json({ Items: [], NextPageLink: null }), Response.json({ Items: null })]) {
    await expect(syncPrices([component()], vi.fn<typeof fetch>().mockResolvedValue(response), "2026-11-06", async () => {})).rejects.toThrow(/저장하지 않음/);
  }
});
it("rejects a zero USD denominator in FX evidence", async () => {
  await expect(syncPrices([component()], mockFetch(r => r.currencyCode === "USD" ? { ...r, retailPrice: 0 } : r), "2026-11-06", async () => {})).rejects.toThrow(/환율/);
});

it("실제 무료 VNet·서브넷에는 가격 API 요청이나 스냅샷 행을 만들지 않는다", async () => {
  const free = loadCatalog().components.filter(c => ["virtual-network", "virtual-network-subnet"].includes(c.id));
  expect(free).toHaveLength(2);
  expect(free.every(c => c.pricing.kind === "free")).toBe(true);
  const fetcher = mockFetch();
  const metered = component();
  const snapshot = await syncPrices([...free, metered], fetcher, "2026-11-12", async () => {});
  expect(fetcher).toHaveBeenCalledTimes(6);
  expect(Object.keys(snapshot.prices)).toEqual([metered.id]);
  expect(snapshot.usdToCad).toEqual({ rate: 1.4, pairs: 18 });
  for (const c of free) expect(snapshot.prices).not.toHaveProperty(c.id);
});

it("refuses foreign pagination and redirects before fetching additional rows", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({ Items: [], NextPageLink: "https://example.invalid/prices" }),
  );
  await expect(syncPrices([component()], fetcher, "2026-11-06", async () => {})).rejects.toThrow(/가격 동기화 실패/);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/prices\.azure\.com\//), { redirect: "error" });
});

it("atomically replaces a private local snapshot and cleans up after a failed rename", async () => {
  const { mkdir, mkdtemp, readdir, readFile, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeOperatorSnapshot } = await import("./sync-prices");
  const dir = await mkdtemp(join(tmpdir(), "cloudmaru-sync-"));
  const parent = join(dir, "private");
  const file = join(parent, "prices.json");
  const snapshot = structuredClone(loadCatalog().prices);
  for (const regions of Object.values(snapshot.prices)) {
    for (const price of Object.values(regions)) price.meterId = "test-operator-meter";
  }
  snapshot.asOf = "2035-06-01";
  try {
    await writeOperatorSnapshot(snapshot, file);
    expect((await stat(parent)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o640);
    const updated = { ...snapshot, asOf: "2035-06-02" };
    await writeOperatorSnapshot(updated, file);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(updated);
    const blocked = join(parent, "directory");
    await mkdir(blocked);
    await expect(writeOperatorSnapshot(snapshot, blocked)).rejects.toThrow();
    expect((await readdir(parent)).sort()).toEqual(["directory", "prices.json"]);
    await expect(writeOperatorSnapshot(snapshot, join(process.cwd(), "README.md"))).rejects.toThrow(/untracked/);
    await expect(writeOperatorSnapshot(snapshot, join(process.cwd(), "src/prices.json"))).rejects.toThrow(/source/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
