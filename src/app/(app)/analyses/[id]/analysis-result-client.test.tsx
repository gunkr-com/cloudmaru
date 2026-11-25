import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleOutput from "@/lib/analysis/fixtures/sample-model-output.json";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { loadCatalog } from "@/lib/catalog/load";

const { replace, refresh, mounts, cleanups } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), mounts: vi.fn(), cleanups: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/components/artifacts/artifacts-section", async () => {
  const React = await import("react");
  return { ArtifactsSection: (props: Record<string, unknown>) => {
    React.useEffect(() => { mounts(); return () => cleanups(); }, []);
    return <section><h2 data-artifacts-heading tabIndex={-1}>구축 결과물 제목</h2><output data-testid="artifacts-props">{JSON.stringify({ analysisId: props.analysisId, initialArtifacts: props.initialArtifacts, tier: (props.plan as { tier: string }).tier })}</output></section>;
  } };
});
vi.mock("@/components/analysis/analysis-result-view", async () => {
  const React = await import("react");
  return { AnalysisResultView: (props: Record<string, unknown>) => {
    const plan = (props.result as { plans: Array<{ tier: string }> }).plans.find((entry) => entry.tier === props.selectedTier);
    React.useEffect(() => {
      if (props.focusHeadingOnMount) (document.querySelector("[data-testid='heading']") as HTMLElement | null)?.focus();
    }, [props.focusHeadingOnMount]);
    return <div>
    <h1 tabIndex={-1} data-testid="heading">제목</h1>
    <output data-testid="selected">{String(props.selectedTier)}</output>
    <output data-testid="report-id">{String(props.reportId)}</output>
    <button onClick={() => (props.onSelectTier as (tier: string) => void)("ha")}>고가용성 선택</button>
    <output data-testid="focus">{String(props.focusHeadingOnMount)}</output>
    {plan && (props.renderArtifacts as (plan: unknown) => React.ReactNode)(plan)}
    </div>;
  } };
});
import { AnalysisResultClient } from "./analysis-result-client";
import { RESULT_FOCUS_FLAG_PREFIX } from "@/lib/dashboard/result-links";

const built = buildAnalysisResult(sampleOutput, analysisInputSchema.parse(sampleInput), loadCatalog());
if (!built.ok) throw new Error(built.errors.join("\n"));


describe("AnalysisResultClient", () => {
  const props = { id: "abc", result: built.ok ? built.result : (() => { throw new Error("fixture invalid"); })(), createdAt: "2026-10-14T00:00:00Z", initialTier: "balanced" as const, initialArtifacts: [] };
  it("passes selected plan and server artifact data through one persistent section", () => {
    mounts.mockClear(); cleanups.mockClear();
    render(<AnalysisResultClient {...props} />);
    expect(screen.getByTestId("artifacts-props")).toHaveTextContent('"analysisId":"abc"');
    expect(screen.getByTestId("artifacts-props")).toHaveTextContent('"tier":"balanced"');
    fireEvent.click(screen.getByRole("button", { name: "고가용성 선택" }));
    expect(screen.getByTestId("artifacts-props")).toHaveTextContent('"tier":"ha"');
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(cleanups).not.toHaveBeenCalled();
    expect(screen.queryByText("Pro로 보기")).not.toBeInTheDocument();
  });
  it("syncs selected tier to URL with the history API, without a server round trip", () => {
    replace.mockClear(); refresh.mockClear();
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(<AnalysisResultClient {...props} />);
    expect(screen.getByTestId("selected")).toHaveTextContent("balanced");
    fireEvent.click(screen.getByRole("button", { name: "고가용성 선택" }));
    expect(replaceState).toHaveBeenCalledWith(null, "", "/analyses/abc?tier=ha");
    expect(window.location.pathname + window.location.search).toBe("/analyses/abc?tier=ha");
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("selected")).toHaveTextContent("ha");
    replaceState.mockRestore();
  });
  it("consumes focus flag and focuses heading when present, otherwise leaves focus alone", async () => {
    const key = `${RESULT_FOCUS_FLAG_PREFIX}abc`;
    sessionStorage.setItem(key, "1");
    const view = render(<AnalysisResultClient {...props} initialTier="low" />);
    // 플래그는 setTimeout 뒤에 반영되고 포커스는 그다음 effect에서 옮겨지므로 둘 다 기다린다.
    await waitFor(() => expect(screen.getByTestId("focus")).toHaveTextContent("true"));
    expect(sessionStorage.getItem(key)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("heading")));
    view.unmount();
    render(<AnalysisResultClient {...props} initialTier="low" />);
    expect(screen.getByTestId("focus")).toHaveTextContent("false");
    expect(document.activeElement).not.toBe(screen.getByTestId("heading"));
  });
  it("still focuses the heading when StrictMode runs the flag effect twice", async () => {
    // 개발 모드(App Router 기본 StrictMode)는 effect를 실행·정리·재실행한다. 첫 실행이 표시를 지우고 정리에서 타이머가 취소되면 포커스를 놓친다.
    const key = `${RESULT_FOCUS_FLAG_PREFIX}abc`;
    sessionStorage.setItem(key, "1");
    render(<StrictMode><AnalysisResultClient {...props} initialTier="low" /></StrictMode>);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("heading")));
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("결제 복귀 상태나 업그레이드 경로를 결과물에 넘기지 않는다", () => {
    render(<AnalysisResultClient {...props} />);
    expect(screen.getByTestId("artifacts-props")).not.toHaveTextContent('"planState"');
    expect(screen.getByTestId("artifacts-props")).not.toHaveTextContent('"checkoutReturned"');
  });
  it("passes the saved analysis ID so the view can link its report", () => {
    render(<AnalysisResultClient {...props} />);
    expect(screen.getByTestId("report-id")).toHaveTextContent("abc");
  });
});
