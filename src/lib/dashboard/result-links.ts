import { tierSchema } from "@/lib/catalog/schema";
import type { Tier } from "@/types/catalog";

export const RESULT_FOCUS_FLAG_PREFIX = "cloudsight:focus-result:";

export function parseTierParam(value: string | string[] | undefined): Tier | null {
  const candidate = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
  if (typeof candidate !== "string") return null;
  const parsed = tierSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function buildResultHref(id: string, tier?: Tier): string {
  return tier ? `/analyses/${encodeURIComponent(id)}?tier=${tier}` : `/analyses/${encodeURIComponent(id)}`;
}

export function buildRerunHref(id: string): string {
  return `/analyses/new?from=${encodeURIComponent(id)}`;
}
