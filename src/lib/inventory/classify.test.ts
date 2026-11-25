import { describe, expect, it } from "vitest";
import { classifyResourceType, STAGE_ORDER } from "./classify";

const cases = [
  ["Microsoft.KeyVault/vaults", "key-vault", "infra"],
  ["Microsoft.OperationalInsights/workspaces", "monitoring", "infra"],
  ["Microsoft.Insights/components", "monitoring", "infra"],
  ["Microsoft.OperationsManagement/solutions", "monitoring", "infra"],
  ["Microsoft.DataFactory/factories", "data-factory", "ingest"],
  ["Microsoft.Databricks/workspaces", "databricks", "process"],
  ["Microsoft.Compute/virtualMachines", "compute", "process"],
  ["Microsoft.App/containerApps", "container-compute", "process"],
  ["Microsoft.ContainerInstance/containerGroups", "container-compute", "process"],
  ["Microsoft.ContainerService/managedClusters", "container-compute", "process"],
  ["Microsoft.Web/sites", "web-app", "serve"],
  ["Microsoft.Web/sites/slots", "web-app", "serve"],
  ["Microsoft.Web/serverfarms", "app-plan", "infra"],
  ["Microsoft.Web/staticSites", "static-web", "source"],
  ["Microsoft.Cdn/profiles/afdEndpoints", "cdn", "source"],
  ["Microsoft.Sql/managedInstances", "sql-managed-instance", "store"],
  ["Microsoft.Sql/managedInstances/administrators", "sql-managed-instance", "store"],
  ["Microsoft.Sql/servers/databases", "sql-database", "store"],
  ["Microsoft.Sql/servers", "sql-server", "store"],
  ["Microsoft.Storage/storageAccounts", "storage", "store"],
  ["Microsoft.DocumentDB/databaseAccounts", "cosmos", "store"],
  ["Microsoft.Synapse/workspaces/bigDataPools", "synapse-pool", "process"],
  ["Microsoft.Synapse/workspaces/sqlPools", "synapse-workspace", "process"],
  ["Microsoft.Synapse/workspaces", "synapse-workspace", "process"],
  ["Microsoft.EventHub/namespaces", "messaging", "ingest"],
  ["Microsoft.ServiceBus/namespaces", "messaging", "ingest"],
  ["Microsoft.AnalysisServices/servers", "analysis-services", "serve"],
  ["Microsoft.MachineLearningServices/workspaces", "machine-learning", "serve"],
  ["Microsoft.Network/virtualNetworks", "network", "infra"],
  ["Microsoft.Sql/virtualClusters", "network", "infra"],
  ["Microsoft.Web/certificates", "certificate", "infra"],
  ["Microsoft.DBforPostgreSQL/flexibleServers", "other", "store"],
  ["Microsoft.ApiManagement/service", "other", "serve"],
  ["Microsoft.Compute/disks", "other", "process"],
  ["Microsoft.DataFactory/unknown", "other", "ingest"],
  ["Unknown/raw-portal-api", "other", "unclassified"],
  ["", "other", "unclassified"],
] as const;

describe("타입 기반 계열·단계 분류", () => {
  it.each(cases)("%s → %s / %s", (type, family, stage) => {
    expect(classifyResourceType(type)).toEqual({ family, stage });
    expect(classifyResourceType(`  ${type.toUpperCase()}  `)).toEqual({ family, stage });
  });
  it("원본 단계 순서를 유지한다", () => {
    expect(STAGE_ORDER).toEqual(["source", "ingest", "process", "store", "serve", "infra", "unclassified"]);
  });
});
