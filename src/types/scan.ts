import type { Inventory, InventorySummary } from "@/types/inventory";
import type { JobStatus } from "@/types/job";

export type ScanSource = "live" | "import";
// API와 DB에는 코드만 두고, 화면 문구는 사전에서 처리한다.
export type ScanErrorCode =
  | "connection-missing"
  | "certificate-not-found"
  | "certificate-invalid"
  | "certificate-expired"
  | "certificate-password-missing"
  | "auth-failed"
  | "forbidden"
  | "subscription-not-found"
  | "throttled"
  | "timeout"
  | "too-many-rows"
  | "invalid-response"
  | "interrupted"
  | "internal";
export type AzureConnection = {
  tenantId: string;
  clientId: string;
  certificatePath: string;
  certificatePasswordEnv: string | null;
};
export type WorkspaceAzureSettings = { connection: AzureConnection | null; subscriptionIds: string[] };
export type AzureConnectionField = "tenantId" | "clientId" | "certificatePath" | "certificatePasswordEnv" | "subscriptionIds";
// 입력값은 폼이 자기 상태로 유지한다. 서버는 오류 코드만 돌려준다.
export type AzureConnectionFormState = {
  errors?: Partial<Record<AzureConnectionField, string>>;
  message?: string;
};
export type ScanRecord = {
  id: string;
  workspaceId: string;
  source: ScanSource;
  status: JobStatus;
  subscriptionIds: string[];
  summary: InventorySummary | null;
  collectedAt: string | null;
  errorCode: ScanErrorCode | null;
  createdAt: string;
  completedAt: string | null;
};
export type ScanInventory = Pick<Inventory, "resources" | "containers" | "relations" | "skippedRows">;
// 스캔 API의 오류 코드. 화면은 이 코드를 사전 키로 바꿔 보여 준다.
export type ScanApiErrorCode =
  | "invalid-body" | "workspace-changed" | "connection-missing" | "import-invalid" | "import-too-many-rows"
  | "import-empty" | "import-too-large" | "not-found" | "internal";
// 완료한 스캔을 저장할 때 넘기는 값. inventory 컬럼에는 본문만 둔다.
export type ScanData = { inventory: ScanInventory; summary: InventorySummary; collectedAt: string; subscriptionIds: string[] };
