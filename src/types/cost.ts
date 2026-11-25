import type { LocalizedText } from "@/types/i18n";
export type CostLine = {
  componentId: string;
  name: LocalizedText;
  quantity: number;
  unitLabel: LocalizedText;
  assumptionLabel: LocalizedText | null;
  hourly: boolean;
  isAssumption: boolean;
  amount: number;
};

export type PlanCost = {
  currency: "CAD";
  lines: CostLine[];
  total: number;
  budgetRatio: number | null;
};
