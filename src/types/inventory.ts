import type { ResourceFamily, ResourceStage } from "@/lib/inventory/classify";

export type InventoryObservedField = "tags" | "zones" | "managedBy" | "sku" | "properties" | "location" | "kind";

export type InventoryResource = {
  id: string;
  name: string;
  type: string;
  kind: string | null;
  location: string | null;
  subscriptionId: string;
  resourceGroup: string;
  sku: Record<string, unknown> | null;
  tags: Record<string, string>;
  zones: string[];
  managedBy: string | null;
  properties: Record<string, unknown>;
  parentId: string | null;
  // 누락은 구형 자료다. 정규화 기본값만으로 수집 여부를 추측하지 않는다.
  observedFields?: InventoryObservedField[];
};

export type InventoryContainer = {
  id: string;
  kind: "subscription" | "resourceGroup";
  name: string;
  subscriptionId: string;
  location: string | null;
  tags: Record<string, string>;
};

export type RelationType = "connects_to" | "secures" | "routes" | "hosts";

export type InventoryRelation = {
  sourceId: string;
  targetId: string;
  type: RelationType;
  evidence: string[];
};

export type InventorySummary = {
  resourceCount: number;
  resourceGroupCount?: number;
  subscriptionIds: string[];
  byType: Record<string, number>;
  byLocation: Record<string, number>;
  byResourceGroup: Record<string, number>;
  byFamily: Record<string, number>;
  untaggedCount: number;
};

export type Inventory = {
  source: "live" | "import";
  collectedAt: string;
  resources: InventoryResource[];
  containers: InventoryContainer[];
  relations: InventoryRelation[];
  summary: InventorySummary;
  skippedRows: number;
};

export type InventoryFacts = {
  resources: number;
  subscriptions: number;
  resourceGroups: number;
  regions: number;
  untagged: number;
};

export type InventoryStageFamilies = {
  stage: ResourceStage;
  families: { family: ResourceFamily; count: number }[];
};

export type ResourceTableQuery = { q: string; type: string | null; page: number };
export type ResourceTableRow = {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  location: string | null;
  subscriptionId: string;
  subscriptionName: string | null;
  tagCount: number;
};
export type ResourceTablePage = {
  rows: ResourceTableRow[];
  total: number;
  matched: number;
  page: number;
  pageCount: number;
  from: number;
  to: number;
  types: { type: string; count: number }[];
  // 실제로 적용한 종류 필터. 인벤토리에 없는 종류를 요청하면 null(모든 종류)이다.
  appliedType: string | null;
};
