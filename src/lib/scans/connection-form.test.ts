import { expect, it } from "vitest";
import { parseAzureConnectionForm } from "./connection-form";

const values = {
  tenantId: "00000000-0000-0000-0000-0000000000AA",
  clientId: "00000000-0000-0000-0000-0000000000BB",
  certificatePath: "/fake/certificate.pem",
  certificatePasswordEnv: "",
  subscriptionIds: "00000000-0000-0000-0000-000000000001",
};
it("splits mixed separators, deduplicates IDs and normalizes settings", () => {
  const subscription = "00000000-0000-0000-0000-0000000000CC";
  expect(parseAzureConnectionForm({ ...values, subscriptionIds: `\n ${values.subscriptionIds},${subscription}\r\n${subscription.toLowerCase()}\t ` })).toEqual({
    ok: true,
    settings: {
      connection: { tenantId: values.tenantId.toLowerCase(), clientId: values.clientId.toLowerCase(), certificatePath: values.certificatePath, certificatePasswordEnv: null },
      subscriptionIds: [values.subscriptionIds, subscription.toLowerCase()],
    },
  });
});
it("trims pasted IDs and the password variable name before validating", () => {
  const result = parseAzureConnectionForm({ ...values, tenantId: ` ${values.tenantId}\n`, clientId: `\t${values.clientId} `, certificatePasswordEnv: " CERT_PASSWORD " });
  expect(result).toMatchObject({ ok: true, settings: { connection: { tenantId: values.tenantId.toLowerCase(), clientId: values.clientId.toLowerCase(), certificatePasswordEnv: "CERT_PASSWORD" } } });
});
it.each([
  ["tenantId", "bad", "tenant-id-invalid"],
  ["clientId", "bad", "client-id-invalid"],
  ["certificatePath", "relative.pem", "certificate-path-invalid"],
  ["certificatePasswordEnv", "not a variable", "password-env-invalid"],
  ["subscriptionIds", "", "subscriptions-invalid"],
  ["subscriptionIds", "bad", "subscriptions-invalid"],
  ["subscriptionIds", Array.from({ length: 51 }, () => values.subscriptionIds).join("\n"), "subscriptions-invalid"],
])("returns the error code and original values for %s", (field, value, code) => {
  const input = { ...values, [field]: value };
  expect(parseAzureConnectionForm(input)).toEqual({ ok: false, values: input, errors: { [field]: code } });
});
it("treats non-string fields as empty strings and reports all invalid fields", () => {
  expect(parseAzureConnectionForm({ tenantId: null, clientId: 123, certificatePath: {}, certificatePasswordEnv: undefined, subscriptionIds: [] })).toEqual({
    ok: false,
    values: { tenantId: "", clientId: "", certificatePath: "", certificatePasswordEnv: "", subscriptionIds: "" },
    errors: { tenantId: "tenant-id-invalid", clientId: "client-id-invalid", certificatePath: "certificate-path-invalid", subscriptionIds: "subscriptions-invalid" },
  });
});
it("stores only the password variable name", () => {
  const result = parseAzureConnectionForm({ ...values, certificatePasswordEnv: "AZURE_CERT_PASSWORD" });
  expect(result).toMatchObject({ ok: true, settings: { connection: { certificatePasswordEnv: "AZURE_CERT_PASSWORD" } } });
});
