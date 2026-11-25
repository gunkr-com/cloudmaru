import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { AssessmentTopology } from "./assessment-topology";

it("takes a reader from the diagram's critical issue to the affected resource and remediation", () => {
  render(<I18nProvider locale="en"><AssessmentTopology topology={{
    nodes: [
      { id: "endpoint", name: "private-endpoint", type: "microsoft.network/privateendpoints", group: "demo" },
      { id: "storage", name: "customer-storage", type: "microsoft.storage/storageaccounts", group: "demo" },
      { id: "other", name: "standalone-app", type: "microsoft.web/sites", group: "demo" },
    ],
    edges: [{ sourceId: "endpoint", targetId: "storage", type: "connects_to" }],
  }} issues={[{ id: "finding", resourceId: "storage", severity: "critical", title: "Public access", description: "Files can be reached publicly.", remediation: "Disable public access." }]} /></I18nProvider>);
  const map = screen.getByRole("region", { name: "Resource diagram" });
  expect(within(map).getByRole("button", { name: /private-endpoint/i })).toBeInTheDocument();
  fireEvent.click(within(map).getByRole("button", { name: /customer-storage.*critical/i }));
  const detail = screen.getByRole("region", { name: /customer-storage/i });
  expect(within(detail).getByText("Public access")).toBeInTheDocument();
  expect(within(detail).getByText(/Disable public access/)).toBeVisible();
  expect(within(detail).getByText("private-endpoint connects to customer-storage", { exact: false })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Choose a resource" }), { target: { value: "other" } });
  expect(screen.getByText("The scan recorded no connections for this resource.")).toBeVisible();
  expect(screen.getByRole("region", { name: /standalone-app/i })).toBeInTheDocument();
});

const beginnerTopology = {
  nodes: [
    { id: "plan", name: "plan-web", type: "microsoft.web/serverfarms", group: "demo", family: "app-plan" as const, azureId: "/subscriptions/s/resourceGroups/demo/providers/Microsoft.Web/serverfarms/plan-web" },
    { id: "app-1", name: "app-1", type: "microsoft.web/sites", group: "demo", family: "web-app" as const, azureId: "/subscriptions/s/resourceGroups/demo/providers/Microsoft.Web/sites/app-1" },
    { id: "app-2", name: "app-2", type: "microsoft.web/sites", group: "demo", family: "web-app" as const, azureId: "/subscriptions/s/resourceGroups/demo/providers/Microsoft.Web/sites/app-2" },
    { id: "vault", name: "lonely-vault", type: "microsoft.keyvault/vaults", group: "demo", family: "key-vault" as const, azureId: "/subscriptions/s/resourceGroups/demo/providers/Microsoft.KeyVault/vaults/lonely-vault" },
  ],
  edges: [{ sourceId: "plan", targetId: "app-1", type: "hosts" as const }, { sourceId: "plan", targetId: "app-2", type: "hosts" as const }],
};
const beginnerChecks = [
  { id: "c1", resourceId: "app-1", verdict: "violation" as const, severity: "medium" as const, ruleId: "web-https-only", title: "Require HTTPS",
    summary: "This web app accepts unencrypted connections.", nextCheck: "Confirm no client still needs plain HTTP.",
    description: "Catalog description.", remediation: "Enable HTTPS Only.", reasonCode: null,
    evidence: [{ propertyPath: "properties.httpsOnly", state: "present" as const }] },
  { id: "c2", resourceId: "app-2", verdict: "unknown" as const, severity: "medium" as const, ruleId: "web-minimum-tls", title: "Minimum TLS",
    description: "TLS description.", remediation: "Set TLS 1.2.", reasonCode: "missing-data" as const,
    evidence: [{ propertyPath: "properties.siteConfig.minTlsVersion", state: "missing" as const }] },
  { id: "c3", resourceId: "app-1", verdict: "pass" as const, severity: "medium" as const, ruleId: "web-minimum-tls", title: "Minimum TLS",
    description: "TLS description.", remediation: "Set TLS 1.2.", reasonCode: null,
    evidence: [{ propertyPath: "properties.siteConfig.minTlsVersion", state: "present" as const }] },
];
const beginnerSummary = {
  collectedAt: "2026-11-11T12:00:00Z", source: "import" as const, evaluatedAt: "2026-11-11T12:05:00Z", automaticChecks: 3,
  resources: { total: 4, checked: 2, noApplicableRule: 2, invalid: 0 }, verdicts: { violation: 1, unknown: 1, pass: 1 },
  actualCost: { state: "unavailable" as const, reason: "not-supported" as const },
};

it("lets a beginner find a resource without connections by keyboard and read role, connections and checks in order", async () => {
  const user = userEvent.setup();
  render(<I18nProvider locale="en"><AssessmentTopology topology={beginnerTopology} checks={beginnerChecks} summary={beginnerSummary} /></I18nProvider>);
  const roles = within(screen.getByRole("list", { name: "Resources by role" }));
  expect(roles.getByRole("button", { name: "Web apps · 2" })).toBeInTheDocument();
  expect(roles.getByRole("button", { name: "Key Vault · 1" })).toBeInTheDocument();
  await user.click(roles.getByRole("button", { name: "Web apps · 2" }));
  expect(within(screen.getByRole("list", { name: "Matching resources" })).getAllByRole("button").map(button => button.textContent))
    .toEqual([expect.stringMatching(/^app-1/), expect.stringMatching(/^app-2/)]);
  await user.click(roles.getByRole("button", { name: /All roles/ }));
  await user.type(screen.getByRole("searchbox", { name: "Find a resource" }), "vault");
  await user.tab();
  expect(within(screen.getByRole("list", { name: "Matching resources" })).getByRole("button", { name: /lonely-vault/ })).toHaveFocus();
  await user.keyboard("{Enter}");
  const vault = within(screen.getByRole("region", { name: /lonely-vault/ }));
  expect(vault.getByText(/Stores passwords, keys and certificates/)).toBeInTheDocument();
  expect(vault.getByText("The scan recorded no connections for this resource.")).toBeInTheDocument();
  expect(vault.getByText(/No automatic check result was saved for this resource/)).toBeInTheDocument();

  await user.clear(screen.getByRole("searchbox", { name: "Find a resource" }));
  await user.type(screen.getByRole("searchbox", { name: "Find a resource" }), "app-2{Tab}{Enter}");
  const panel = screen.getByRole("region", { name: /app-2/ });
  const headings = within(panel).getAllByRole("heading", { level: 4 }).map(heading => heading.textContent);
  expect(headings).toEqual(["What it does", "Recorded connections", "What needs attention"]);
  expect(within(panel).getByText("plan-web hosts app-2", { exact: false })).toBeInTheDocument();
  expect(within(panel).getByText(/Insufficient data/)).toBeInTheDocument();
  expect(within(panel).getByText(/Required data missing/)).toBeInTheDocument();
  const technical = within(panel).getByText("Technical details", { selector: "summary" }).closest("details")!;
  expect(technical).not.toHaveAttribute("open");
  expect(within(technical).getByText("/subscriptions/s/resourceGroups/demo/providers/Microsoft.Web/sites/app-2")).toBeInTheDocument();
  expect(within(technical).getByText("properties.siteConfig.minTlsVersion")).toBeInTheDocument();
  expect(within(technical).getByText("web-minimum-tls", { exact: false })).toBeInTheDocument();
});

it("summarises the saved assessment and opens a first issue with its impact and next check", async () => {
  const user = userEvent.setup();
  render(<I18nProvider locale="en"><AssessmentTopology topology={beginnerTopology} checks={beginnerChecks} summary={beginnerSummary} demo /></I18nProvider>);
  const summary = within(screen.getByRole("region", { name: "Saved assessment summary" }));
  expect(summary.getByText(/Scan collected/)).toBeInTheDocument();
  expect(summary.getByText("3 automatic checks on 2 of 4 resources")).toBeInTheDocument();
  expect(summary.getByText("Needs attention").nextSibling).toHaveTextContent("1");
  expect(summary.getByText("Insufficient data").nextSibling).toHaveTextContent("1");
  expect(summary.getByText("No applicable rule").nextSibling).toHaveTextContent("2");
  expect(summary.getByText(/Actual billing: not available in the demo/)).toBeInTheDocument();
  expect(summary.getByText(/Estimated cost: not part of an assessment/)).toBeInTheDocument();
  const first = within(screen.getByRole("region", { name: "Issues to review first" }));
  expect(first.getByText("This web app accepts unencrypted connections.")).toBeInTheDocument();
  expect(first.getByText(/Confirm no client still needs plain HTTP/)).toBeInTheDocument();
  await user.click(first.getByRole("button", { name: /Open app-1/ }));
  expect(screen.getByRole("heading", { level: 3, name: "app-1" })).toHaveFocus();
  expect(within(screen.getByRole("region", { name: /app-1/ })).getByText(/1 automatic check passed/)).toBeInTheDocument();
});

it("switches the beginner panel and summary to Korean", () => {
  render(<I18nProvider locale="ko"><AssessmentTopology topology={beginnerTopology} checks={beginnerChecks} summary={{ ...beginnerSummary, actualCost: { state: "unavailable", reason: "not-supported" } }} /></I18nProvider>);
  expect(screen.getByRole("list", { name: "역할별 리소스" })).toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: "리소스 찾기" })).toBeInTheDocument();
  const summary = within(screen.getByRole("region", { name: "저장된 점검 요약" }));
  expect(summary.getByText("확인 필요")).toBeInTheDocument();
  expect(summary.getByText("자료 부족")).toBeInTheDocument();
  expect(summary.getByText("적용 규칙 없음")).toBeInTheDocument();
  expect(summary.getByText(/실제 청구: 이 점검에서는 제공되지 않습니다/)).toBeInTheDocument();
});

it("scrolls the diagram to the picked resource and its link while focus stays on the detail heading", async () => {
  const user = userEvent.setup();
  const scrollTo = vi.fn();
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  try {
    const apps = Array.from({ length: 8 }, (_, i) => ({ id: `app-${i}`, name: `app-${i}`, type: "microsoft.web/sites", group: "demo", family: "web-app" as const }));
    render(<I18nProvider locale="en"><AssessmentTopology topology={{
      nodes: [{ id: "plan", name: "plan-web", type: "microsoft.web/serverfarms", group: "demo", family: "app-plan" as const }, ...apps],
      edges: apps.map(app => ({ sourceId: "plan", targetId: app.id, type: "hosts" as const })),
    }} checks={[]} /></I18nProvider>);
    scrollTo.mockClear();
    await user.type(screen.getByRole("searchbox", { name: "Find a resource" }), "app-5{Tab}{Enter}");
    expect(screen.getByRole("heading", { level: 3, name: "app-5" })).toHaveFocus();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const [{ top, left }] = scrollTo.mock.calls[0];
    // app-5 is the root (column 0) and plan-web its only neighbour (column 1); both sit at the vertical middle of 8 rows.
    expect(top).toBeGreaterThan(0);
    expect(left).toBe(0);
    scrollTo.mockClear();
    fireEvent.click(within(screen.getByRole("region", { name: "Resource diagram" })).getByRole("button", { name: /plan-web/ }));
    expect(scrollTo).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, "scrollTo", original);
    else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  }
});
