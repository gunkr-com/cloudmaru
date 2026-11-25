import { I18nProvider } from "@/i18n/provider";
import { renderWithI18n as render } from "@/test/render-with-i18n";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactsSection } from "@/components/artifacts/artifacts-section";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { validateArtifact } from "@/lib/artifacts/validate";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleModel from "@/lib/analysis/fixtures/sample-model-output.json";
import guideFixture from "@/lib/artifacts/fixtures/sample-guide-output.json";
import evaluationFixture from "@/lib/artifacts/fixtures/sample-evaluation-output.json";
import bicepFixture from "@/lib/artifacts/fixtures/sample-bicep-output.json";
import { loadCatalog } from "@/lib/catalog/load";
import type { ArtifactKind } from "@/types/artifact";
import type { ArtifactView, RequestArtifactResult } from "@/lib/artifacts/artifact-job";
import type { ArtifactsApi } from "@/components/artifacts/artifacts-api";
import type { Tier } from "@/types/catalog";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const catalog = loadCatalog();
const built = buildAnalysisResult(sampleModel, sampleInput as never, catalog);
if (!built.ok) throw new Error(built.errors.join("; "));
const plan = built.result.plans.find(({ tier }) => tier === "balanced")!;
const ha = built.result.plans.find(({ tier }) => tier === "ha")!;
const fixtureContent = {
  guide: validateArtifact("guide", guideFixture, { plan, catalog, region: "canadacentral" }),
  evaluation: validateArtifact("evaluation", evaluationFixture, { plan, catalog, region: "canadacentral" }),
  bicep: validateArtifact("bicep", bicepFixture, { plan, catalog, region: "canadacentral" }),
};
const content = Object.fromEntries(Object.entries(fixtureContent).map(([kind, result]) => {
  if (!result.ok) throw new Error(result.errors.join("; "));
  return [kind, result.content];
})) as Record<ArtifactKind, NonNullable<ArtifactView["content"]>>;
const makeArtifact = (kind: ArtifactKind, status: ArtifactView["status"] = "succeeded", tier: Tier = "balanced"): ArtifactView => ({ tier, kind, status, content: status === "succeeded" ? content[kind] : null, createdAt: "2026-01-01T00:00:00.000Z", completedAt: status === "succeeded" ? "2026-01-01T00:01:00.000Z" : null });
const props = (overrides: Partial<Parameters<typeof ArtifactsSection>[0]> = {}) => ({ analysisId: "analysis-id", plan, initialArtifacts: [], ...overrides });
const okList = (artifacts: ArtifactView[]) => ({ ok: true as const, artifacts });
const response = (status: number, artifact?: ArtifactView): RequestArtifactResult => status === 200 || status === 202 ? { status, artifact: artifact! } : status === 503 ? { status, message: "unknown" } : status === 400 ? { status, errors: [] } : { status: status as 404, message: "error" };
const apiResponse = (status: number, artifact?: ArtifactView) => status === 200 || status === 202 ? { ok: true as const, status, artifact: artifact! } : { ok: false as const, ...response(status) };
const apiWith = (request: ArtifactsApi["request"], list: ArtifactsApi["list"] = vi.fn().mockResolvedValue(okList([]))): ArtifactsApi => ({ request, list });
const rowFor = (name: string) => screen.getByRole("heading", { name }).closest("li")!;
const liveRegion = () => screen.getAllByRole("status").find((element) => !element.closest("li"))!;

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("ArtifactsSection", () => {
  it("links a missing-key rejection to the saved analysis owner's workspace", async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, status: 409, message: "workspace.claude.unavailable", workspaceId: "owner-company" });
    render(<ArtifactsSection {...props({ api: apiWith(request) })} />, { locale: "en" });
    fireEvent.click(within(rowFor("Step-by-step build guide")).getByRole("button", { name: "Generate" }));
    expect(await screen.findByRole("link", { name: "Configure Claude key" })).toHaveAttribute("href", "/workspaces/owner-company/claude");
    expect(screen.getByRole("alert")).toHaveTextContent("dedicated Claude key");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("저장된 분석이 없는 미리보기에서는 새 분석으로 안내한다", () => {
    const request = vi.fn();
    render(<ArtifactsSection {...props({ analysisId: undefined, api: apiWith(request) })} />);
    for (const link of screen.getAllByRole("link", { name: "생성하기" })) {
      expect(link).toHaveAttribute("href", "/analyses/new");
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("선택한 안의 제목과 상태를 바꾼다", () => {
    const { rerender } = render(<ArtifactsSection {...props()} />);
    const heading = screen.getByRole("heading", { name: "균형 안 구축 결과물" });
    expect(heading).toHaveAttribute("data-artifacts-heading");
    expect(heading).toHaveAttribute("tabindex", "-1");
    rerender(<ArtifactsSection {...props({ plan: ha, initialArtifacts: [makeArtifact("guide")] })} />);
    expect(screen.getByRole("heading", { name: "고가용성 안 구축 결과물" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "생성하기" })).toHaveLength(3);
  });

  it("사용자가 생성 요청하고 pending 타이머를 표시한다", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue(apiResponse(202, { ...makeArtifact("guide", "pending"), createdAt: new Date().toISOString() }));
    render(<ArtifactsSection {...props({ api: apiWith(request) })} />);
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "생성하기" })[0]); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("analysis-id", "balanced", "guide");
    expect(within(rowFor("단계별 구축 가이드")).getByRole("status")).toHaveTextContent("생성 중입니다.");
    // 경과 시간 이름은 <p>의 aria-label(ARIA 1.2 금지) 대신 화면 밖 텍스트로 둔다.
    const label = screen.getByText("경과 시간");
    expect(label).toHaveClass("sr-only");
    const elapsed = label.parentElement!;
    expect(elapsed).not.toHaveAttribute("aria-label");
    expect(elapsed).toHaveTextContent("경과 시간 0:00");
    expect(within(rowFor("단계별 구축 가이드")).getByRole("status")).not.toContainElement(elapsed);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(elapsed).toHaveTextContent("경과 시간 0:01");
  });

  // 결과물 생성도 Claude API 비용을 쓴다. 끝나면 사이드바의 이번 달 비용을 다시 읽도록 서버 렌더를 새로 고친다.
  it.each(["succeeded", "failed"] as const)("pending 결과물이 %s로 끝나면 한 번만 화면을 새로 고친다", async (finalStatus) => {
    refresh.mockClear();
    vi.useFakeTimers();
    const list = vi.fn()
      .mockResolvedValueOnce(okList([makeArtifact("guide", "pending")]))
      .mockResolvedValue(okList([makeArtifact("guide", finalStatus)]));
    render(<ArtifactsSection {...props({ initialArtifacts: [makeArtifact("guide", "pending")], api: apiWith(vi.fn(), list) })} />);
    await act(async () => { vi.advanceTimersByTime(4_000); });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(4_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("pending을 4초마다 목록 갱신하고 성공 알림 후 폴링을 멈춘다", async () => {
    vi.useFakeTimers();
    const list = vi.fn().mockResolvedValue(okList([makeArtifact("guide")]));
    const { unmount } = render(<ArtifactsSection {...props({ initialArtifacts: [makeArtifact("guide", "pending")], api: apiWith(vi.fn(), list) })} />);
    const region = liveRegion();
    expect(region).toBeEmptyDOMElement();
    await act(async () => { vi.advanceTimersByTime(4_000); });
    expect(list).toHaveBeenCalledTimes(1);
    expect(liveRegion()).toBe(region);
    expect(region).toHaveTextContent("단계별 구축 가이드를 만들었습니다.");
    expect(screen.getByRole("button", { name: "보기" })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(list).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("세 결과물 이름에 맞는 조사로 성공을 알린다", async () => {
    vi.useFakeTimers();
    const list = vi.fn().mockResolvedValue(okList([makeArtifact("guide"), makeArtifact("evaluation"), makeArtifact("bicep")]));
    render(<ArtifactsSection {...props({ initialArtifacts: [makeArtifact("guide", "pending"), makeArtifact("evaluation", "pending"), makeArtifact("bicep", "pending")], api: apiWith(vi.fn(), list) })} />);
    await act(async () => { vi.advanceTimersByTime(4_000); });
    expect(liveRegion()).toHaveTextContent("단계별 구축 가이드를 만들었습니다. Well-Architected 5축 평가를 만들었습니다. Bicep 코드를 만들었습니다.");
  });

  it("pending이 실패로 끝나면 성공 알림 대신 경고로 알린다", async () => {
    vi.useFakeTimers();
    const list = vi.fn().mockResolvedValue(okList([makeArtifact("guide", "failed")]));
    render(<ArtifactsSection {...props({ initialArtifacts: [makeArtifact("guide", "pending")], api: apiWith(vi.fn(), list) })} />);
    await act(async () => { vi.advanceTimersByTime(4_000); });
    expect(screen.queryByText(/만들었습니다/)).not.toBeInTheDocument();
    expect(liveRegion()).toBeEmptyDOMElement();
    expect(within(rowFor("단계별 구축 가이드")).getByRole("alert")).toHaveTextContent("만들지 못했습니다. 다시 시도해 주세요.");
  });

  it("폴링이 다른 항목의 요청 실패 문구를 지우지 않는다", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const list = vi.fn().mockResolvedValue(okList([makeArtifact("evaluation", "pending")]));
    render(<ArtifactsSection {...props({ initialArtifacts: [makeArtifact("evaluation", "pending")], api: apiWith(request, list) })} />);
    await act(async () => { fireEvent.click(within(rowFor("단계별 구축 가이드")).getByRole("button", { name: "생성하기" })); });
    expect(within(rowFor("단계별 구축 가이드")).getByRole("alert")).toHaveTextContent("만들지 못했습니다. 다시 시도해 주세요.");
    await act(async () => { vi.advanceTimersByTime(4_000); });
    expect(list).toHaveBeenCalledTimes(1);
    expect(within(rowFor("단계별 구축 가이드")).getByRole("alert")).toHaveTextContent("만들지 못했습니다. 다시 시도해 주세요.");
    expect(within(rowFor("단계별 구축 가이드")).queryByRole("button", { name: "생성하기" })).not.toBeInTheDocument();
  });

  it("성공 결과물은 펼쳐서 보고 내려받는다", () => {
    render(<ArtifactsSection {...props({ initialArtifacts: [makeArtifact("guide"), makeArtifact("evaluation"), makeArtifact("bicep")] })} />);
    fireEvent.click(screen.getAllByRole("button", { name: "보기" })[0]);
    expect(screen.getByRole("link", { name: "가이드 내려받기 (Markdown)" })).toHaveAttribute("href", "/api/analyses/analysis-id/artifacts/download?tier=balanced&kind=guide");
    fireEvent.click(screen.getByRole("heading", { name: "Bicep 코드" }).closest("li")!.querySelector("button")!);
    expect(screen.getAllByText("검증 전 초안").length).toBeGreaterThan(0);
  });

  it("세 결과물을 잠금 없이 생성할 수 있다", () => {
    render(<ArtifactsSection {...props()} />);
    expect(screen.getAllByRole("button", { name: "생성하기" })).toHaveLength(3);
    expect(screen.queryByText(/Pro|구독|로그인/)).not.toBeInTheDocument();
  });

  it.each([401, 403, 503, 500, 0])("요청 오류 %s는 다시 시도할 수 있다", async (status) => {
    render(<ArtifactsSection {...props({ api: apiWith(vi.fn().mockResolvedValue({ ok: false, status })) })} />);
    fireEvent.click(screen.getAllByRole("button", { name: "생성하기" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("만들지 못했습니다. 다시 시도해 주세요.");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: /Pro/ })).not.toBeInTheDocument();
  });

  it("failed 결과물은 다시 요청하고 200이면 펼친다", async () => {
    const request = vi.fn().mockResolvedValue(apiResponse(200, makeArtifact("guide")));
    render(<ArtifactsSection {...props({ initialArtifacts: [makeArtifact("guide", "failed")], api: apiWith(request) })} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "다시 시도" })); await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "접기" })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("analysis-id", "balanced", "guide");
  });

  it("키보드 Enter로 결과물을 펼친다", () => {
    render(<ArtifactsSection {...props({ initialArtifacts: [makeArtifact("guide")] })} />);
    const button = screen.getByRole("button", { name: "보기" });
    button.focus();
    fireEvent.click(button);
    expect(within(screen.getByRole("heading", { name: "단계별 구축 가이드" }).closest("li")!).getByRole("button", { name: "접기" })).toBeInTheDocument();
  });
});

it("renders English generation, progress, failures and completion", async () => {
 vi.useFakeTimers();
 const list = vi.fn().mockResolvedValue(okList([makeArtifact("guide")]));
 render(<ArtifactsSection {...props({ initialArtifacts: [makeArtifact("guide", "pending"), makeArtifact("bicep", "failed")], api: apiWith(vi.fn(), list) })} />, { locale: "en" });
 expect(screen.getByRole("heading", { name: "Build artifacts for Balanced" })).toBeInTheDocument();
 expect(screen.getByRole("progressbar", { name: "Step-by-step build guide generation progress" })).toBeInTheDocument();
 expect(screen.getByText("Generating.")).toHaveAttribute("role", "status");
 expect(screen.getByText("Elapsed time")).toHaveClass("sr-only");
 expect(screen.getByRole("alert")).toHaveTextContent("Could not generate this artifact. Try again.");
 expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
 await act(async () => { vi.advanceTimersByTime(4000); });
 expect(liveRegion()).toHaveTextContent("Step-by-step build guide is ready.");
 expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
});

it.each(["message", "errors"])("translates API %s keys and hides unrecognized server copy", async (field) => {
 const request = vi.fn().mockResolvedValue({ ok: false, status: 400, [field]: field === "errors" ? ["artifacts.selectOption"] : "artifacts.analysisUnavailable" });
 render(<ArtifactsSection {...props({ api: apiWith(request) })} />, { locale: "en" });
 fireEvent.click(screen.getAllByRole("button", { name: "Generate" })[0]);
 expect(await screen.findByRole("alert")).toHaveTextContent(field === "errors" ? "Select an option." : "Could not find an analysis for generating artifacts.");
 request.mockResolvedValue({ ok: false, status: 500, message: "private server details" });
 fireEvent.click(screen.getByRole("button", { name: "Retry" }));
 await act(async () => { await Promise.resolve(); });
 expect(screen.getByRole("alert")).toHaveTextContent("Could not generate this artifact. Try again.");
 expect(screen.queryByText("private server details")).not.toBeInTheDocument();
});

it("keeps the expanded artifact when the locale changes", () => {
 const section = <ArtifactsSection {...props({ initialArtifacts: [makeArtifact("guide")] })} />;
 const { rerender } = render(<I18nProvider locale="en">{section}</I18nProvider>);
 fireEvent.click(screen.getByRole("button", { name: "View" }));
 expect(screen.getByRole("link", { name: "Download guide (Markdown)" })).toBeInTheDocument();
 rerender(<I18nProvider locale="ko">{section}</I18nProvider>);
 expect(screen.getByRole("button", { name: "접기" })).toHaveAttribute("aria-expanded", "true");
 expect(screen.getByRole("link", { name: "가이드 내려받기 (Markdown)" })).toBeInTheDocument();
});
