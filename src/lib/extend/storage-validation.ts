import type { Catalog } from "@/types/catalog";
import type { CompletionReasonCode, SourceScan } from "@/types/completion";
import type { ExtensionInput, ExtensionResult } from "@/types/extension";
import type { ScanInventory, ScanRecord } from "@/types/scan";

export class ExtensionStorageError extends Error {
  constructor(public readonly code: CompletionReasonCode = "validation-failed") {
    super(code);
    this.name = "ExtensionStorageError";
  }
}

export type ExtensionValidationContext = {
  input: ExtensionInput;
  scan: ScanRecord;
  sourceScan: SourceScan;
  inventory: ScanInventory;
};
// 필수 코어 검증 이후 추가 제약을 적용하는 DI다. 필수 검증을 대체하지 않는다.
export type ExtensionResultValidator = (result: ExtensionResult, context: ExtensionValidationContext) => void;

/** 구조 검증과 별도로 모든 카탈로그/저장 인벤토리 참조를 확인한다. */
export function validateExtensionStorageMembers(result: ExtensionResult, inventory: ScanInventory, catalog: Catalog): void {
  const resources = new Set(inventory.resources.map(resource => resource.id));
  const components = new Set(catalog.components.map(component => component.id));
  const architectures = new Set(catalog.architectures.map(architecture => architecture.id));
  const member = (id: string) => { if (!resources.has(id)) throw new ExtensionStorageError(); };
  const component = (id: string) => { if (!components.has(id)) throw new ExtensionStorageError(); };
  for (const plan of result.plans) {
    if (!architectures.has(plan.referenceArchitectureId)) throw new ExtensionStorageError();
    for (const item of [...plan.newItems, ...plan.reusedResources, ...plan.usageIncreases]) component(item.componentId);
    for (const item of [...plan.reusedResources, ...plan.usageIncreases]) member(item.resourceId);
    for (const binding of plan.deploymentBindings ?? []) if (binding.target.kind === "reused-subnet") member(binding.target.resourceId);
    for (const subnet of plan.subnetProposals) {
      component(subnet.componentId);
      if (subnet.parent.kind === "existing") member(subnet.parent.resourceId);
      else component(subnet.parent.componentId);
    }
    if ("data" in plan.incrementalCost) for (const line of plan.incrementalCost.data.lines) {
      component(line.componentId);
      if (line.resourceId !== null) member(line.resourceId);
    }
    for (const check of plan.checks) {
      check.resourceIds.forEach(member);
      check.componentIds.forEach(component);
      check.evidence.forEach(evidence => member(evidence.resourceId));
    }
  }
}
