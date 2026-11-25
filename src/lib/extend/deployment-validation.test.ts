import { describe, expect, it } from "vitest";
import { loadCatalog } from "@/lib/catalog/load";
import { validateExtensionDeploymentPlan } from "./deployment-validation";
import { referencePlan } from "./deployment.test-data";
import type { ExtensionProposal } from "@/types/extension";

const catalog = loadCatalog();
const validate = (plan: ExtensionProposal["plans"][number], pinned = catalog) => validateExtensionDeploymentPlan(plan, {catalog: pinned, resources: [], region: "canadacentral"});

describe("current reference topology and role constraints", () => {
  it.each(catalog.architectures.flatMap(a => ["low", "balanced", "ha"].map(t => [a.id, t] as const)))("accepts the full current %s/%s with explicit prerequisites and unchanged billed quantities", (id, tier) => {
    const plan = referencePlan(id, tier as "low" | "balanced" | "ha"), before = structuredClone(plan);
    expect(validate(plan)).toEqual([]); expect(plan).toEqual(before);
  });
  it("uses explicit intent rather than inferring HA from the tier label", () => {
    const p = referencePlan("app-service-basic-web-app", "ha");
    const pinned = structuredClone(catalog);
    pinned.architectures[0].tiers.ha.deploymentIntent!.postgres = {highAvailabilityMode: "Disabled", billingInstancesPerRoot: 1};
    const db = p.newItems.find(i => i.componentId === "postgres-flex-gp-2vcore")!;
    db.quantity = db.instanceCount = 1;
    const storage = p.newItems.find(i => i.componentId === "postgres-flex-storage")!;
    storage.quantity = 32; storage.instanceCount = 1;
    expect(validate(p, pinned)).toEqual([]);
    expect(validate(p)).toContain("newItems: postgres-native-ha-billing-basis-mismatch");
    delete pinned.architectures[0].tiers.ha.deploymentIntent;
    expect(validate(p, pinned)).toContain("referenceArchitectureId: deployment-intent-required");
  });
  it.each(["burstable", "odd", "zero", "partial"])("rejects incoherent native HA: %s", kind => {
    const p = referencePlan("app-service-basic-web-app", "ha"), db = p.newItems.find(i => i.componentId === "postgres-flex-gp-2vcore")!;
    if (kind === "burstable") db.componentId = "postgres-flex-b2s";
    if (kind === "odd") db.quantity = db.instanceCount = 3;
    if (kind === "zero") db.quantity = db.instanceCount = 0;
    if (kind === "partial") delete db.instanceCount;
    expect(validate(p)).toContain("newItems: postgres-native-ha-billing-basis-mismatch");
  });
  it.each(["container-member", "container-count", "container-shape", "functions-member", "functions-count", "functions-double-charge", "gateway-member", "gateway-count"])("rejects coupled meter drift: %s", kind => {
    const p = referencePlan(kind.startsWith("container") ? "container-apps-web-api" : kind.startsWith("functions") ? "serverless-static-web-app" : "app-service-zone-redundant", "balanced");
    if (kind.endsWith("member")) p.newItems = p.newItems.filter(i => i.componentId !== (kind.startsWith("container") ? "container-apps-memory" : kind.startsWith("functions") ? "functions-consumption-duration" : "application-gateway-v2-capacity"));
    if (kind.endsWith("count")) p.newItems.find(i => i.componentId === (kind.startsWith("container") ? "container-apps-memory" : kind.startsWith("functions") ? "functions-consumption-duration" : "application-gateway-v2-capacity"))!.instanceCount = 2 + (kind.startsWith("container") ? 1 : 0);
    if (kind === "container-shape") p.newItems.find(i => i.componentId === "container-apps-memory")!.quantity = 0.1;
    if (kind === "functions-double-charge") p.newItems.push({componentId: "functions-dedicated-p1v3", quantity: 2, instanceCount: 2});
    expect(validate(p).length).toBeGreaterThan(0);
  });
  it.each(["missing", "foreign", "delegation", "size"])("rejects critical network prerequisite: %s", kind => {
    const p = referencePlan("container-apps-web-api", "ha");
    if (kind === "missing") delete p.deploymentBindings;
    if (kind === "foreign") p.deploymentBindings![0].target = {kind: "new-subnet", subnetProposalId: "unselected-private-subnet"};
    if (kind === "delegation") delete p.subnetProposals[0].delegation;
    if (kind === "size") p.subnetProposals[0].addressPrefixes = ["10.2.0.0/28"];
    const result = validate(p);
    expect(result.some(e => e.startsWith("deploymentBindings"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("unselected-private-subnet");
  });
  it("requires Functions selected paired storage and distinct gateway subnet/frontend/backend", () => {
    const f = referencePlan("serverless-static-web-app", "low");
    f.newItems = f.newItems.filter(i => i.componentId !== "blob-hot-lrs");
    expect(validate(f)).toContain("newItems: function-storage-binding-required");
    const gateway = referencePlan("app-service-zone-redundant", "balanced");
    gateway.subnetProposals[0].delegation = "Microsoft.App/environments";
    expect(validate(gateway)).toContain("deploymentBindings.0: incompatible-subnet-role");
    gateway.newItems = gateway.newItems.filter(i => i.componentId !== "public-ipv4-standard");
    expect(validate(gateway)).toContain("newItems: gateway-public-ip-binding-required");
  });
  it.each([
    ["container-apps-web-api", "10.2.0.0/27", true], ["container-apps-web-api", "10.2.0.0/26", true],
    ["container-apps-web-api", "10.2.0.0/28", false], ["container-apps-web-api", "fd00::/64", false],
    ["app-service-zone-redundant", "10.2.0.0/24", true], ["app-service-zone-redundant", "10.2.0.0/23", true],
    ["app-service-zone-redundant", "10.2.0.0/25", false], ["app-service-zone-redundant", "fd00::/64", false],
  ])("uses explicit IPv4 maximum prefix boundary: %s %s", (id, prefix, ok) => {
    const p = referencePlan(id as string, "ha");
    p.subnetProposals[0].addressPrefixes = [prefix as string];
    expect(validate(p).length === 0).toBe(ok);
  });
  it("binds a selected saved subnet by exact identity and observed empty role evidence", () => {
    const p = referencePlan("app-service-zone-redundant", "low");
    p.subnetProposals = []; p.newItems = p.newItems.filter(i => !i.componentId.startsWith("virtual-network"));
    const subnetId = "/subscriptions/00000000-0000-4000-8000-000000000001/resourcegroups/synthetic/providers/microsoft.network/virtualnetworks/net/subnets/gateway";
    p.reusedResources = [{resourceId: subnetId, componentId: "virtual-network-subnet", reason: {en: "Use selected subnet", ko: "선택한 서브넷을 사용합니다."}}];
    p.deploymentBindings = [{role: "gateway-subnet", target: {kind: "reused-subnet", resourceId: subnetId}}];
    const resource = {id: subnetId, type: "microsoft.network/virtualnetworks/subnets", location: "canadacentral", properties: {
      addressPrefix: "10.2.0.0/24", delegations: [], ipConfigurations: [], applicationGatewayIPConfigurations: [], privateEndpoints: [], serviceAssociationLinks: [],
    }};
    const validateSaved = (resources: unknown[], plan = p) => validateExtensionDeploymentPlan(plan, {catalog, resources: resources as Parameters<typeof validateExtensionDeploymentPlan>[1]["resources"], region: "canadacentral"});
    expect(validateSaved([resource])).toEqual([]);
    for (const key of ['ipConfigurations','applicationGatewayIPConfigurations','privateEndpoints','serviceAssociationLinks']) {
      for(const value of [undefined,null,[{id:'occupied'}]]) {
        const changed=structuredClone(resource);Object.assign(changed.properties,{[key]:value});
        expect(validateSaved([changed])).toContain('deploymentBindings.0: incompatible-subnet-role');
      }
    }
    for (const drift of [{id: subnetId.replace("000000000001", "000000000002")}, {location: "westus2"}, {type: "microsoft.network/virtualnetworks"}, {properties: {...resource.properties, ipConfigurations: undefined}}, {properties: {...resource.properties, ipConfigurations: [{id:"unobserved-private-attachment"}]}}]) {
      const errors = validateSaved([{...resource, ...drift}]);
      expect(errors.length).toBeGreaterThan(0); expect(JSON.stringify(errors)).not.toMatch(/subscriptions|private-attachment|10\.2/);
    }
    const unselected = structuredClone(p); unselected.reusedResources = [];
    expect(validateSaved([resource], unselected)).toContain("deploymentBindings.0: selected-subnet-required");
  });
});
