// ADR-020: AzVision의 타입 규칙만 이식하며 이름 기반 보정은 하지 않는다.
export type ResourceStage =
  | "source"
  | "ingest"
  | "process"
  | "store"
  | "serve"
  | "infra"
  | "unclassified";

export type ResourceFamily =
  | "static-web"
  | "cdn"
  | "web-app"
  | "app-plan"
  | "sql-managed-instance"
  | "sql-server"
  | "sql-database"
  | "synapse-workspace"
  | "synapse-pool"
  | "storage"
  | "cosmos"
  | "data-factory"
  | "databricks"
  | "messaging"
  | "compute"
  | "container-compute"
  | "analysis-services"
  | "machine-learning"
  | "key-vault"
  | "monitoring"
  | "network"
  | "certificate"
  | "other";

export const STAGE_ORDER: readonly ResourceStage[] = [
  "source", "ingest", "process", "store", "serve", "infra", "unclassified",
];

const TYPE_FAMILY_RULES: { family: ResourceFamily; prefixes: string[] }[] = [
  { family: "static-web", prefixes: ["microsoft.web/staticsites"] },
  { family: "cdn", prefixes: ["microsoft.cdn/profiles", "microsoft.cdn/profiles/afdendpoints"] },
  { family: "web-app", prefixes: ["microsoft.web/sites", "microsoft.web/sites/slots"] },
  { family: "app-plan", prefixes: ["microsoft.web/serverfarms"] },
  { family: "sql-managed-instance", prefixes: ["microsoft.sql/managedinstances"] },
  { family: "sql-database", prefixes: ["microsoft.sql/servers/databases"] },
  { family: "sql-server", prefixes: ["microsoft.sql/servers"] },
  { family: "data-factory", prefixes: ["microsoft.datafactory/factories"] },
  { family: "databricks", prefixes: ["microsoft.databricks/workspaces"] },
  { family: "messaging", prefixes: ["microsoft.eventhub/namespaces", "microsoft.servicebus/namespaces"] },
  { family: "compute", prefixes: ["microsoft.compute/virtualmachines"] },
  { family: "container-compute", prefixes: ["microsoft.app/containerapps", "microsoft.containerinstance/containergroups", "microsoft.containerservice/managedclusters"] },
  { family: "analysis-services", prefixes: ["microsoft.analysisservices/servers"] },
  { family: "machine-learning", prefixes: ["microsoft.machinelearningservices/workspaces"] },
  { family: "synapse-pool", prefixes: ["microsoft.synapse/workspaces/bigdatapools"] },
  { family: "synapse-workspace", prefixes: ["microsoft.synapse/workspaces"] },
  { family: "storage", prefixes: ["microsoft.storage/storageaccounts"] },
  { family: "cosmos", prefixes: ["microsoft.documentdb/databaseaccounts"] },
  { family: "key-vault", prefixes: ["microsoft.keyvault/vaults"] },
  { family: "monitoring", prefixes: ["microsoft.insights/", "microsoft.operationalinsights/workspaces", "microsoft.operationsmanagement/solutions"] },
  { family: "network", prefixes: ["microsoft.network/", "microsoft.sql/virtualclusters", "microsoft.sql/managedinstances/administrators"] },
  { family: "certificate", prefixes: ["microsoft.web/certificates"] },
];

export function classifyResourceType(type: string): { family: ResourceFamily; stage: ResourceStage } {
  const normalized = type.trim().toLowerCase();
  const family = TYPE_FAMILY_RULES.find((rule) => rule.prefixes.some((prefix) => normalized.startsWith(prefix)))?.family ?? "other";
  const startsWithAny = (...prefixes: string[]) => prefixes.some((prefix) => normalized.startsWith(prefix));
  let stage: ResourceStage = "unclassified";

  if (["network", "certificate", "app-plan", "key-vault", "monitoring"].includes(family)) stage = "infra";
  else if (family === "cdn" || family === "static-web") stage = "source";
  else if (family === "data-factory") stage = "ingest";
  else if (["databricks", "compute", "container-compute"].includes(family)) stage = "process";
  else if (startsWithAny("microsoft.network/", "microsoft.web/certificates", "microsoft.sql/virtualclusters")) stage = "infra";
  else if (startsWithAny("microsoft.cdn/profiles", "microsoft.web/staticsites")) stage = "source";
  else if (startsWithAny("microsoft.datafactory/", "microsoft.eventhub/", "microsoft.servicebus/")) stage = "ingest";
  else if (startsWithAny("microsoft.synapse/workspaces", "microsoft.databricks/", "microsoft.compute/", "microsoft.containerinstance/", "microsoft.containerservice/")) stage = "process";
  else if (startsWithAny("microsoft.sql/", "microsoft.storage/storageaccounts", "microsoft.documentdb/databaseaccounts", "microsoft.dbfor")) stage = "store";
  else if (startsWithAny("microsoft.web/sites", "microsoft.apimanagement/", "microsoft.analysisservices/servers", "microsoft.machinelearningservices/workspaces")) stage = "serve";

  return { family, stage };
}
