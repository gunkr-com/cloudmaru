import { z } from "zod";

export const USER_NODE_ID = "user";
export const ALLOWED_SOURCE_HOSTS = [
  "learn.microsoft.com",
  "azure.github.io",
  "github.com",
] as const;

const textSchema = z.string().min(1, "빈 문자열은 사용할 수 없습니다.");
export const localizedTextSchema = z.strictObject({ en: textSchema, ko: textSchema });
const assumptionLabelSchema = localizedTextSchema.refine(
  text => text.en.includes("{quantity}") && text.ko.includes("{quantity}"),
  "두 언어 모두 {quantity} 자리가 필요합니다.",
);
const idSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
    "식별자는 영문 소문자로 시작하는 kebab-case여야 합니다.",
  );
const componentIdSchema = idSchema.refine(
  (id) => id !== USER_NODE_ID,
  '구성요소 식별자로 예약어 "user"를 사용할 수 없습니다.',
);
const quantitySchema = z.number().finite().positive("수량은 0보다 커야 합니다.");
const nonnegativeSchema = z
  .number()
  .finite()
  .nonnegative("값은 0 이상이어야 합니다.");

export const tierSchema = z.enum(["low", "balanced", "ha"]);
export const componentCategorySchema = z.enum([
  "compute",
  "database",
  "storage",
  "cache",
  "network",
  "monitoring",
  "security",
]);

// 하위 타입은 상위 타입에 딸려 허용되지 않으므로 필요한 것만 전체 이름으로 적는다. API 버전과 와일드카드는 쓰지 않는다.
export const bicepResourceTypeSchema = z.string().regex(
  /^Microsoft\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*(?:\/[A-Za-z0-9]+)+$/,
  "Bicep 리소스 타입은 Microsoft.<네임스페이스>/<타입>[/<하위 타입>] 형식이어야 합니다.",
);

const bicepResourceTypesSchema = z.array(bicepResourceTypeSchema).superRefine((types, context) => {
  const seen = new Set<string>();
  types.forEach((type, index) => {
    if (seen.has(type.toLowerCase())) {
      context.addIssue({ code: "custom", path: [index], message: "Bicep 리소스 타입은 중복할 수 없습니다." });
    }
    seen.add(type.toLowerCase());
  });
});

const sourceUrlSchema = z.url().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        ALLOWED_SOURCE_HOSTS.some((host) => host === url.hostname) &&
        (url.hostname !== "github.com" || url.pathname.startsWith("/Azure/"))
      );
    } catch {
      return false;
    }
  },
  "출처는 허용된 호스트의 HTTPS URL이어야 하며, GitHub 경로는 /Azure/로 시작해야 합니다.",
);

const deploymentSourceUrlSchema = sourceUrlSchema.refine(value => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (!url.port || url.port === "443");
  } catch { return false; }
});

// Draft generation metadata is optional so old pinned evidence parses exactly.
// Sizes are a conservative offline app pattern, not a regional capabilities list.
export const postgresDeploymentMappingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("postgres-flex-compute"),
    skuName: z.enum(["Standard_B1ms", "Standard_B2s", "Standard_D2ds_v5", "Standard_D4ds_v5"]),
    tier: z.enum(["Burstable", "GeneralPurpose"]),
    engineVersion: z.literal("16"),
    highAvailabilityMode: z.literal("Disabled"),
    allowedHighAvailabilityModes: z.array(z.enum(["Disabled", "ZoneRedundant"])).min(1)
      .refine(modes => modes[0] === "Disabled" && new Set(modes).size === modes.length).optional(),
    highAvailabilityBilling: z.strictObject({ mode: z.literal("ZoneRedundant"), billingInstancesPerRoot: z.literal(2) }).optional(),
    storageComponentId: z.literal("postgres-flex-storage"),
    mappingBasis: z.enum(["official-example", "inferred-vm-series"]),
    capabilityStatus: z.literal("unverified"),
    sourceUrls: z.array(deploymentSourceUrlSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("postgres-flex-storage"),
    storageType: z.literal("Premium_LRS"),
    storageSizesGB: z.array(z.number().int().min(32).max(32768)
      .refine(size => Number.isInteger(Math.log2(size)))).min(1)
      .refine(sizes => sizes.every((size, index) => index === 0 || size > sizes[index - 1])),
    mappingBasis: z.literal("conservative-app-pattern"),
    capabilityStatus: z.literal("unverified"),
    sourceUrls: z.array(deploymentSourceUrlSchema).min(1),
  }),
]);

const deploymentFacts = {
  version: z.literal("extension-deployment-v1"),
  capabilityStatus: z.literal("unverified"),
  locationBasis: z.enum(["selected-region", "global", "service-location-input"]),
  sourceUrls: z.array(deploymentSourceUrlSchema).min(1),
};
const role = <K extends string, G extends string, R extends [string, ...string[]]>(kind: K, groupId: G, roles: R) => ({
  ...deploymentFacts, kind: z.literal(kind), groupId: z.literal(groupId), role: z.enum(roles),
});
/** Optional, versioned draft facts. No defaults, transforms or regional capability claims. */
export const componentBicepDeploymentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...role("app-service-plan", "app-service", ["plan-capacity"]),
    skuName: z.enum(["B1", "B2", "P0v3", "P1v3", "P2v3"]), skuTier: z.enum(["Basic", "PremiumV3"]), supportsZoneRedundancy: z.boolean() }),
  z.strictObject({ ...role("container-apps", "container-apps", ["cpu", "memory", "requests"]), environmentKind: z.literal("WorkloadProfiles"), workloadProfileName: z.literal("Consumption"),
    cpuIncrement: z.literal(0.25), maximumCpu: z.literal(4), memoryGiBPerCpu: z.literal(2), imageBasis: z.literal("required-input"), targetPortBasis: z.literal("required-input") }),
  z.strictObject({ ...role("functions", "functions", ["executions", "duration", "dedicated-capacity"]),
    hosting: z.enum(["Consumption", "Dedicated"]), skuName: z.enum(["Y1", "P1v3"]), skuTier: z.enum(["Dynamic", "PremiumV3"]), storageConnectionBasis: z.literal("secure-required-input") }),
  z.strictObject({ ...role("application-gateway", "application-gateway", ["fixed", "capacity"]), skuName: z.literal("Standard_v2"), skuTier: z.literal("Standard_v2"), tlsCertificateBasis: z.literal("secure-required-input") }),
  z.strictObject({ ...role("blob-storage", "blob-storage", ["storage"]), skuName: z.enum(["Standard_LRS", "Standard_ZRS"]), accountKind: z.literal("StorageV2"), accessTier: z.literal("Hot") }),
  z.strictObject({ ...role("static-web-app", "static-web-app", ["site"]), skuName: z.enum(["Free", "Standard"]), skuTier: z.enum(["Free", "Standard"]), linkedBackendAllowed: z.boolean() }),
  z.strictObject({ ...role("managed-redis", "managed-redis", ["cache"]), skuName: z.enum(["Balanced_B0", "Balanced_B1"]) }),
  z.strictObject({ ...role("postgres-compute", "postgres", ["compute"]) }),
  z.strictObject({ ...role("postgres-storage", "postgres", ["storage"]) }),
  z.strictObject({ ...role("virtual-network", "virtual-network", ["network"]) }),
  z.strictObject({ ...role("subnet", "subnet", ["subnet"]) }),
  z.strictObject({ ...role("public-ip", "public-ip", ["frontend"]), skuName: z.literal("Standard"), allocationMethod: z.literal("Static"), ipVersion: z.literal("IPv4") }),
  z.strictObject({ ...role("key-vault", "key-vault", ["operations"]) }),
  z.strictObject({ ...role("log-analytics", "log-analytics", ["ingestion"]) }),
  z.strictObject({ ...role("billing-only", "internet-egress", ["egress"]) }),
  z.strictObject({ ...role("cosmos-serverless", "cosmos-serverless", ["request-units"]), kindName: z.literal("GlobalDocumentDB"), capability: z.literal("EnableServerless") }),
  z.strictObject({ ...role("front-door", "front-door", ["base"]), skuName: z.literal("Standard_AzureFrontDoor") }),
]);

const minimumCount = z.number().int().min(1).max(1000);
export const extensionDeploymentIntentSchema = z.strictObject({
  version: z.literal("extension-topology-v1"), capabilityStatus: z.literal("unverified"),
  postgres: z.discriminatedUnion("highAvailabilityMode", [
    z.strictObject({ highAvailabilityMode: z.literal("Disabled"), billingInstancesPerRoot: z.literal(1) }),
    z.strictObject({ highAvailabilityMode: z.literal("ZoneRedundant"), billingInstancesPerRoot: z.literal(2) }),
  ]),
  appService: z.strictObject({ zoneRedundant: z.boolean(), minimumCapacity: minimumCount }).optional(),
  containerApps: z.strictObject({ zoneRedundant: z.boolean(), minimumReplicas: minimumCount, subnetRequired: z.boolean() }).optional(),
  functions: z.strictObject({ hosting: z.enum(["Consumption", "Dedicated"]), zoneRedundant: z.boolean(), minimumCapacity: minimumCount }).optional(),
  applicationGateway: z.strictObject({ minimumCapacity: z.number().int().min(1).max(125), zoneRedundant: z.boolean(), zonesBasis: z.enum(["none", "deployment-input"]) }).optional(),
  publicIp: z.strictObject({ zoneRedundant: z.boolean(), zonesBasis: z.enum(["none", "deployment-input"]) }).optional(),
  bindings: z.array(z.strictObject({ role: z.enum(["gateway-backend", "gateway-public-ip", "function-storage", "static-backend"]), fromComponentId: componentIdSchema, toComponentId: componentIdSchema }))
    .refine(values => new Set(values.map(v => v.role)).size === values.length),
  networkRequirements: z.array(z.strictObject({ role: z.enum(["gateway-subnet", "container-environment-subnet"]), componentId: componentIdSchema,
    maximumPrefixLength: z.number().int().min(1).max(32), delegation: z.enum(["none", "Microsoft.App/environments"]) }))
    .refine(values => new Set(values.map(v => v.role)).size === values.length),
}).superRefine((intent, ctx) => {
  if (intent.appService?.zoneRedundant && intent.appService.minimumCapacity < 2
    || intent.functions?.zoneRedundant && (intent.functions.hosting !== "Dedicated" || intent.functions.minimumCapacity < 2)
    || intent.containerApps?.zoneRedundant && (!intent.containerApps.subnetRequired || intent.containerApps.minimumReplicas < 2))
    ctx.addIssue({ code: "custom", message: "Incoherent zone redundancy intent." });
  if (intent.applicationGateway && intent.applicationGateway.zoneRedundant !== (intent.applicationGateway.zonesBasis === "deployment-input")
    || intent.publicIp && intent.publicIp.zoneRedundant !== (intent.publicIp.zonesBasis === "deployment-input")
    || intent.applicationGateway && (!intent.publicIp || intent.applicationGateway.zoneRedundant !== intent.publicIp.zoneRedundant))
    ctx.addIssue({ code: "custom", message: "Incoherent gateway/frontend zone input basis." });
});

// Reviewed component identity/role facts; arbitrary names or matching resource type alone
// cannot turn a billing meter into another host. Values are independent of price amounts.
const deploymentIdentity: Record<string, [string, string, string[]]> = {
  ...Object.fromEntries(["b1", "b2", "p0v3", "p1v3", "p2v3"].map(s => [`app-service-linux-${s}`, ["app-service-plan", "plan-capacity", ["Microsoft.Web/serverfarms", "Microsoft.Web/sites"]]])),
  "container-apps-vcpu": ["container-apps", "cpu", ["Microsoft.App/managedEnvironments", "Microsoft.App/containerApps"]],
  "container-apps-memory": ["container-apps", "memory", ["Microsoft.App/managedEnvironments", "Microsoft.App/containerApps"]],
  "container-apps-requests": ["container-apps", "requests", ["Microsoft.App/managedEnvironments", "Microsoft.App/containerApps"]],
  ...Object.fromEntries(["executions", "duration"].map(r => [`functions-consumption-${r}`, ["functions", r, ["Microsoft.Web/serverfarms", "Microsoft.Web/sites", "Microsoft.Storage/storageAccounts"]]])),
  "functions-dedicated-p1v3": ["functions", "dedicated-capacity", ["Microsoft.Web/serverfarms", "Microsoft.Web/sites", "Microsoft.Storage/storageAccounts"]],
  ...Object.fromEntries(["fixed", "capacity"].map(r => [`application-gateway-v2-${r}`, ["application-gateway", r, ["Microsoft.Network/applicationGateways"]]])),
  ...Object.fromEntries(["lrs", "zrs"].map(r => [`blob-hot-${r}`, ["blob-storage", "storage", ["Microsoft.Storage/storageAccounts", "Microsoft.Storage/storageAccounts/blobServices", "Microsoft.Storage/storageAccounts/blobServices/containers"]]])),
  "static-web-apps-standard": ["static-web-app", "site", ["Microsoft.Web/staticSites", "Microsoft.Web/staticSites/linkedBackends"]],
  "static-web-apps-free": ["static-web-app", "site", ["Microsoft.Web/staticSites"]],
  ...Object.fromEntries(["b0", "b1"].map(r => [`managed-redis-${r}`, ["managed-redis", "cache", ["Microsoft.Cache/redisEnterprise", "Microsoft.Cache/redisEnterprise/databases"]]])),
  ...Object.fromEntries(["b1ms", "b2s", "gp-2vcore", "gp-4vcore"].map(r => [`postgres-flex-${r}`, ["postgres-compute", "compute", ["Microsoft.DBforPostgreSQL/flexibleServers"]]])),
  "postgres-flex-storage": ["postgres-storage", "storage", ["Microsoft.DBforPostgreSQL/flexibleServers"]],
  "virtual-network": ["virtual-network", "network", ["Microsoft.Network/virtualNetworks"]],
  "virtual-network-subnet": ["subnet", "subnet", ["Microsoft.Network/virtualNetworks/subnets"]],
  "public-ipv4-standard": ["public-ip", "frontend", ["Microsoft.Network/publicIPAddresses"]],
  "key-vault-operations": ["key-vault", "operations", ["Microsoft.KeyVault/vaults"]],
  "log-analytics-ingestion": ["log-analytics", "ingestion", ["Microsoft.OperationalInsights/workspaces"]],
  "internet-egress": ["billing-only", "egress", []],
  "cosmos-db-serverless-ru": ["cosmos-serverless", "request-units", ["Microsoft.DocumentDB/databaseAccounts"]],
  "front-door-standard-base": ["front-door", "base", ["Microsoft.Cdn/profiles"]],
};

export const componentSchema = z.strictObject({
  id: componentIdSchema,
  name: localizedTextSchema,
  category: componentCategorySchema,
  description: localizedTextSchema,
  unitLabel: localizedTextSchema,
  bicepResourceTypes: bicepResourceTypesSchema,
  bicepDeployment: postgresDeploymentMappingSchema.optional(),
  extensionDeployment: componentBicepDeploymentSchema.optional(),
  pricing: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("metered"),
      priceRegion: textSchema.optional(),
      productName: textSchema,
      skuName: textSchema,
      meterName: textSchema,
      unitOfMeasure: textSchema,
      meterUnitsPerQuantity: quantitySchema,
    }),
    z.strictObject({ kind: z.literal("free") }),
  ]),
  usage: z
    .strictObject({
      defaultQuantity: quantitySchema,
      assumptionLabel: assumptionLabelSchema,
    })
    .optional(),
}).superRefine((component, context) => {
  const deployment = component.extensionDeployment;
  if (deployment) {
    const identity = deploymentIdentity[component.id];
    let valid = identity && deployment.kind === identity[0] && deployment.role === identity[1]
      && identity[2].every(type => component.bicepResourceTypes.includes(type));
    valid &&= deployment.locationBasis === (deployment.kind === "static-web-app" ? "service-location-input" : deployment.kind === "front-door" ? "global" : "selected-region");
    if (deployment.kind === "billing-only") valid &&= component.bicepResourceTypes.length === 0;
    if (deployment.kind === "app-service-plan") {
      const sku = component.pricing.kind === "metered" ? component.pricing.skuName.replaceAll(" ", "") : "";
      const premium = sku.startsWith("P");
      valid &&= deployment.skuName === sku && deployment.skuTier === (premium ? "PremiumV3" : "Basic") && deployment.supportsZoneRedundancy === premium;
    }
    if (deployment.kind === "functions") {
      const dedicated = deployment.role === "dedicated-capacity";
      valid &&= deployment.hosting === (dedicated ? "Dedicated" : "Consumption") && deployment.skuName === (dedicated ? "P1v3" : "Y1") && deployment.skuTier === (dedicated ? "PremiumV3" : "Dynamic");
    }
    if (deployment.kind === "blob-storage") valid &&= deployment.skuName === (component.id === "blob-hot-zrs" ? "Standard_ZRS" : "Standard_LRS");
    if (deployment.kind === "static-web-app") {
      const standard = component.id === "static-web-apps-standard";
      valid &&= deployment.skuName === (standard ? "Standard" : "Free") && deployment.skuTier === deployment.skuName && deployment.linkedBackendAllowed === standard;
    }
    if (deployment.kind === "managed-redis") valid &&= deployment.skuName === (component.id === "managed-redis-b0" ? "Balanced_B0" : "Balanced_B1");
    if (!valid) context.addIssue({ code: "custom", path: ["extensionDeployment"], message: "Invalid component deployment role or facts." });
  }
  const mapping = component.bicepDeployment;
  if (!mapping) return;
  const expected = {
    "postgres-flex-b1ms": ["Standard_B1ms", "Burstable", "official-example"],
    "postgres-flex-b2s": ["Standard_B2s", "Burstable", "inferred-vm-series"],
    "postgres-flex-gp-2vcore": ["Standard_D2ds_v5", "GeneralPurpose", "inferred-vm-series"],
    "postgres-flex-gp-4vcore": ["Standard_D4ds_v5", "GeneralPurpose", "official-example"],
  }[component.id];
  const matches = mapping.kind === "postgres-flex-storage"
    ? component.id === "postgres-flex-storage" && component.usage !== undefined
    : expected && mapping.skuName === expected[0] && mapping.tier === expected[1] && mapping.mappingBasis === expected[2];
  if (!matches || component.pricing.kind !== "metered"
    || !component.bicepResourceTypes.includes("Microsoft.DBforPostgreSQL/flexibleServers")) {
    context.addIssue({ code: "custom", path: ["bicepDeployment"], message: "Invalid PostgreSQL deployment mapping for component." });
  }
  if (mapping.kind === "postgres-flex-compute") {
    const ha = mapping.allowedHighAvailabilityModes?.includes("ZoneRedundant") ?? false;
    if (ha !== (mapping.highAvailabilityBilling !== undefined) || (mapping.tier === "Burstable" && ha))
      context.addIssue({ code: "custom", path: ["bicepDeployment"], message: "Invalid HA billing basis or Burstable mode." });
  }
});

export const planItemSchema = z.strictObject({
  componentId: componentIdSchema,
  quantity: quantitySchema,
});

export const connectionSchema = z.strictObject({
  from: idSchema,
  to: idSchema,
});

const architectureTierSchema = z.strictObject({
  title: localizedTextSchema,
  items: z.array(planItemSchema),
  connections: z.array(connectionSchema),
  pros: z.array(localizedTextSchema),
  cons: z.array(localizedTextSchema),
  deploymentIntent: extensionDeploymentIntentSchema.optional(),
});

export const referenceArchitectureSchema = z.strictObject({
  id: idSchema,
  name: localizedTextSchema,
  suitableFor: localizedTextSchema,
  sources: z
    .array(z.strictObject({ title: textSchema, url: sourceUrlSchema }))
    .min(1, "출처가 하나 이상 필요합니다."),
  tiers: z.record(tierSchema, architectureTierSchema),
});

export const priceTierSchema = z.strictObject({
  minUnits: nonnegativeSchema,
  unitPrice: nonnegativeSchema,
  convertedFromUsd: z.literal(true).optional(),
});

const priceTiersSchema = z
  .array(priceTierSchema)
  .min(1, "가격 구간이 하나 이상 필요합니다.")
  .superRefine(
    (tiers, context) => {
      const seen = new Set<number>();
      let previousUnits: number | undefined;
      tiers.forEach((tier, index) => {
        // 다른 필드가 잘못되어도 유효한 minUnits의 순서와 중복을 검사한다.
        const minUnits = tier?.minUnits;
        if (typeof minUnits !== "number" || !Number.isFinite(minUnits)) return;
        const path = [index, "minUnits"];
        if (index === 0 && minUnits !== 0) {
          context.addIssue({
            code: "custom",
            path,
            message: "첫 가격 구간의 minUnits는 0이어야 합니다.",
          });
        }
        if (seen.has(minUnits)) {
          context.addIssue({
            code: "custom",
            path,
            message: "가격 구간의 minUnits가 중복되었습니다.",
          });
        }
        if (previousUnits !== undefined && minUnits < previousUnits) {
          context.addIssue({
            code: "custom",
            path,
            message: "가격 구간의 minUnits는 오름차순이어야 합니다.",
          });
        }
        seen.add(minUnits);
        previousUnits = minUnits;
      });
    },
    { when: ({ value }) => Array.isArray(value) },
  );

export const priceSnapshotSchema = z.strictObject({
  asOf: z.iso.date(),
  currency: z.literal("CAD"),
  regions: z.array(textSchema).min(1).refine(regions => new Set(regions).size === regions.length, "지역은 중복할 수 없습니다."),
  usdToCad: z.strictObject({ rate: quantitySchema, pairs: z.number().int().min(5) }),
  prices: z.record(
    componentIdSchema,
    z.record(textSchema, z.strictObject({
      meterId: textSchema,
      unitOfMeasure: textSchema,
      tiers: priceTiersSchema,
    })),
  ),
});

export const catalogSchema = z.strictObject({
  components: z.array(componentSchema),
  architectures: z.array(referenceArchitectureSchema),
  prices: priceSnapshotSchema,
});
