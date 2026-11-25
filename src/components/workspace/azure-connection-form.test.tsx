import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { AzureConnectionForm as Form } from "./azure-connection-form";

const settings = {
  connection: { tenantId: "00000000-0000-0000-0000-0000000000aa", clientId: "00000000-0000-0000-0000-0000000000bb", certificatePath: "/fake/cert.pem", certificatePasswordEnv: "AZURE_CERT_PASSWORD" },
  subscriptionIds: ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"],
};
const AzureConnectionForm = (props: React.ComponentProps<typeof Form>) => <I18nProvider locale="en"><Form {...props} /></I18nProvider>;
it("renders saved settings in English with help, GUID/path settings and no password value field", () => {
  const { container } = render(<AzureConnectionForm workspaceId="fake-workspace" settings={settings} action={async () => ({})} />);
  expect(screen.getByLabelText("Tenant ID")).toHaveValue(settings.connection.tenantId);
  expect(screen.getByLabelText("Application (client) ID")).toHaveValue(settings.connection.clientId);
  expect(screen.getByLabelText("Certificate file path")).toHaveAccessibleDescription(/Absolute path to a PEM file/);
  expect(screen.getByLabelText("Password environment variable (optional)")).toHaveAccessibleDescription(/Do not enter the password itself/);
  expect(screen.getByLabelText("Target subscriptions")).toHaveValue(settings.subscriptionIds.join("\n"));
  for (const label of ["Tenant ID", "Application (client) ID", "Certificate file path"]) {
    expect(screen.getByLabelText(label)).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText(label)).toHaveAttribute("spellcheck", "false");
    expect(screen.getByLabelText(label)).toHaveClass("font-mono");
  }
  expect(container.querySelector('input[type="password"]')).toBeNull();
  expect(screen.getAllByRole("textbox")).toHaveLength(5);
});
it("shows translated errors, focuses the first invalid field and keeps input", async () => {
  const user = userEvent.setup();
  const action = vi.fn().mockResolvedValue({ errors: { tenantId: "tenant-id-invalid", certificatePath: "certificate-path-invalid" } });
  render(<AzureConnectionForm workspaceId="fake-workspace" action={action} />);
  await user.type(screen.getByLabelText("Tenant ID"), "bad tenant");
  await user.click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => expect(screen.getByLabelText("Tenant ID")).toHaveFocus());
  expect(screen.getByLabelText("Tenant ID")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Tenant ID")).toHaveAccessibleDescription("Enter the tenant ID as a GUID.");
  expect(screen.getByLabelText("Certificate file path")).toHaveAccessibleDescription(/Absolute path.*Enter an absolute path/);
  expect(screen.getByLabelText("Tenant ID")).toHaveValue("bad tenant");
  expect(action.mock.calls[0][1].get("workspaceId")).toBe("fake-workspace");
});
it("uses a safe message for unexpected errors and keeps input across locale changes", async () => {
  const user = userEvent.setup();
  const action = vi.fn().mockResolvedValue({ message: "secret error" });
  const { rerender } = render(<I18nProvider locale="en"><Form workspaceId="fake-workspace" action={action} /></I18nProvider>);
  await user.type(screen.getByLabelText("Tenant ID"), "typed");
  await user.click(screen.getByRole("button", { name: "Save connection" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save. Try again.");
  rerender(<I18nProvider locale="ko"><Form workspaceId="fake-workspace" action={action} /></I18nProvider>);
  expect(screen.getByLabelText("테넌트 ID")).toHaveValue("typed");
  expect(screen.getByRole("alert")).toHaveTextContent("저장하지 못했습니다.");
});
it("disables all fields and reports pending submission", async () => {
  const user = userEvent.setup();
  render(<AzureConnectionForm workspaceId="fake-workspace" action={() => new Promise(() => {})} />);
  await user.click(screen.getByRole("button", { name: "Save connection" }));
  for (const field of screen.getAllByRole("textbox")) expect(field).toBeDisabled();
  expect(screen.getByRole("button")).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Saving.");
});
