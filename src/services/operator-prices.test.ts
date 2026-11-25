// @vitest-environment node
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadCatalog } from "@/lib/catalog/load";
import { acquireOperatorPrices, operatorPricesPath } from "./operator-prices";

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "cloudmaru-prices-"));
  file = join(directory, "prices.json");
  vi.stubEnv("CLOUDMARU_PRICES_FILE", file);
  vi.stubEnv("CLOUDSIGHT_DEMO", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

function distinctSnapshot() {
  const snapshot = structuredClone(loadCatalog().prices);
  snapshot.asOf = "2035-06-01";
  for (const regions of Object.values(snapshot.prices)) {
    for (const row of Object.values(regions)) row.meterId = "operator-meter";
  }
  return snapshot;
}

it("uses the checkout default and rejects relative overrides", () => {
  vi.stubEnv("CLOUDMARU_PRICES_FILE", "");
  expect(operatorPricesPath()).toBe(join(process.cwd(), ".cloudmaru-pricing", "prices.json"));
  vi.stubEnv("CLOUDMARU_PRICES_FILE", "prices.json");
  expect(() => operatorPricesPath()).toThrow(/absolute/);
});

it("classifies missing, unreadable, invalid and incomplete snapshots", async () => {
  await expect(acquireOperatorPrices()).resolves.toEqual({ ok: false, reason: "missing" });
  await mkdir(file);
  await expect(acquireOperatorPrices()).resolves.toEqual({ ok: false, reason: "unreadable" });
  await rm(file, { recursive: true });
  await writeFile(file, "invalid");
  await expect(acquireOperatorPrices()).resolves.toEqual({ ok: false, reason: "invalid" });
  await writeFile(file, JSON.stringify({ ...distinctSnapshot(), prices: {} }));
  await expect(acquireOperatorPrices()).resolves.toEqual({ ok: false, reason: "incomplete" });
});

it("rejects the bundled snapshot and synthetic markers", async () => {
  await writeFile(file, JSON.stringify(loadCatalog().prices));
  await expect(acquireOperatorPrices()).resolves.toEqual({ ok: false, reason: "synthetic" });
  const snapshot = distinctSnapshot();
  Object.values(Object.values(snapshot.prices)[0])[0].meterId = "Synthetic:fixture";
  await writeFile(file, JSON.stringify(snapshot));
  await expect(acquireOperatorPrices()).resolves.toEqual({ ok: false, reason: "synthetic" });
});

it("captures a validated snapshot per request and bypasses the file in demo", async () => {
  const snapshot = distinctSnapshot();
  await writeFile(file, JSON.stringify(snapshot));
  const first = await acquireOperatorPrices();
  expect(first).toMatchObject({ ok: true, catalog: { prices: { asOf: "2035-06-01" } } });
  await writeFile(file, JSON.stringify({ ...snapshot, asOf: "2035-06-02" }));
  await expect(acquireOperatorPrices()).resolves.toMatchObject({ ok: true, catalog: { prices: { asOf: "2035-06-02" } } });
  expect(first).toMatchObject({ catalog: { prices: { asOf: "2035-06-01" } } });
  vi.stubEnv("CLOUDSIGHT_DEMO", "1");
  await expect(acquireOperatorPrices()).resolves.toEqual({ ok: false, reason: "missing" });
});

it("rejects a copy of the bundled price table with replaced meter IDs", async () => {
  const snapshot = distinctSnapshot();
  snapshot.asOf = loadCatalog().prices.asOf;
  await writeFile(file, JSON.stringify(snapshot));
  await expect(acquireOperatorPrices()).resolves.toEqual({ ok: false, reason: "synthetic" });
});
