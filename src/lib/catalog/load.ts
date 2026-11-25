import components from "@/catalog/components.json";
import architectures from "@/catalog/reference-architectures.json";
import prices from "@/catalog/prices.json";
import { validateCatalog } from "@/lib/catalog/validate";
import type { Catalog, Component, ReferenceArchitecture } from "@/types/catalog";

export function loadCatalog(): Catalog {
  const result = validateCatalog({ components, architectures, prices });
  if (!result.ok) {
    throw new Error(`카탈로그 검증 실패:\n${result.errors.join("\n")}`);
  }
  return result.catalog;
}

export function getComponent(catalog: Catalog, id: string): Component | undefined {
  return catalog.components.find((component) => component.id === id);
}

export function getArchitecture(
  catalog: Catalog,
  id: string,
): ReferenceArchitecture | undefined {
  return catalog.architectures.find((architecture) => architecture.id === id);
}
