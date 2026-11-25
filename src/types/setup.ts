export type ClaudeOverview = {
  source: "key" | "env" | "disabled";
  apiKeyEnv: string | null;
  model: string;
  available: boolean;
  needsSetup: boolean;
};
export type ClaudeTestStatus = "verified" | "unauthorized" | "modelUnavailable" | "modelMissing" | "rateLimited" | "unreachable" | "disabled";
export type SetupFormState = { saved?: true; error?: "setup.invalid" | "setup.storage"; test?: ClaudeTestStatus; checkedAt?: string };
export type AzureDiagnosticStatus = "missing" | "subscriptionsMissing" | "ready" | "expiring" | "verified" | "forbidden" | "subscriptionMissing" | "unreachable"
  | "certificate-not-found" | "certificate-invalid" | "certificate-expired" | "certificate-password-missing" | "auth-failed";
export type AzureDiagnostic = { status: AzureDiagnosticStatus; subscriptionCount: number; validTo?: string };
export type AzureTestFormState = { result?: AzureDiagnostic; checkedAt?: string };
