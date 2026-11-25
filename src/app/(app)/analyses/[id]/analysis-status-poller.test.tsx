import { renderWithI18n as render } from "@/test/render-with-i18n";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_STALE_AFTER_SECONDS } from "@/lib/jobs/timing";

const { refresh, assign, router } = vi.hoisted(() => { const refresh = vi.fn(); return { refresh, assign: vi.fn(), router: { refresh } }; });
// Next.js의 useRouter는 렌더마다 같은 객체를 돌려준다.
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import { AnalysisStatusPoller } from "./analysis-status-poller";
import { RESULT_FOCUS_FLAG_PREFIX } from "@/lib/dashboard/result-links";

const start = new Date("2026-10-14T03:00:00Z");
const createdAt = start.toISOString();
const STALLED_MESSAGE = "분석 상태를 확인하지 못했습니다. 분석은 계속 진행되며 결과는 분석 기록에 남습니다.";
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe("AnalysisStatusPoller", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); vi.stubGlobal("fetch", vi.fn()); vi.stubGlobal("location", { pathname: "/analyses/id-2", search: "", assign }); refresh.mockClear(); assign.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });
  it("keeps polling while pending and stops after terminal status, refreshing once", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "pending" })).mockResolvedValueOnce(Response.json({ status: "succeeded" }));
    render(<AnalysisStatusPoller id="id-1" createdAt={createdAt} intervalMs={1000} />);
    await tick(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await tick(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem(`${RESULT_FOCUS_FLAG_PREFIX}id-1`)).toBe("1");
    expect(refresh).toHaveBeenCalledTimes(1);
    await tick(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("예상하지 못한 401은 로그인 이동 없이 재시도하고 연속 오류를 안내한다", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    render(<AnalysisStatusPoller id="id-2" createdAt={createdAt} intervalMs={1000} maxConsecutiveErrors={2} />);
    await tick(3000);
    expect(assign).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent(STALLED_MESSAGE);
  });
  it("refreshes and stops on 404", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }));
    render(<AnalysisStatusPoller id="id-404" createdAt={createdAt} intervalMs={1000} />);
    await tick(3000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retries 500 and network errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 })).mockRejectedValueOnce(new Error()).mockResolvedValueOnce(Response.json({ status: "failed" }));
    render(<AnalysisStatusPoller id="id-2" createdAt={createdAt} intervalMs={1000} />);
    await tick(3000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // 실패 화면은 결과 화면이 아니라 포커스 표시를 읽지 않으므로 남기지 않는다.
    expect(sessionStorage.getItem(`${RESULT_FOCUS_FLAG_PREFIX}id-2`)).toBeNull();
  });
  it("does not overlap requests and ignores a response after unmount", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = render(<AnalysisStatusPoller id="id-3" createdAt={createdAt} intervalMs={1000} />);
    await tick(3000);
    expect(fetch).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { finish(Response.json({ status: "succeeded" })); await Promise.resolve(); });
    expect(refresh).not.toHaveBeenCalled();
  });
  it("stops after consecutive errors, shows a retry message, and resumes on retry", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    render(<AnalysisStatusPoller id="id-5" createdAt={createdAt} intervalMs={1000} maxConsecutiveErrors={3} />);
    await tick(2000);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await tick(1000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("alert")).toHaveTextContent(STALLED_MESSAGE);
    await tick(5000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(refresh).not.toHaveBeenCalled();

    vi.mocked(fetch).mockResolvedValue(Response.json({ status: "succeeded" }));
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await tick(1000);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("gives up after five consecutive errors by default and counts only consecutive ones", async () => {
    const error = () => new Response(null, { status: 502 });
    vi.mocked(fetch).mockResolvedValueOnce(error()).mockResolvedValueOnce(error()).mockResolvedValueOnce(error()).mockResolvedValueOnce(error())
      .mockResolvedValueOnce(Response.json({ status: "pending" }))
      .mockResolvedValue(error());
    render(<AnalysisStatusPoller id="id-6" createdAt={createdAt} intervalMs={1000} />);
    await tick(9000);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await tick(1000);
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(screen.getByRole("alert")).toHaveTextContent(STALLED_MESSAGE);
  });
  it("refreshes once and stops polling after the stale cutoff even while the status API keeps failing", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    const nearlyStale = new Date(start.getTime() - JOB_STALE_AFTER_SECONDS * 1000 + 2500).toISOString();
    render(<AnalysisStatusPoller id="id-7" createdAt={nearlyStale} intervalMs={1000} />);
    await tick(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
    await tick(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await tick(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    // 서버가 아직 pending을 그려 이 컴포넌트가 남아 있으면(시계 차이) 멈춘 채 두지 않고 다시 시도를 보인다.
    expect(screen.getByRole("alert")).toHaveTextContent(STALLED_MESSAGE);
  });
  it("does not show the stale fallback once the server replaced the pending view", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    const stale = new Date(start.getTime() - JOB_STALE_AFTER_SECONDS * 1000 - 1000).toISOString();
    const view = render(<AnalysisStatusPoller id="id-8" createdAt={stale} intervalMs={1000} />);
    await tick(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    view.unmount();
    await tick(5000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

it("영어로 상태 재시도 안내를 표시한다", async () => {
  vi.useFakeTimers(); vi.setSystemTime(start); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<AnalysisStatusPoller id="id" createdAt={createdAt} intervalMs={1000} maxConsecutiveErrors={1} />, { locale: "en" });
  await tick(1000);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not check the analysis status.");
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  vi.useRealTimers();
});
