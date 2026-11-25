// @vitest-environment node
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkCertificatePem } from "./certificate";

const certificate = readFileSync("src/lib/scans/fixtures/test-certificate.pem", "utf8");
const validTo = new Date(new X509Certificate(certificate).validTo);
const now = new Date(validTo.getTime() - 86_400_000);
const key = (kind: string) => "-----BEGIN " + kind + "PRIVATE KEY-----\nfake\n-----END " + kind + "PRIVATE KEY-----";

describe("PEM 인증서 검사", () => {
  it.each([["", false], ["RSA ", false], ["ENCRYPTED ", true]] as const)("%s개인 키 머리글과 인증서가 있으면 ISO 만료일과 암호화 여부를 돌려준다", (kind, encryptedKey) => {
    expect(checkCertificatePem(certificate + key(kind), now)).toEqual({ ok: true, validTo: validTo.toISOString(), encryptedKey });
  });
  it("전통 형식의 암호화 키(Proc-Type: 4,ENCRYPTED)도 암호화로 본다", () => {
    const pem = certificate + "-----BEGIN " + "RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nfake\n-----END " + "RSA PRIVATE KEY-----";
    expect(checkCertificatePem(pem, now)).toMatchObject({ ok: true, encryptedKey: true });
  });
  it.each(["", "\u0000\u00ffPFX", certificate, key(""), "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----" + key("")])("잘못된 형식을 거절한다 (%#)", (pem) => {
    expect(checkCertificatePem(pem, now)).toEqual({ ok: false, code: "certificate-invalid" });
  });
  it("첫 인증서를 검사하고 만료일 이전 여부를 비교한다", () => {
    const pem = certificate + key("") + certificate;
    expect(checkCertificatePem(pem, new Date(validTo.getTime() + 1))).toEqual({ ok: false, code: "certificate-expired" });
    expect(checkCertificatePem(pem, validTo)).toEqual({ ok: true, validTo: validTo.toISOString(), encryptedKey: false });
  });
});
