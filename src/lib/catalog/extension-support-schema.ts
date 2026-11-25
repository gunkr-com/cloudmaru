import { z } from "zod";
import type { Catalog } from "@/types/catalog";

const text = z.string().trim().min(1);
const id = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const regionId = z.string().regex(/^[a-z][a-z0-9]+$/);
const localized = z.strictObject({ en: text, ko: text });
const source = z.strictObject({ title: text, url: z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "learn.microsoft.com"
    && !url.username && !url.password && (!url.port || url.port === "443");
}) });
const sources = z.array(source).min(1);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const resourceType = z.string().regex(/^microsoft\.[a-z0-9.]+(?:\/[a-z0-9]+)+$/);

export const reusePolicySchema = z.strictObject({
  id,
  resourceTypes: z.array(resourceType).min(1).refine(unique),
  componentIds: z.array(id).min(1).refine(unique),
  conditions: z.array(z.enum([
    "same-region", "parent-inventory", "sku-match", "linux-required", "delegation-verified",
  ])).min(1).refine(values => unique(values) && values.includes("same-region")),
  skuByComponent: z.record(id, text).optional(),
  additionalUsage: z.enum(["none", "metered"]),
  // 수집한 SKU만으로 잔여 용량을 증명할 수 없다.
  capacity: z.literal("unverified"),
  notes: localized,
  sources,
});

export const extensionSupportCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: text,
  verifiedAt: z.iso.datetime({ offset: true }),
  regions: z.array(z.strictObject({ id: regionId, label: localized })).min(1)
    .refine(values => unique(values.map(value => value.id))),
  components: z.array(z.strictObject({
    componentId: id,
    regions: z.array(z.strictObject({
      regionId,
      status: z.enum(["supported", "unknown"]),
      // 지역 무관 미터의 명시적 priceRegion을 배포 지역과 구분한다.
      priceRegion: text.optional(),
      sources,
    })).min(1).refine(values => unique(values.map(value => value.regionId))),
  })).min(1).refine(values => unique(values.map(value => value.componentId))),
  reusePolicies: z.array(reusePolicySchema).min(1)
    .refine(values => unique(values.map(value => value.id))),
});

export class ExtensionSupportError extends Error {
  constructor() { super("Invalid extension support catalog."); }
}

/** 정적 카탈로그끼리의 참조와 실제 가격 근거를 함께 검사한다. I/O는 없다. */
export function parseExtensionSupportCatalog(
  raw: unknown,
  catalog: Pick<Catalog, "components" | "prices">,
): z.infer<typeof extensionSupportCatalogSchema> {
  const parsed = extensionSupportCatalogSchema.safeParse(raw);
  if (!parsed.success) throw new ExtensionSupportError();
  const support = parsed.data;
  const components = new Map(catalog.components.map(component => [component.id, component]));
  const regions = new Set(support.regions.map(region => region.id));
  if (support.components.length !== components.size) throw new ExtensionSupportError();
  for (const entry of support.components) {
    const component = components.get(entry.componentId);
    if (!component || entry.regions.length !== regions.size) throw new ExtensionSupportError();
    for (const regional of entry.regions) {
      if (!regions.has(regional.regionId)) throw new ExtensionSupportError();
      if (component.pricing.kind === "free") {
        if (regional.priceRegion !== undefined) throw new ExtensionSupportError();
        continue;
      }
      const priceRegion = component.pricing.priceRegion ?? regional.regionId;
      if (regional.priceRegion !== priceRegion) throw new ExtensionSupportError();
      if (regional.status === "unknown") continue;
      const price = catalog.prices.prices[component.id]?.[regional.regionId];
      if (!catalog.prices.regions.includes(regional.regionId) || !price
        || price.unitOfMeasure !== component.pricing.unitOfMeasure) throw new ExtensionSupportError();
    }
  }
  for (const policy of support.reusePolicies) {
    if (policy.componentIds.some(id => !components.has(id))) throw new ExtensionSupportError();
    const typesFor = (id: string) => components.get(id)!.bicepResourceTypes.map(type => type.toLowerCase());
    if (policy.resourceTypes.some(type => !policy.componentIds.some(id => typesFor(id).includes(type)))
      || policy.componentIds.some(id => !policy.resourceTypes.some(type => typesFor(id).includes(type)))) {
      throw new ExtensionSupportError();
    }
    const skus = policy.skuByComponent ?? {};
    if (Object.keys(skus).some(id => !policy.componentIds.includes(id))
      || (policy.conditions.includes("sku-match") && policy.componentIds.some(id => !skus[id]))) {
      throw new ExtensionSupportError();
    }
    if (policy.additionalUsage === "metered"
      && policy.componentIds.some(id => components.get(id)!.pricing.kind !== "metered")) {
      throw new ExtensionSupportError();
    }
  }
  return support;
}
