import { expect, it } from "vitest";
import { azureSettingsInputSchema } from "./connection-schema";

const guid = "AAAAAAAA-0000-0000-0000-000000000001";
const input = { tenantId: guid, clientId: guid, certificatePath: " /fake/cert.pem ", certificatePasswordEnv: "", subscriptionIds: [guid, guid.toLowerCase()] };
it("normalizes GUIDs, removes duplicate subscriptions and trims paths", () => {
  expect(azureSettingsInputSchema.parse(input)).toEqual({ connection: { tenantId: guid.toLowerCase(), clientId: guid.toLowerCase(), certificatePath: "/fake/cert.pem", certificatePasswordEnv: null }, subscriptionIds: [guid.toLowerCase()] });
  expect(azureSettingsInputSchema.parse({ ...input, certificatePasswordEnv: null }).connection?.certificatePasswordEnv).toBeNull();
  expect(azureSettingsInputSchema.parse({ ...input, certificatePasswordEnv: "CERT_PASSWORD" }).connection?.certificatePasswordEnv).toBe("CERT_PASSWORD");
});
it("rejects invalid settings with field codes only", () => {
  const cases: [string, unknown, string][] = [
    ["tenantId", "bad", "tenant-id-invalid"], ["clientId", null, "client-id-invalid"],
    ...["relative.pem", "", "/a\0b", "/" + "a".repeat(1024)].map(v => ["certificatePath", v, "certificate-path-invalid"] as [string, unknown, string]),
    ...["ab", "lowercase", "A".repeat(65), "ABC=value"].map(v => ["certificatePasswordEnv", v, "password-env-invalid"] as [string, unknown, string]),
    ...[[], ["bad"], Array(51).fill(guid), null].map(v => ["subscriptionIds", v, "subscriptions-invalid"] as [string, unknown, string]),
  ];
  for (const [key, value, code] of cases) {
    const result = azureSettingsInputSchema.safeParse({ ...input, [key]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.every(issue => issue.message === code)).toBe(true);
  }
  expect(azureSettingsInputSchema.safeParse({ ...input, certificatePath: "/" + "a".repeat(1023), certificatePasswordEnv: "A".repeat(64), subscriptionIds: Array(50).fill(guid) }).success).toBe(true);
});
