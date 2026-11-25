import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import components from "@/catalog/components.json";
import architectures from "@/catalog/reference-architectures.json";
import bundledPrices from "@/catalog/prices.json";
import { loadExtensionSupportCatalog } from "@/lib/catalog/extension-support";
import { priceSnapshotSchema } from "@/lib/catalog/schema";
import { validateCatalog } from "@/lib/catalog/validate";
import { SUPPORTED_REGIONS } from "@/lib/workspace/regions";
import type { ExtensionCoreData } from "@/lib/extend/process";

export type OperatorPrices = ({ ok: true } & ExtensionCoreData) |
  { ok: false; reason: "missing" | "unreadable" | "invalid" | "synthetic" | "incomplete" };

export function operatorPricesPath(): string {
  const override = process.env.CLOUDMARU_PRICES_FILE;
  if (override && !isAbsolute(override)) throw new Error("CLOUDMARU_PRICES_FILE must be an absolute path");
  return override || resolve(/*turbopackIgnore: true*/ ".cloudmaru-pricing/prices.json");
}

function snapshotDigest(snapshot: unknown): string {
  const keys = new Set<string>();
  JSON.stringify(snapshot, (key, value) => {
    if (key !== "meterId") keys.add(key);
    return value;
  });
  return createHash("sha256").update(JSON.stringify(snapshot, [...keys].sort())).digest("hex");
}

// Fingerprint the bundled table independently of formatting and meter ID strings.
const bundledDigest = snapshotDigest(bundledPrices);

export function validateOperatorPrices(raw: unknown): OperatorPrices {
  const parsed = priceSnapshotSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const prices = parsed.data;
  if (Object.values(prices.prices).some(regions => Object.values(regions).some(row => /^synthetic:/i.test(row.meterId)))
    || snapshotDigest(prices) === bundledDigest) {
    return { ok: false, reason: "synthetic" };
  }
  const catalog = validateCatalog({ components, architectures, prices });
  if (!catalog.ok || SUPPORTED_REGIONS.some(region => !prices.regions.includes(region.id))) {
    return { ok: false, reason: "incomplete" };
  }
  try {
    return { ok: true, catalog: catalog.catalog, support: loadExtensionSupportCatalog(catalog.catalog) };
  } catch {
    return { ok: false, reason: "incomplete" };
  }
}

// The sync CLI also uses the same path and validation.
export async function acquireOperatorPrices(): Promise<OperatorPrices> {
  if (process.env.CLOUDSIGHT_DEMO === "1") return { ok: false, reason: "missing" };
  let raw: string;
  try {
    // Operator pricing is supplied at runtime and must stay outside the build.
    raw = await readFile(/*turbopackIgnore: true*/ operatorPricesPath(), "utf8");
  } catch (error) {
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable" };
  }
  try {
    return validateOperatorPrices(JSON.parse(raw));
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
