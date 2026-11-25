import { X509Certificate } from "node:crypto";

export type CertificateCheck =
  | { ok: true; validTo: string; encryptedKey: boolean }  // encryptedKey: 개인 키를 풀려면 비밀번호가 필요하다
  | { ok: false; code: "certificate-invalid" | "certificate-expired" };

export function checkCertificatePem(pem: string, now: Date): CertificateCheck {
  const block = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/u)?.[0];
  if (!block || !/-----BEGIN (?:RSA |ENCRYPTED )?PRIVATE KEY-{5}/u.test(pem)) {
    return { ok: false, code: "certificate-invalid" };
  }
  try {
    const validTo = new Date(new X509Certificate(block).validTo);
    if (validTo.getTime() < now.getTime()) return { ok: false, code: "certificate-expired" };
    const encryptedKey = /-----BEGIN ENCRYPTED PRIVATE KEY-{5}|Proc-Type:\s*4,ENCRYPTED/u.test(pem);
    return { ok: true, validTo: validTo.toISOString(), encryptedKey };
  } catch {
    return { ok: false, code: "certificate-invalid" };
  }
}
