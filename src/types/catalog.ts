import type { z } from "zod";
import type {
  catalogSchema,
  componentCategorySchema,
  componentSchema,
  componentBicepDeploymentSchema,
  extensionDeploymentIntentSchema,
  connectionSchema,
  planItemSchema,
  postgresDeploymentMappingSchema,
  priceSnapshotSchema,
  priceTierSchema,
  referenceArchitectureSchema,
  tierSchema,
} from "@/lib/catalog/schema";

export type Tier = z.infer<typeof tierSchema>;
export type ComponentCategory = z.infer<typeof componentCategorySchema>;
export type Component = z.infer<typeof componentSchema>;
export type ComponentBicepDeployment = z.infer<typeof componentBicepDeploymentSchema>;
export type ExtensionDeploymentIntent = z.infer<typeof extensionDeploymentIntentSchema>;
export type PostgresDeploymentMapping = z.infer<typeof postgresDeploymentMappingSchema>;
export type PlanItem = z.infer<typeof planItemSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type ReferenceArchitecture = z.infer<typeof referenceArchitectureSchema>;
export type PriceTier = z.infer<typeof priceTierSchema>;
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
