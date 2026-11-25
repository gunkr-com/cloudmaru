import "server-only";
import { extensionArtifactSchema } from "@/lib/completion/schema";
import type { ExtensionCoreData } from "@/lib/extend/process";
import type { ExtensionArtifact, ExtensionResult } from "@/types/extension";
import type { ScanInventory } from "@/types/scan";

export class ExtensionArtifactStorageError extends Error {
  constructor(public readonly code: "validation-failed" | "compiler-unavailable" | "internal" = "validation-failed") {
    super(code);
    this.name = "ExtensionArtifactStorageError";
  }
}
export type ArtifactBinding = Pick<ExtensionArtifact, "id" | "extensionId" | "workspaceId" | "sourceScanId" | "tier" | "kind" | "createdAt">;
export type ArtifactStorageContext = { extension: ExtensionResult; catalogData: ExtensionCoreData; inventory: ScanInventory };

/** Structural/member checks run at write AND read; generation semantics and compilation run only at write. */
export function validateArtifactMembers(raw: unknown, binding: ArtifactBinding, context: ArtifactStorageContext): ExtensionArtifact {
  const parsed = extensionArtifactSchema.safeParse(raw);
  if (!parsed.success) throw new ExtensionArtifactStorageError();
  const value = parsed.data;
  const { extension, catalogData, inventory } = context;
  if (Object.entries(binding).some(([key, expected]) => value[key as keyof ArtifactBinding] !== expected)
    || extension.id !== binding.extensionId || extension.workspaceId !== binding.workspaceId
    || extension.sourceScanId !== binding.sourceScanId || Date.parse(binding.createdAt) < Date.parse(extension.createdAt)) throw new ExtensionArtifactStorageError();
  const plan = extension.plans.find(plan => plan.tier === binding.tier);
  if (!plan) throw new ExtensionArtifactStorageError();
  const components = new Set([...plan.newItems, ...plan.reusedResources, ...plan.usageIncreases].map(item => item.componentId));
  const reused = new Set(plan.reusedResources.map(item => item.resourceId));
  const catalogIds = new Set(catalogData.catalog.components.map(item => item.id));
  const inventoryIds = new Set(inventory.resources.map(item => item.id));
  if ([...components].some(id => !catalogIds.has(id)) || [...reused].some(id => !inventoryIds.has(id))) throw new ExtensionArtifactStorageError();
  if (value.kind === "guide") {
    for (const step of value.content.steps) {
      if (step.componentIds.some(id => !components.has(id)) || step.reusedResourceIds.some(id => !reused.has(id))) throw new ExtensionArtifactStorageError();
    }
  }
  if (value.kind === "bicep") {
    const newIds = new Set(plan.newItems.map(item => item.componentId));
    if (value.content.existingResourceIds.some(id => !reused.has(id))
      || value.content.newComponentIds.some(id => !newIds.has(id))) throw new ExtensionArtifactStorageError();
  }
  return value;
}
