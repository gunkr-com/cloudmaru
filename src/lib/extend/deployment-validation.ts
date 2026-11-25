import { getComponentBicepDeployment, getExtensionDeploymentIntent, getPostgresDeploymentMapping } from "@/lib/catalog/extension-deployment";
import { parsePrefix, prefixesOverlap } from "@/lib/network/cidr";
import type { Catalog } from "@/types/catalog";
import type { ExtensionProposal } from "@/types/extension";
import type { InventoryResource } from "@/types/inventory";

type Plan = ExtensionProposal["plans"][number];
export type ExtensionDeploymentValidationContext = { catalog: Catalog; resources: readonly InventoryResource[]; region: string };

/** Pure current-generation constraints over the caller's pinned catalog and selected IDs.
 * These are draft configuration/billing checks, never Azure availability or capacity proof.
 * Paths/codes contain no inventory IDs, names, CIDRs, sources or model prose. */
export function validateExtensionDeploymentPlan(plan: Plan, context: ExtensionDeploymentValidationContext): string[] {
  const { catalog } = context, errors: string[] = [];
  const fail = (path: string, code: string) => errors.push(`${path}: ${code}`);
  const component = (id: string) => catalog.components.find(c => c.id === id);
  const entries = plan.newItems.map(item => ({ item, component: component(item.componentId), mapping: component(item.componentId) ? getComponentBicepDeployment(component(item.componentId)!) : null }));
  const group = (kind: string) => entries.filter(e => e.mapping?.kind === kind);
  const count = (entry: typeof entries[number]) => entry.item.instanceCount ?? 0;
  for (const [i, entry] of entries.entries()) if (entry.component && !entry.mapping)
    fail(`newItems.${i}`, "component-deployment-mapping-required");
  const intent = getExtensionDeploymentIntent(catalog, plan.referenceArchitectureId, plan.tier);
  if (!intent) {
    if (entries.length) fail("referenceArchitectureId", "deployment-intent-required");
    return errors;
  }
  const pg = group("postgres-compute");
  for (const entry of pg) {
    const mapping = getPostgresDeploymentMapping(entry.component!);
    const ha = intent.postgres.highAvailabilityMode === "ZoneRedundant";
    if (ha && (mapping?.kind !== "postgres-flex-compute" || mapping.tier !== "GeneralPurpose"
      || !mapping.allowedHighAvailabilityModes?.includes("ZoneRedundant")
      || mapping.highAvailabilityBilling?.billingInstancesPerRoot !== intent.postgres.billingInstancesPerRoot
      || count(entry) < 2 || count(entry) % 2 !== 0 || count(entry) !== entry.item.quantity))
      fail("newItems", "postgres-native-ha-billing-basis-mismatch");
  }
  const asp = group("app-service-plan");
  if (asp.length && (!intent.appService || asp.length !== 1 || count(asp[0]) < intent.appService.minimumCapacity
    || intent.appService.zoneRedundant && (asp[0].mapping?.kind !== "app-service-plan" || !asp[0].mapping.supportsZoneRedundancy)))
    fail("newItems", "app-service-capacity-intent-mismatch");

  const ca = group("container-apps");
  if (ca.length) {
    const cpu = ca.find(e => e.mapping?.role === "cpu"), memory = ca.find(e => e.mapping?.role === "memory");
    if (!intent.containerApps || ca.length !== 3 || new Set(ca.map(e => e.mapping?.role)).size !== 3
      || !cpu || !memory || count(cpu) < intent.containerApps.minimumReplicas || ca.some(e => count(e) !== count(cpu)))
      fail("newItems", "container-coupled-meter-basis-mismatch");
    else {
      // Read the pinned reviewed WorkloadProfiles Consumption resource combinations.
      const perCpu = cpu.item.quantity / count(cpu), perMemory = memory.item.quantity / count(cpu);
      const facts = cpu.mapping;
      if (facts?.kind !== "container-apps" || !Number.isInteger(perCpu / facts.cpuIncrement) || perCpu < facts.cpuIncrement
        || perCpu > facts.maximumCpu || Math.abs(perMemory - perCpu * facts.memoryGiBPerCpu) > 1e-9)
        fail("newItems", "container-resource-profile-mismatch");
    }
  }
  const functions = group("functions");
  if (functions.length) {
    const dedicated = functions.filter(e => e.mapping?.role === "dedicated-capacity");
    const valid = intent.functions && (dedicated.length ? intent.functions.hosting === "Dedicated" && functions.length === 1 && dedicated.length === 1
      && count(dedicated[0]) >= intent.functions.minimumCapacity
      : intent.functions.hosting === "Consumption" && functions.length === 2 && new Set(functions.map(e => e.mapping?.role)).size === 2
        && functions.every(e => count(e) === 1));
    if (!valid)
      fail("newItems", "functions-hosting-meter-basis-mismatch");
  }

  const selectedNew = (id: string) => entries.find(e => e.item.componentId === id);
  const hasBinding = (role: "gateway-backend" | "gateway-public-ip" | "function-storage" | "static-backend", fromKind: string, toKind: string) => {
    const binding = intent.bindings.find(b => b.role === role);
    if (!binding) return false;
    const from = selectedNew(binding.fromComponentId), to = selectedNew(binding.toComponentId);
    // A selected existing plan/account alone is not a newly declared site/host/storage basis.
    // No arbitrary external endpoint/account IDs may be supplied to fill a missing relation.
    return from?.mapping?.kind === fromKind && to?.mapping?.kind === toKind
      && (to.mapping.kind === "functions" && to.mapping.role === "dedicated-capacity" || count(to) === 1);
  };
  if (functions.length && !hasBinding("function-storage", "functions", "blob-storage"))
    fail("newItems", "function-storage-binding-required");
  const staticSites = group("static-web-app");
  if (staticSites.length && intent.bindings.some(b => b.role === "static-backend" && selectedNew(b.fromComponentId))
    && !hasBinding("static-backend", "static-web-app", "functions"))
    fail("newItems", "static-backend-binding-required");
  const gateways = group("application-gateway");
  if (gateways.length) {
    if (!intent.applicationGateway || !intent.publicIp) fail("newItems", "gateway-capacity-zone-intent-required");
    if (gateways.length !== 2 || new Set(gateways.map(e => e.mapping?.role)).size !== 2 || gateways.some(e => count(e) !== 1)
      || gateways.find(e => e.mapping?.role === "fixed")?.item.quantity !== 1)
      fail("newItems", "gateway-coupled-meter-basis-mismatch");
    if (!hasBinding("gateway-public-ip", "application-gateway", "public-ip")) fail("newItems", "gateway-public-ip-binding-required");
    const backend = intent.bindings.find(b => b.role === "gateway-backend");
    // The artifact contract declares a NEW guarded site for each selected existing plan.
    // This binds that helper, never an inferred existing site or an unverified hostname.
    const reusedBackend = backend && plan.reusedResources.filter(r => r.componentId === backend.toComponentId);
    const helperBasis = reusedBackend && reusedBackend.length > 0 && reusedBackend.every(r =>
      context.resources.some(resource => resource.id === r.resourceId && resource.type.toLowerCase() === "microsoft.web/serverfarms"));
    if (!backend || selectedNew(backend.fromComponentId)?.mapping?.kind !== "application-gateway"
      || selectedNew(backend.toComponentId)?.mapping?.kind !== "app-service-plan" && !helperBasis) fail("newItems", "gateway-backend-binding-required");
  }

  const required = intent.networkRequirements.filter(n => selectedNew(n.componentId));
  if (gateways.length && !required.some(n => n.role === "gateway-subnet")
    || ca.length && intent.containerApps?.subnetRequired && !required.some(n => n.role === "container-environment-subnet"))
    fail("deploymentBindings", "reference-network-role-required");
  for (const requirement of required) if (!plan.deploymentBindings?.some(b => b.role === requirement.role))
    fail("deploymentBindings", "required-subnet-binding-missing");
  const ranges: string[][] = [], targets = new Set<string>();
  for (const [i, binding] of (plan.deploymentBindings ?? []).entries()) {
    const path = `deploymentBindings.${i}`, requirement = required.find(n => n.role === binding.role);
    if (!requirement) { fail(path, "unselected-network-role"); continue; }
    let prefixes: string[] = [], delegation: string | undefined, dedicated = true;
    const target = binding.target;
    const identity = target.kind === "new-subnet" ? `new:${target.subnetProposalId}` : `reuse:${target.resourceId}`;
    if (targets.has(identity)) fail(path, "subnet-role-conflict");
    targets.add(identity);
    if (target.kind === "new-subnet") {
      const subnet = plan.subnetProposals.find(s => s.id === target.subnetProposalId);
      if (!subnet || subnet.region !== context.region) { fail(path, "selected-subnet-required"); continue; }
      prefixes = subnet.addressPrefixes; delegation = subnet.delegation;
    } else {
      const selected = plan.reusedResources.find(r => r.resourceId === target.resourceId);
      const resource = context.resources.find(r => r.id === target.resourceId);
      if (!selected || component(selected.componentId)?.extensionDeployment?.kind !== "subnet"
        || !resource || resource.type.toLowerCase() !== "microsoft.network/virtualnetworks/subnets" || resource.location !== context.region) {
        fail(path, "selected-subnet-required"); continue;
      }
      const p = resource.properties;
      prefixes = Array.isArray(p.addressPrefixes) && p.addressPrefixes.every(v => typeof v === "string") ? p.addressPrefixes as string[]
        : typeof p.addressPrefix === "string" ? [p.addressPrefix] : [];
      const delegations = Array.isArray(p.delegations) ? p.delegations : null;
      if (delegations?.length === 1) {
        const d = delegations[0] as { properties?: { serviceName?: string } };
        delegation = d?.properties?.serviceName;
      } else if (!delegations || delegations.length > 1) dedicated = false;
      // Occupancy must be observed empty; absence is unknown, not permission to attach.
      dedicated &&= ["ipConfigurations", "applicationGatewayIPConfigurations", "privateEndpoints", "serviceAssociationLinks"]
        .every(key => Array.isArray(p[key]) && (p[key] as unknown[]).length === 0);
    }
    if (!dedicated || delegation !== (requirement.delegation === "none" ? undefined : requirement.delegation)) fail(path, "incompatible-subnet-role");
    if (!prefixes.length || prefixes.some(value => {
      const prefix = parsePrefix(value);
      return !prefix || prefix.version !== 4 || prefix.length > requirement.maximumPrefixLength;
    })) fail(path, "subnet-size-basis-mismatch");
    if (ranges.some(other => prefixes.some(p => other.some(o => prefixesOverlap(p, o) === true)))) fail(path, "subnet-role-overlap");
    ranges.push(prefixes);
  }
  return errors;
}
