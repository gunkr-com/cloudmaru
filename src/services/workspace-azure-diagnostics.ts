import "server-only";
import { getWorkspaceAzureSettings } from "./db/workspace-azure";
import { checkConnectionCertificate, createCertificateTokenProvider } from "./azure/credential";
import { azureRequest } from "./azure/request";
import type { WorkspaceAzureSettings } from "@/types/scan";
import type { AzureDiagnostic, AzureDiagnosticStatus } from "@/types/setup";

type Deps = {
  getSettings: (id: string) => Promise<WorkspaceAzureSettings | null>;
  checkCertificate: typeof checkConnectionCertificate;
  request: (subscriptionId: string, settings: WorkspaceAzureSettings) => Promise<unknown>;
  now: () => Date;
};
const CREDENTIAL_STATUSES = ["auth-failed", "certificate-not-found", "certificate-invalid", "certificate-expired", "certificate-password-missing"] as const;
// Token acquisition failures carry only a closed kind. Map them so operators check registration or certificates, not connectivity.
function classify(error: unknown): AzureDiagnosticStatus {
  if (typeof error !== "object" || error === null || !("kind" in error)) return "unreachable";
  const { kind } = error;
  if ("name" in error && error.name === "AzureCredentialError") {
    return CREDENTIAL_STATUSES.find(status => status === kind) ?? "unreachable";
  }
  return kind === "forbidden" ? "forbidden" : kind === "not-found" ? "subscriptionMissing" : "unreachable";
}
export function createAzureDiagnostics(deps: Deps) {
  async function inspect(id: string) {
    const settings = await deps.getSettings(id);
    const subscriptionCount = settings?.subscriptionIds.length ?? 0;
    if (!settings?.connection) return { result: { status: "missing" as const, subscriptionCount } };
    const certificate = await deps.checkCertificate(settings.connection);
    if (!certificate.ok) return { result: { status: certificate.code, subscriptionCount } };
    if (!subscriptionCount) return { result: { status: "subscriptionsMissing" as const, subscriptionCount, validTo: certificate.validTo } };
    const expiring = Date.parse(certificate.validTo) - deps.now().getTime() <= 30 * 86_400_000;
    return { settings, result: { status: expiring ? "expiring" as const : "ready" as const, subscriptionCount, validTo: certificate.validTo } };
  }
  return {
    async local(id: string): Promise<AzureDiagnostic> {
      try { return (await inspect(id)).result; }
      catch { return { status: "unreachable", subscriptionCount: 0 }; }
    },
    async test(id: string): Promise<AzureDiagnostic> {
      let subscriptionCount = 0;
      try {
        const { settings, result } = await inspect(id);
        if (!settings) return result;
        subscriptionCount = result.subscriptionCount;
        for (const subscriptionId of settings.subscriptionIds) await deps.request(subscriptionId, settings);
        return { ...result, status: "verified" };
      } catch (error) {
        const status: AzureDiagnosticStatus = classify(error);
        return { status, subscriptionCount };
      }
    },
  };
}
export const { local: getAzureLocalDiagnostic, test: testAzureWorkspace } = createAzureDiagnostics({
  getSettings: getWorkspaceAzureSettings, checkCertificate: checkConnectionCertificate, now: () => new Date(),
  request: (subscriptionId, settings) => azureRequest({ method: "GET", path: `/subscriptions/${encodeURIComponent(subscriptionId)}?api-version=2022-12-01` }, {
    getToken: createCertificateTokenProvider(settings.connection!),
  }),
});
