import "server-only";
import { readFile } from "node:fs/promises";
import { ClientCertificateCredential } from "@azure/identity";
import { checkCertificatePem } from "@/lib/scans/certificate";
import type { AzureConnection } from "@/types/scan";

export class AzureCredentialError extends Error {
  readonly kind: "certificate-not-found" | "certificate-invalid" | "certificate-expired" | "certificate-password-missing" | "auth-failed";

  constructor(kind: AzureCredentialError["kind"]) {
    super(kind);
    this.name = "AzureCredentialError";
    this.kind = kind;
  }
}

type CertificateOptions = { certificate: string; certificatePassword?: string };
type Credential = { getToken(scope: string): Promise<{ token: string } | null> };
type CredentialDeps = {
  env?: Record<string, string | undefined>;
  readFile?: (path: string) => Promise<string>;
  now?: () => Date;
  createCredential?: (tenantId: string, clientId: string, options: CertificateOptions) => Credential;
};

async function loadCertificate(connection: AzureConnection, deps: CredentialDeps) {
  let certificate: string;
  try {
    certificate = await (deps.readFile ?? ((path) => readFile(path, "utf8")))(connection.certificatePath);
  } catch {
    throw new AzureCredentialError("certificate-not-found");
  }
  const check = checkCertificatePem(certificate, (deps.now ?? (() => new Date()))());
  if (!check.ok) throw new AzureCredentialError(check.code);
  const options: CertificateOptions = { certificate };
  // 암호화된 개인 키는 비밀번호 없이 풀 수 없다. 변수 이름이 비어 있으면 auth-failed가 아니라 비밀번호 누락으로 알린다.
  if (connection.certificatePasswordEnv || check.encryptedKey) {
    const password = connection.certificatePasswordEnv ? (deps.env ?? process.env)[connection.certificatePasswordEnv] : undefined;
    if (!password) throw new AzureCredentialError("certificate-password-missing");
    options.certificatePassword = password;
  }
  return { options, validTo: check.validTo };
}

export function createCertificateTokenProvider(connection: AzureConnection, deps: CredentialDeps = {}): () => Promise<string> {
  // Promise 자체를 공유해 동시 요청도 같은 파일과 자격 증명을 사용한다.
  let credential: Promise<Credential> | undefined;
  return async () => {
    credential ??= (async () => {
      const { options } = await loadCertificate(connection, deps);
      try {
        return (deps.createCredential ?? ((tenantId, clientId, configuration) =>
          new ClientCertificateCredential(tenantId, clientId, configuration)))(connection.tenantId, connection.clientId, options);
      } catch {
        throw new AzureCredentialError("auth-failed");
      }
    })();
    const instance = await credential;
    try {
      const result = await instance.getToken("https://management.azure.com/.default");
      if (!result) throw new AzureCredentialError("auth-failed");
      return result.token;
    } catch {
      // 원본 오류에는 인증서, 비밀번호, 토큰이 포함될 수 있다.
      throw new AzureCredentialError("auth-failed");
    }
  };
}

export async function checkConnectionCertificate(
  connection: AzureConnection, deps: CredentialDeps = {},
): Promise<{ ok: true; validTo: string } | { ok: false; code: AzureCredentialError["kind"] }> {
  try {
    const { validTo } = await loadCertificate(connection, deps);
    return { ok: true, validTo };
  } catch (error) {
    return { ok: false, code: error instanceof AzureCredentialError ? error.kind : "auth-failed" };
  }
}
