import type { CompletionReasonCode, ModelInventoryPayload, SourceScan } from "./completion";
import type { ExtensionSupportCatalog, ReusePolicy } from "./extension-support";
import type { InventoryResource } from "./inventory";

export type ReuseContextOptions = {
  region: string;
  support?: ExtensionSupportCatalog;
};
export type ReuseCandidate = {
  resourceId: string;
  componentId: string | null;
  policyId: string | null;
  eligibility: "supported" | "unsupported" | "unknown";
  reasonCodes: CompletionReasonCode[];
  capacity: "unverified";
  additionalUsage: ReusePolicy["additionalUsage"] | null;
  notes: ReusePolicy["notes"] | null;
};
// 전체 저장 자료를 쓰는 서버 전용 검사 결과. 모델에는 투영 payload만 전달한다.
export type ReuseCandidates = {
  sourceScan: SourceScan;
  resources: InventoryResource[];
  candidates: ReuseCandidate[];
};
export type ExtensionModelContextOptions = ReuseContextOptions & {
  relevantResourceIds?: readonly string[];
  maxResources?: number;
};
export type ExtensionModelPayload = {
  schemaVersion: 1;
  inventory: ModelInventoryPayload;
  candidates: (Omit<ReuseCandidate, "resourceId" | "notes"> & { alias: string })[];
};
export type ExtensionModelContext = {
  payload: ExtensionModelPayload;
  // 열거/JSON 직렬화 대상이 아니다. 모델 출력 역매핑에만 사용한다.
  aliasToResourceId: ReadonlyMap<string, string>;
};
