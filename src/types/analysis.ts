import type { LocalizedText } from "@/types/i18n";
import type { Connection, PlanItem, Tier } from "@/types/catalog";
import type { PlanCost } from "@/types/cost";
import type { LlmUsage } from "@/types/llm";

export type ExpectedUsers = "under-100" | "under-1k" | "under-10k" | "under-100k" | "over-100k";
export type Availability = "low" | "medium" | "high";

export type AnalysisInput = {
  description: string;
  expectedUsers: ExpectedUsers;
  monthlyBudget: number;
  region: string;
  availability: Availability;
};

export type ModelPlan = {
  tier: Tier;
  referenceArchitectureId: string;
  title: LocalizedText;
  items: PlanItem[];
  pros: LocalizedText[];
  connections: Connection[];
};

export type ModelOutput = {
  requestTitle: LocalizedText;
  outOfScope: boolean;
  recommendedTier: Tier;
  recommendationReason: LocalizedText;
  plans: ModelPlan[];
};

export type PlanResult = {
  tier: Tier;
  title: LocalizedText;
  recommended: boolean;
  referenceArchitecture: { id: string; name: LocalizedText; sources: { title: string; url: string }[] };
  services: { componentId: string; name: LocalizedText; quantity: number; unitLabel: LocalizedText }[];
  pros: LocalizedText[];
  cost: PlanCost;
  mermaid: LocalizedText;
  // 구성요소 간 연결(카탈로그 ID). 다이어그램 대체 텍스트와 Pro 결과물 프롬프트가 쓴다.
  // 이 필드가 생기기 전에 저장된 결과에는 없으므로 선택 필드다.
  connections?: Connection[];
};

// 저장하고 화면에 그리는 분석 결과. 비용과 기준일은 가격 스냅샷에서 가져온다.
export type AnalysisResult = {
  region: string;
  currency: "CAD";
  requestTitle: LocalizedText;
  input: AnalysisInput;
  outOfScope: boolean;
  recommendedTier: Tier;
  recommendationReason: LocalizedText;
  priceAsOf: string;
  plans: PlanResult[];
};

export type StructuredLlmRequest = {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  // 검증 실패 뒤 다시 부를 때 작업 시간 안에 남은 만큼만 준다. 생략하면 호출하는 쪽의 기본값이다.
  timeoutMs?: number;
};

export type StructuredLlm = (request: StructuredLlmRequest) => Promise<{ data: unknown; usage: LlmUsage | null }>;

// retryErrors: 첫 출력이 검증에 실패해 한 번 다시 불렀을 때 그 첫 오류(ADR-022). eval 보고서가 쓴다.
export type AnalysisOutcome =
  | { ok: true; result: AnalysisResult; usage: LlmUsage | null; retryErrors?: string[] }
  | { ok: false; stage: "input" | "llm" | "validation"; errors: string[]; usage: LlmUsage | null; retryErrors?: string[] };
