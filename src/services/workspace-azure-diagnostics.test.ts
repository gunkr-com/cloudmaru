// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createAzureDiagnostics } from "./workspace-azure-diagnostics";
const settings = { connection: { tenantId: "tenant", clientId: "client", certificatePath: "/synthetic.pem", certificatePasswordEnv: null }, subscriptionIds: ["one", "two"] };
function deps() { return { getSettings: vi.fn(async () => settings), checkCertificate: vi.fn(async () => ({ ok: true as const, validTo: "2026-11-20T00:00:00Z" })), request: vi.fn<(subscriptionId: string) => Promise<unknown>>(async () => ({})), now: () => new Date("2026-11-13T00:00:00Z") }; }
it("checks local expiry without any Azure request, and tests each subscription only explicitly", async () => {
  const d = deps(), service = createAzureDiagnostics(d);
  expect(await service.local("workspace")).toMatchObject({ status: "expiring", subscriptionCount: 2 });
  expect(d.request).not.toHaveBeenCalled();
  expect(await service.test("workspace")).toEqual({ status: "verified", subscriptionCount: 2, validTo: "2026-11-20T00:00:00Z" });
  expect(d.request.mock.calls.map(call => call[0])).toEqual(["one", "two"]);
});
it("blocks missing/invalid credentials locally and sanitizes permission failures", async () => {
  const d = deps();
  d.checkCertificate.mockResolvedValue({ ok: false, code: "certificate-expired" } as never);
  expect(await createAzureDiagnostics(d).test("workspace")).toMatchObject({ status: "certificate-expired" });
  expect(d.request).not.toHaveBeenCalled();
  d.checkCertificate.mockResolvedValue({ ok: true, validTo: "2026-11-20T00:00:00Z" });
  d.request.mockRejectedValue({ kind: "forbidden", message: "synthetic-private-token" });
  expect(await createAzureDiagnostics(d).test("workspace")).toEqual({ status: "forbidden", subscriptionCount: 2 });
});
it.each(["auth-failed", "certificate-not-found", "certificate-invalid", "certificate-expired", "certificate-password-missing"] as const)(
  "reports credential failure %s from token acquisition instead of connectivity", async kind => {
    const d = deps();
    d.request.mockRejectedValue({ name: "AzureCredentialError", kind, message: "synthetic-private-token" });
    expect(await createAzureDiagnostics(d).test("workspace")).toEqual({ status: kind, subscriptionCount: 2 });
  });
it("keeps request failures and unknown errors mapped to their existing statuses", async () => {
  const d = deps();
  d.request.mockRejectedValue({ name: "AzureRequestError", kind: "not-found" });
  expect(await createAzureDiagnostics(d).test("workspace")).toEqual({ status: "subscriptionMissing", subscriptionCount: 2 });
  d.request.mockRejectedValue({ name: "AzureRequestError", kind: "auth-failed" });
  expect(await createAzureDiagnostics(d).test("workspace")).toEqual({ status: "unreachable", subscriptionCount: 2 });
  d.request.mockRejectedValue(Error("synthetic-private-token"));
  expect(await createAzureDiagnostics(d).test("workspace")).toEqual({ status: "unreachable", subscriptionCount: 2 });
});
