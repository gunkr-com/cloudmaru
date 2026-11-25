import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { WorkspaceForm as Form } from "./workspace-form";

const WorkspaceForm = (props: React.ComponentProps<typeof Form>) => <I18nProvider locale="en"><Form {...props} /></I18nProvider>;

it("shows field errors, focuses the first field and keeps submitted values", async () => {
  const user = userEvent.setup();
  const action = vi.fn().mockResolvedValue({ errors: { name: ["workspace.errors.nameRequired"], defaultRegion: ["workspace.errors.regionUnsupported"] } });
  render(<WorkspaceForm action={action} />);
  await user.type(screen.getByLabelText("Company name"), "Acme");
  await user.click(screen.getByRole("button", { name: "Create workspace" }));
  await waitFor(() => expect(screen.getByLabelText("Name (required)")).toHaveFocus());
  expect(screen.getByLabelText("Name (required)")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Name (required)")).toHaveAccessibleDescription("Enter a workspace name.");
  expect(screen.getByLabelText("Company name")).toHaveValue("Acme");
  expect(screen.getByLabelText("Default region")).toHaveAccessibleDescription("Select a supported region.");
});
it("prefills editing values and submits the workspace ID", async () => {
  const user = userEvent.setup();
  const action = vi.fn().mockResolvedValue({ message: "workspace.errors.save" });
  render(<WorkspaceForm action={action} workspace={{ id: "workspace-id", name: "Team", companyName: "Acme", defaultRegion: "canadacentral" }} />);
  expect(screen.getByLabelText("Name (required)")).toHaveValue("Team");
  expect(screen.getByLabelText("Default region")).toHaveValue("canadacentral");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
  expect(action.mock.calls[0][1].get("workspaceId")).toBe("workspace-id");
  expect(screen.getByLabelText("Name (required)")).toHaveValue("Team");
});

it("falls back to the default region when the saved region is no longer supported", async () => {
  const user = userEvent.setup();
  const action = vi.fn().mockResolvedValue({});
  render(<WorkspaceForm action={action} workspace={{ id: "workspace-id", name: "Team", companyName: null, defaultRegion: "canadaeast" }} />);
  expect(screen.getByLabelText("Default region")).toHaveValue("canadacentral");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(action.mock.calls[0][1].get("defaultRegion")).toBe("canadacentral");
});

it("uses a safe translated fallback for unknown server messages", async () => {
  const user = userEvent.setup();
  render(<WorkspaceForm action={async () => ({ message: "secret path", errors: { name: ["unknown.key"] } })} />);
  await user.click(screen.getByRole("button", { name: "Create workspace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save. Try again.");
  expect(screen.getByLabelText("Name (required)")).toHaveAccessibleDescription("Could not save. Try again.");
  expect(screen.queryByText("secret path")).toBeNull();
});

it("translates existing errors on locale change and keeps form input", async () => {
  const user = userEvent.setup();
  const action = vi.fn().mockResolvedValue({ errors: { name: ["workspace.errors.nameRequired"] } });
  const { rerender } = render(<I18nProvider locale="en"><Form action={action} /></I18nProvider>);
  await user.type(screen.getByLabelText("Company name"), "Acme");
  await user.click(screen.getByRole("button", { name: "Create workspace" }));
  await waitFor(() => expect(screen.getByLabelText("Name (required)")).toHaveAccessibleDescription("Enter a workspace name."));
  rerender(<I18nProvider locale="ko"><Form action={action} /></I18nProvider>);
  expect(screen.getByLabelText("이름 (필수)")).toHaveAccessibleDescription("워크스페이스 이름을 입력해 주세요.");
  expect(screen.getByLabelText("회사명")).toHaveValue("Acme");
  expect(screen.getByRole("button", { name: "워크스페이스 만들기" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Canada Central" })).toBeInTheDocument();
});

it("disables submission and fields while pending", async () => {
  const user = userEvent.setup();
  render(<WorkspaceForm action={() => new Promise(() => {})} />);
  await user.click(screen.getByRole("button", { name: "Create workspace" }));
  expect(screen.getByRole("button")).toBeDisabled();
  expect(screen.getByLabelText("Name (required)")).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Saving.");
});
