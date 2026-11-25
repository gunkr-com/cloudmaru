import { renderWithI18n as render } from "@/test/render-with-i18n";
import { useI18n } from "@/i18n/provider";
import { isMessageKey } from "@/i18n/translate";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisInput } from "@/types/analysis";

const { push, refresh, formSubmit, formMounted } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), formSubmit: vi.fn(), formMounted: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/components/analysis/analysis-form", () => ({
  AnalysisForm: (props: { onSubmit: (input: AnalysisInput) => unknown; errorMessage?: string; workspaceId?: string; mode?: string; sourceHref?: string; draftKey?: string }) => {
    const { t } = useI18n();
    useState(() => formMounted(props.draftKey));
    formSubmit.mockImplementation(props.onSubmit);
    return <div>
      <span>{props.mode === "rerun" ? "조건 바꿔 다시 분석" : "요구사항 입력"}</span>
      {props.sourceHref && <a href={props.sourceHref}>원래 결과 보기</a>}
      {props.errorMessage && <p role="alert">{props.errorMessage && isMessageKey(props.errorMessage) ? t(props.errorMessage) : props.errorMessage}</p>}
      {props.errorMessage === "workspace.claude.unavailable" && props.workspaceId && <a href={`/workspaces/${props.workspaceId}/claude`}>{t("workspace.claude.configure")}</a>}
      <button onClick={() => void formSubmit({ description: "테스트 입력", expectedUsers: "under-1k", monthlyBudget: 300_000, region: "canadacentral", availability: "medium" })}>submit</button>
    </div>;
  },
}));

import { NewAnalysisClient } from "@/app/(app)/analyses/new/new-analysis-client";
const analysisId = "550e8400-e29b-41d4-a716-446655440000";
const input: AnalysisInput = { description: "테스트 입력", expectedUsers: "under-1k", monthlyBudget: 300_000, region: "canadacentral", availability: "medium" };
function response(status: number, body: unknown) { return { status, json: async () => body } as Response; }

describe("NewAnalysisClient", () => {
  it("links a rejected rerun to the original company's key settings", async () => {
    vi.mocked(fetch).mockResolvedValue(response(409, { errors: ["workspace.claude.unavailable"], workspaceId: "original-company" }));
    render(<NewAnalysisClient sourceAnalysisId={analysisId} workspaceId="current-company" />, { locale: "en" });
    fireEvent.click(screen.getByText("submit"));
    expect(await screen.findByRole("link", { name: "Configure Claude key" })).toHaveAttribute("href", "/workspaces/original-company/claude");
    expect(push).not.toHaveBeenCalled();
  });
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn()); });
  // 사이드바로 워크스페이스를 바꾸면 같은 경로로 돌아오므로, 폼을 새로 마운트해야 A의 입력이 B의 초안으로 넘어가지 않는다.
  it("remounts the form with the new workspace draft when the workspace changes", () => {
    const { rerender } = render(<NewAnalysisClient sourceAnalysisId={null} workspaceId="workspace-a" />);
    rerender(<NewAnalysisClient sourceAnalysisId={null} workspaceId="workspace-a" />);
    expect(formMounted.mock.calls).toEqual([["new:workspace-a"]]);
    rerender(<NewAnalysisClient sourceAnalysisId={null} workspaceId="workspace-b" />);
    expect(formMounted.mock.calls).toEqual([["new:workspace-a"], ["new:workspace-b"]]);
  });
  it("posts request and navigates on 202", async () => {
    vi.mocked(fetch).mockResolvedValue(response(202, { id: analysisId }));
    render(<NewAnalysisClient defaultValues={input} sourceAnalysisId={analysisId} workspaceId="workspace-a" />);
    expect(screen.getByText("조건 바꿔 다시 분석")).toBeTruthy();
    expect(screen.getByRole("link", { name: "원래 결과 보기" }).getAttribute("href")).toBe(`/analyses/${analysisId}`);
    fireEvent.click(screen.getByText("submit"));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/analyses/${analysisId}`));
    // 공유 레이아웃(사이드바 남은 분석)은 push만으로 다시 렌더되지 않는다. 이동 뒤에 새로 고친다.
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh.mock.invocationCallOrder[0]).toBeGreaterThan(push.mock.invocationCallOrder[0]);
    expect(fetch).toHaveBeenCalledWith("/api/analyses", expect.objectContaining({ method: "POST", body: JSON.stringify({ input, sourceAnalysisId: analysisId, workspaceId: "workspace-a" }) }));
    await waitFor(async () => expect(await formSubmit.mock.results.at(-1)?.value).toBe(true));
  });
  it("keeps the draft and shows a generic error after an unexpected 401", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/analyses/new", search: "?from=abc", assign });
    vi.mocked(fetch).mockResolvedValue(response(401, { message: "ignored" }));
    render(<NewAnalysisClient sourceAnalysisId={null} workspaceId="workspace-a" />);
    fireEvent.click(screen.getByText("submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("분석 요청 결과를 확인하지 못했습니다.");
    expect(assign).not.toHaveBeenCalled();
    await waitFor(async () => expect(await formSubmit.mock.results.at(-1)?.value).toBe(false));
  });
  it.each([429, 503])("shows a generic error for unexpected status %s", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(response(status, { message: "private" }));
    render(<NewAnalysisClient sourceAnalysisId={null} workspaceId="workspace-a" />);
    fireEvent.click(screen.getByText("submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("분석 요청 결과를 확인하지 못했습니다.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private");
  });
  it("does not claim the count was kept after 5xx or network failures and ignores duplicate submissions", async () => {
    const unconfirmed = "분석 요청 결과를 확인하지 못했습니다. 분석 기록에서 진행 여부를 확인한 뒤 다시 시도해 주세요.";
    let resolveFetch!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    render(<NewAnalysisClient sourceAnalysisId={null} workspaceId="workspace-a" />);
    fireEvent.click(screen.getByText("submit"));
    fireEvent.click(screen.getByText("submit"));
    expect(fetch).toHaveBeenCalledTimes(1);
    resolveFetch(response(500, null));
    expect(await screen.findByRole("alert")).toHaveTextContent(unconfirmed);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    fireEvent.click(screen.getByText("submit"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent(unconfirmed);
    expect(screen.getByRole("alert")).not.toHaveTextContent("차감되지 않았습니다");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("shows a generic start failure for validation responses without details", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(400, { errors: [] }));
    render(<NewAnalysisClient sourceAnalysisId={null} workspaceId="workspace-a" />);
    fireEvent.click(screen.getByText("submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("분석을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  });
});

it("서버 오류 키를 현재 언어로 표시한다", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(409, { errors: ["analysis.workspaceChanged"] })));
  render(<NewAnalysisClient sourceAnalysisId={null} workspaceId="workspace-a" />, { locale: "en" });
  fireEvent.click(screen.getByText("submit"));
  expect(await screen.findByRole("alert")).toHaveTextContent("The workspace has changed. Refresh the page and try again.");
});
