import type { Catalog, Component, ComponentBicepDeployment, ExtensionDeploymentIntent, PostgresDeploymentMapping, Tier } from "@/types/catalog";

/** Reads only the caller's validated pinned component. Missing old metadata needs action;
 * never infer a mapping from an ID or replace it with today's catalog. Evidence basis and
 * unknown regional capabilities remain available for code-owned deployment notes. */
export function getPostgresDeploymentMapping(component: Component): PostgresDeploymentMapping | null {
  return component.bicepDeployment ?? null;
}

export function getComponentBicepDeployment(component: Component): ComponentBicepDeployment | null {
  return component.extensionDeployment ?? null;
}

export function getExtensionDeploymentIntent(catalog: Catalog, referenceId: string, tier: Tier): ExtensionDeploymentIntent | null {
  return catalog.architectures.find(a => a.id === referenceId)?.tiers[tier].deploymentIntent ?? null;
}
