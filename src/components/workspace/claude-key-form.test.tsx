import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import { ClaudeKeyForm } from "./claude-key-form";
import type { ClaudeKeyFormState } from "@/types/workspace-claude";

it("clears an old save confirmation on edits and failures, then confirms a later successful save", async () => {
  const action = vi.fn().mockResolvedValueOnce({ saved: true }).mockResolvedValueOnce({ error: "workspace.claude.invalidReference" }).mockResolvedValueOnce({ saved: true });
  renderWithI18n(<ClaudeKeyForm workspaceId="fake-workspace" apiKeyEnv="CLOUDSIGHT_CLAUDE_KEY_ACME" action={action} />, { locale: "en" });
  const save = screen.getByRole("button", { name: "Save" });
  await userEvent.click(save);
  expect(await screen.findByRole("status")).toHaveTextContent("Reference saved. No API request was made.");
  await userEvent.type(screen.getByRole("textbox"), "_NEW");
  expect(screen.queryByText("Reference saved. No API request was made.")).not.toBeInTheDocument();
  await userEvent.click(save);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("Reference saved. No API request was made.")).not.toBeInTheDocument();
  await userEvent.click(save);
  expect(await screen.findByRole("status")).toHaveTextContent("Reference saved. No API request was made.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("submits only the reference and workspace, with accessible validation in English", async () => {
  const action = vi.fn<(prev: ClaudeKeyFormState, data: FormData) => Promise<ClaudeKeyFormState>>().mockResolvedValue({ error: "workspace.claude.invalidReference" });
  renderWithI18n(<ClaudeKeyForm workspaceId="fake-workspace" apiKeyEnv={null} action={action} />, { locale: "en" });
  const input = screen.getByRole("textbox", { name: "API key environment variable" });
  await userEvent.type(input, "CLOUDSIGHT_CLAUDE_KEY_ACME");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  const data = action.mock.calls[0][1] as FormData;
  expect(Object.fromEntries(data.entries())).toEqual({ workspaceId: "fake-workspace", apiKeyEnv: "CLOUDSIGHT_CLAUDE_KEY_ACME" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter an environment variable name starting with CLOUDSIGHT_CLAUDE_KEY_.");
  expect(input).toHaveAttribute("aria-invalid", "true");
  await waitFor(() => expect(input).toHaveFocus());
  expect(input).toHaveAccessibleDescription(/Leave blank to disable AI/);
  await userEvent.type(input, "_NEW");
  expect(screen.queryByRole("alert")).toBeNull();
});
it("renders the saved reference and Korean copy", () => {
  renderWithI18n(<ClaudeKeyForm workspaceId="fake-workspace" apiKeyEnv="CLOUDSIGHT_CLAUDE_KEY_ACME" action={vi.fn()} />, { locale: "ko" });
  expect(screen.getByRole("textbox")).toHaveValue("CLOUDSIGHT_CLAUDE_KEY_ACME");
  expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveAccessibleName("API 키 환경 변수");
});
