import type { z } from "zod";
import type {
  componentStateSchema, coverageSchema, evidenceSchema, observationSchema, reasonCodeSchema, sourceScanSchema,
} from "@/lib/completion/schema";

export type JsonValue = null | boolean | string | number | JsonValue[] | { [key: string]: JsonValue };
export type ComponentState = z.infer<typeof componentStateSchema>;
export type CompletionReasonCode = z.infer<typeof reasonCodeSchema>;
export type ComponentResult<T> =
  | { state: "not-requested" }
  | { state: "available"; data: T }
  | { state: "partial"; data: T; reasons: CompletionReasonCode[] }
  | { state: "unavailable"; reason: CompletionReasonCode }
  | { state: "failed"; reason: CompletionReasonCode };
export type Coverage = z.infer<typeof coverageSchema>;
export type SourceScan = z.infer<typeof sourceScanSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;

// 모델 맥락은 저장 결과와 별개다. 원본 문자열을 허용하는 열린 facts 객체를 두지 않는다.
export type ModelResourceFacts = {
  httpsOnly?: boolean;
  minimumTlsVersion?: "1.0" | "1.1" | "1.2" | "1.3";
  ftpsState?: "disabled" | "ftps-only" | "all-allowed";
  publicNetworkAccess?: "enabled" | "disabled" | "secured-by-perimeter";
  supportsHttpsTrafficOnly?: boolean;
  allowBlobPublicAccess?: boolean;
  enableSoftDelete?: boolean;
  enablePurgeProtection?: boolean;
  enableRbacAuthorization?: boolean;
  reserved?: boolean;
  zoneRedundant?: boolean;
};
export type ModelContextResource = {
  alias: string; type: string; location: string | null; facts: ModelResourceFacts;
};
export type ModelContextOptions = {
  // 호출자가 검토된 카탈로그/규칙에서 가져온 허용 목록이다. 지원 정책을 추론하지 않는다.
  supportedResourceTypes: readonly string[];
  allowedLocations: readonly string[];
  relevantResourceIds?: readonly string[];
  maxResources?: number;
};
export type ModelInventoryPayload = {
  schemaVersion: 1;
  limit: number;
  resources: ModelContextResource[];
  coverage: Coverage;
  selection: { requested: number; matched: number; rejected: number; missing: number; duplicates: number } | null;
  summary: {
    byType: { type: string; count: number }[];
    byLocation: { location: string | null; count: number }[];
  };
};
export type ModelInventoryContext = {
  payload: ModelInventoryPayload;
  // 서버 내부에서만 사용한다. 모델 요청에는 payload만 직렬화한다.
  aliasToResourceId: ReadonlyMap<string, string>;
};
