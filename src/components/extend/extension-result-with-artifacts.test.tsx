import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { createTranslator } from "@/i18n/translate";
import { processedFixture } from "@/lib/extend/proposal.test-data";
import { extensionArtifacts } from "@/lib/completion/fixtures.test-data";
import { buildExtensionDisplay, type ExtensionDisplay } from "@/lib/extend-app/result";
import { artifactDisplayBasis } from "@/lib/extend-artifacts/render-file";
import type { Tier } from "@/types/catalog";
import type { Locale } from "@/types/i18n";
import type { ExtensionArtifact } from "@/types/extension";
import { ExtensionResultWithArtifacts } from "./extension-result-with-artifacts";

const f = processedFixture();
const core = { catalog: f.context.catalog, support: f.context.support };
const display = () => buildExtensionDisplay(structuredClone(f.result), core, f.context.inventory);
const basis = (data: ExtensionDisplay, tier: Tier) => artifactDisplayBasis(data.result, core, tier);
type Row = { id: string; tier: Tier; kind: ExtensionArtifact["kind"]; status: "pending" | "succeeded" | "failed"; createdAt: string; content: ExtensionArtifact | null; error: string | null };
function saved(data: ExtensionDisplay, tier: Tier): Row[] {
  return extensionArtifacts.map(content => {
    const artifact = { ...structuredClone(content), extensionId: data.result.id, workspaceId: data.result.workspaceId, sourceScanId: data.result.sourceScanId, tier };
    return { id: artifact.id, tier, kind: artifact.kind, status: "succeeded", createdAt: artifact.createdAt, content: artifact, error: null };
  });
}
const view = (data: ExtensionDisplay, locale: Locale = "en", initialTier: Tier = "balanced") =>
  <I18nProvider locale={locale}><ExtensionResultWithArtifacts display={data} initialTier={initialTier} /></I18nProvider>;
const panel = () => screen.getByRole("region", { name: /Extension artifacts|확장 구축 결과물/ });
beforeEach(() => window.history.replaceState(null, "", `/extensions/${f.result.id}?tier=balanced`));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(["en", "ko"] as const)("opens all three saved kinds and localized downloads with draft and free-grant notices in %s", async locale => {
  const data = display(), t = createTranslator(locale);
  const fetcher = vi.fn(async () => Response.json({ basis: basis(data, "balanced"), artifacts: saved(data, "balanced") }));
  vi.stubGlobal("fetch", fetcher);
  const mounted = render(view(data, locale));
  await screen.findAllByRole("button", { name: t("extensionArtifacts.view") });
  expect(within(panel()).getByText(t("extensionArtifacts.freeGrantNotice"))).toBeInTheDocument();
  expect(within(panel()).getByText(t("extensionArtifacts.draftNotice"))).toBeInTheDocument();
  const kinds = ["guide", "evaluation", "bicep"] as const;
  for (const kind of kinds) {
    const section = screen.getByRole("heading", { name: t(`extensionArtifacts.${kind}`) }).closest("section")!;
    fireEvent.click(within(section).getByRole("button", { name: t("extensionArtifacts.view") }));
    expect(within(section).getByRole("link", { name: t("extensionArtifacts.download") })).toHaveAttribute("href", `/api/extensions/${data.result.id}/artifacts/download?tier=balanced&kind=${kind}`);
    if (kind === "bicep") expect(within(section).getByText(t("extensionArtifacts.draftLabel"))).toBeInTheDocument();
  }
  mounted.rerender(view(data, locale === "en" ? "ko" : "en"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { pressed: true })).toHaveTextContent(createTranslator(locale === "en" ? "ko" : "en")("common.tiers.balanced"));
});

it("keeps the saved owner on no-key errors and retries only the selected saved kind after failure", async () => {
  const data = display();
  let rows: ReturnType<typeof saved> = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ code: "key-unavailable", workspaceId: data.result.workspaceId }, { status: 409 });
    return Response.json({ basis: basis(data, "balanced"), artifacts: rows });
  });
  vi.stubGlobal("fetch", fetcher);
  render(view(data));
  await screen.findAllByRole("button", { name: "Generate" });
  fireEvent.click(within(panel()).getAllByRole("button", { name: "Generate" })[0]);
  expect(await screen.findByRole("alert")).toHaveTextContent(createTranslator("en")("extensionArtifacts.errors.key-unavailable"));
  expect(screen.getByRole("link", { name: "Claude key settings" })).toHaveAttribute("href", `/workspaces/${data.result.workspaceId}/claude`);
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ schemaVersion: 1, extensionId: data.result.id, tier: "balanced", kind: "guide" });
  // A saved validation failure remains local to the guide; evaluation/Bicep stay available.
  rows = saved(data, "balanced");
  rows[0] = { ...rows[0], status: "failed", error: "validation-failed", content: null };
  fireEvent.click(screen.getByRole("button", { name: "Refresh saved artifacts" }));
  await screen.findByRole("button", { name: "Retry" });
  rows = saved(data, "balanced");
  fetcher.mockImplementation(async () => Response.json({ basis: basis(data, "balanced"), artifacts: rows }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(within(panel()).getAllByRole("link", { name: "Download" })).toHaveLength(3));
});

it("aborts old-tier polling and submission, ignores late replies, and restores URL/locale/reopen selection", async () => {
  const data = display();
  let releaseRead!: (value: Response) => void, releasePost!: (value: Response) => void;
  let readSignal: AbortSignal | undefined, postSignal: AbortSignal | undefined;
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Promise<Response>(resolve => { releasePost = resolve; postSignal = init.signal ?? undefined; });
    if (url.endsWith("tier=low")) return new Promise<Response>(resolve => { releaseRead = resolve; readSignal = init?.signal ?? undefined; });
    const tier = new URL(url, "http://localhost").searchParams.get("tier") as Tier;
    return Promise.resolve(Response.json({ basis: basis(data, tier), artifacts: [] }));
  });
  vi.stubGlobal("fetch", fetcher);
  const mounted = render(view(data));
  await screen.findAllByRole("button", { name: "Generate" });
  fireEvent.click(within(panel()).getAllByRole("button", { name: "Generate" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Select Lowest cost" }));
  expect(postSignal?.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Select High availability" }));
  expect(readSignal?.aborted).toBe(true);
  await screen.findByText("Artifacts use the saved High availability option and its source scan.");
  await act(async () => {
    releaseRead(Response.json({ basis: basis(data, "low"), artifacts: saved(data, "low") }));
    releasePost(Response.json({ code: "key-unavailable", workspaceId: "00000000-0000-4000-8000-000000000099" }, { status: 409 }));
  });
  expect(within(panel()).queryByRole("link", { name: "Download" })).not.toBeInTheDocument();
  expect(within(panel()).queryByRole("alert")).not.toBeInTheDocument();
  expect(window.location.search).toBe("?tier=ha");
  mounted.rerender(view(data, "ko"));
  expect(screen.getByRole("button", { pressed: true })).toHaveTextContent("고가용성");
  window.history.replaceState(null, "", "?tier=balanced"); fireEvent.popState(window);
  expect(await screen.findByText("저장된 균형 안과 그 기준 스캔으로 결과물을 만듭니다.")).toBeInTheDocument();
  const n = fetcher.mock.calls.length;
  mounted.unmount(); render(view(data, "en", "balanced"));
  await screen.findByText("Artifacts use the saved Balanced option and its source scan.");
  expect(fetcher).toHaveBeenCalledTimes(n + 1);
});

it("polls the saved selected tier then cancels its pending work when opening a different extension", async () => {
  vi.useFakeTimers();
  const first = display(), next = display(); next.result.id = "00000000-0000-4000-8000-000000000099";
  const pending: Row = { ...saved(first, "balanced")[0], status: "pending", content: null, createdAt: new Date().toISOString() };
  let firstRows = [pending];
  const fetcher = vi.fn(async (url: string) => {
    const data = url.includes(next.result.id) ? next : first;
    return Response.json({ basis: basis(data, "balanced"), artifacts: data === first ? firstRows : [] });
  });
  vi.stubGlobal("fetch", fetcher);
  const mounted = render(view(first));
  await act(async () => { await Promise.resolve(); });
  expect(within(panel()).getByRole("status")).toHaveTextContent("Generating");
  firstRows = saved(first, "balanced");
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(within(panel()).getAllByRole("link", { name: "Download" })).toHaveLength(3);
  mounted.rerender(view(next));
  await act(async () => { await Promise.resolve(); });
  expect(within(panel()).queryByRole("link", { name: "Download" })).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenLastCalledWith(`/api/extensions/${next.result.id}/artifacts?tier=balanced`, expect.anything());
  const count = fetcher.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(fetcher).toHaveBeenCalledTimes(count);
});
