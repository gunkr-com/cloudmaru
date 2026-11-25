import { expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render-with-i18n";
import { AzureDiagnostics } from "./azure-diagnostics";
it("shows actionable expiry without running a provider test on mount", () => {
 const action = vi.fn();
 renderWithI18n(<AzureDiagnostics workspaceId="id" initial={{status:"expiring",subscriptionCount:1,validTo:"2026-11-20T00:00:00Z"}} action={action}/>, {locale:"en"});
 expect(screen.getByText(/Certificate expires within 30 days/)).toBeInTheDocument();
 expect(action).not.toHaveBeenCalled();
 expect(screen.getByRole("button")).toHaveTextContent("Test saved Azure access");
 expect(screen.getByRole("button")).toHaveClass("whitespace-normal");
});
