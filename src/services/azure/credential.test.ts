// @vitest-environment node
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AzureConnection } from "@/types/scan";
import { AzureCredentialError, checkConnectionCertificate, createCertificateTokenProvider } from "./credential";

vi.mock("@azure/identity", () => ({ ClientCertificateCredential: vi.fn(() => { throw new Error("Unexpected SDK access"); }) }));
const certificate = readFileSync("src/lib/scans/fixtures/test-certificate.pem", "utf8");
const pem = certificate + "-----BEGIN " + "PRIVATE KEY-----\nfake";
const validTo = new Date(new X509Certificate(certificate).validTo);
const connection: AzureConnection = { tenantId: "tenant", clientId: "client", certificatePath: "/private/cert.pem", certificatePasswordEnv: null };
function deps() {
  const getToken = vi.fn(async (): Promise<{ token: string } | null> => ({ token: "secret-token" }));
  return {
    env: {} as Record<string, string | undefined>,
    readFile: vi.fn(async () => pem),
    now: () => new Date(validTo.getTime() - 86_400_000),
    createCredential: vi.fn(() => ({ getToken })),
    getToken,
  };
}

describe("인증서 자격 증명", () => {
  it("최초 요청까지 지연하고 동시·후속 요청에도 자격 증명을 하나만 만든다", async () => {
    const d = deps();
    const provider = createCertificateTokenProvider(connection, d);
    expect(d.readFile).not.toHaveBeenCalled();
    expect(d.createCredential).not.toHaveBeenCalled();
    expect(await Promise.all([provider(), provider()])).toEqual(["secret-token", "secret-token"]);
    await provider();
    expect(d.readFile).toHaveBeenCalledExactlyOnceWith(connection.certificatePath);
    expect(d.createCredential).toHaveBeenCalledExactlyOnceWith("tenant", "client", { certificate: pem });
    expect(d.getToken).toHaveBeenCalledTimes(3);
    expect(d.getToken).toHaveBeenCalledWith("https://management.azure.com/.default");
  });
  it("환경 변수의 비밀번호를 PEM과 함께 전달한다", async () => {
    const d = deps();
    d.env.CERT_PASSWORD = "secret-password";
    await createCertificateTokenProvider({ ...connection, certificatePasswordEnv: "CERT_PASSWORD" }, d)();
    expect(d.createCredential).toHaveBeenCalledWith("tenant", "client", { certificate: pem, certificatePassword: "secret-password" });
  });
  it.each(["certificate-not-found", "certificate-invalid", "certificate-expired", "certificate-password-missing"] as const)("%s를 안전하게 반환하고 인증을 시작하지 않는다", async (kind) => {
    const d = deps();
    const c = { ...connection };
    if (kind === "certificate-not-found") d.readFile.mockRejectedValue(new Error("/private/cert.pem secret-password"));
    if (kind === "certificate-invalid") d.readFile.mockResolvedValue("PFX");
    if (kind === "certificate-expired") d.now = () => new Date(validTo.getTime() + 1);
    if (kind === "certificate-password-missing") c.certificatePasswordEnv = "MISSING";
    expect(await checkConnectionCertificate(c, d)).toEqual({ ok: false, code: kind });
    const error = await createCertificateTokenProvider(c, d)().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AzureCredentialError);
    expect(error).toMatchObject({ kind, message: kind });
    expect(error).not.toHaveProperty("cause");
    expect(d.createCredential).not.toHaveBeenCalled();
  });
  it.each([
    ["PKCS#8", certificate + "-----BEGIN " + "ENCRYPTED PRIVATE KEY-----\nfake"],
    ["traditional", certificate + "-----BEGIN " + "RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nfake"],
  ])("암호화된 개인 키(%s)인데 비밀번호 변수가 없으면 비밀번호 누락이다", async (_label, encryptedPem) => {
    const d = deps();
    d.readFile.mockResolvedValue(encryptedPem);
    expect(await checkConnectionCertificate(connection, d)).toEqual({ ok: false, code: "certificate-password-missing" });
    await expect(createCertificateTokenProvider(connection, d)()).rejects.toMatchObject({ kind: "certificate-password-missing" });
    expect(d.createCredential).not.toHaveBeenCalled();
  });
  it("빈 비밀번호 환경 변수도 거절한다", async () => {
    const d = deps();
    d.env.PASSWORD = "";
    expect(await checkConnectionCertificate({ ...connection, certificatePasswordEnv: "PASSWORD" }, d)).toEqual({ ok: false, code: "certificate-password-missing" });
  });
  it.each(["throw", "null", "constructor"])("인증 실패(%s)의 원본 오류를 노출하지 않는다", async (failure) => {
    const d = deps();
    const original = new Error(connection.certificatePath + pem + "secret-password secret-token");
    if (failure === "throw") d.getToken.mockRejectedValue(original);
    if (failure === "null") d.getToken.mockResolvedValue(null);
    if (failure === "constructor") d.createCredential.mockImplementation(() => { throw original; });
    const error = await createCertificateTokenProvider(connection, d)().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AzureCredentialError);
    expect(error).toMatchObject({ kind: "auth-failed", message: "auth-failed" });
    expect(error).not.toHaveProperty("cause");
  });
  it("연결 검사는 만료일만 반환하고 Azure를 호출하지 않는다", async () => {
    const d = deps();
    expect(await checkConnectionCertificate(connection, d)).toEqual({ ok: true, validTo: validTo.toISOString() });
    expect(d.createCredential).not.toHaveBeenCalled();
    expect(d.getToken).not.toHaveBeenCalled();
  });
});
