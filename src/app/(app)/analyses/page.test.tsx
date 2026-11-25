import { renderWithI18n as render } from "@/test/render-with-i18n";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => localeCookie.value ? { value: localeCookie.value } : undefined }) }));
const localeCookie = vi.hoisted(() => ({ value: "ko" as string | undefined }));
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { loadCatalog } from "@/lib/catalog/load";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import sampleModel from "@/lib/analysis/fixtures/sample-model-output.json";

const { getAnalysis, listAnalyses, listArtifacts, getCurrentWorkspace } = vi.hoisted(() => ({
  getAnalysis: vi.fn(), listAnalyses: vi.fn(), listArtifacts: vi.fn(), getCurrentWorkspace: vi.fn(),
}));
vi.mock("@/services/db/analyses", () => ({ getAnalysis, listAnalyses }));
vi.mock("@/services/db/artifacts", () => ({ listArtifacts }));
vi.mock("@/services/current-workspace", () => ({ getCurrentWorkspace }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));
vi.mock("./new/new-analysis-client", () => ({ NewAnalysisClient: (props: unknown) => <output data-testid="form">{JSON.stringify(props)}</output> }));
vi.mock("./[id]/analysis-result-client", () => ({ AnalysisResultClient: (props: unknown) => <output data-testid="result">{JSON.stringify(props)}</output> }));
vi.mock("./[id]/analysis-status-poller", () => ({ AnalysisStatusPoller: () => null }));
import HistoryPage from "./page";
import NewPage, { generateMetadata as newMetadata } from "./new/page";
import ResultPage, { generateMetadata as resultMetadata } from "./[id]/page";

const id = "550e8400-e29b-41d4-a716-446655440000";
const input = analysisInputSchema.parse(sampleInput);
const built = buildAnalysisResult(sampleModel, input, loadCatalog());
if (!built.ok) throw new Error("invalid fixture");
const record = { id, workspaceId: "other-workspace", input, status: "succeeded", result: built.result, createdAt: new Date().toISOString(), errorStage: null };
const resultProps = () => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tier: "ha", checkout: "success" }) });

beforeEach(() => {
  vi.clearAllMocks();
  localeCookie.value = "ko";
  getAnalysis.mockResolvedValue(record);
  getCurrentWorkspace.mockResolvedValue({ id: "current-workspace", defaultRegion: "canadacentral" });
  listAnalyses.mockResolvedValue([]);
  listArtifacts.mockResolvedValue([]);
});

describe("로그인 없는 분석 페이지", () => {
  it("현재 워크스페이스의 기록만 조회하고 빈 상태에는 새 분석만 둔다", async () => {
    render(await HistoryPage());
    expect(listAnalyses).toHaveBeenCalledWith("current-workspace");
    expect(screen.getByText("아직 분석이 없습니다.")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "새 분석" })).toHaveAttribute("href", "/analyses/new");
  });

  it("다른 워크스페이스의 입력도 재분석 폼과 제목에 사용한다", async () => {
    const props = { searchParams: Promise.resolve({ from: id, checkout: "success" }) };
    expect((await newMetadata(props)).title).toContain("조건 바꿔 다시 분석");
    render(await NewPage(props));
    expect(getAnalysis).toHaveBeenCalledWith(id);
    // 폼 초안 키에 쓰도록 현재 워크스페이스 ID를 넘긴다. 원 분석의 입력은 워크스페이스와 관계없이 쓴다.
    expect(JSON.parse(screen.getByTestId("form").textContent!)).toEqual({ defaultValues: input, sourceAnalysisId: id, workspaceId: "current-workspace", defaultRegion: "canadacentral" });
  });

  it("없는 이전 분석은 새 입력으로 연다", async () => {
    getAnalysis.mockResolvedValue(null);
    render(await NewPage({ searchParams: Promise.resolve({ from: id }) }));
    expect(screen.getByRole("heading", { name: "새 분석" })).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("form").textContent!)).toEqual({ sourceAnalysisId: null, workspaceId: "current-workspace", defaultRegion: "canadacentral" });
  });

  it("다른 워크스페이스의 결과와 결과물도 ID로 열고 결제 상태를 넘기지 않는다", async () => {
    expect((await resultMetadata(resultProps())).title).toContain(built.result.requestTitle.ko);
    render(await ResultPage(resultProps()));
    expect(getAnalysis).toHaveBeenCalledWith(id);
    expect(listArtifacts).toHaveBeenCalledWith(id);
    expect(getCurrentWorkspace).not.toHaveBeenCalled();
    expect(JSON.parse(screen.getByTestId("result").textContent!)).toMatchObject({ id, initialTier: "ha", initialArtifacts: [] });
    expect(screen.getByTestId("result")).not.toHaveTextContent(/planState|checkoutReturned/);
  });

  it("없는 분석은 404로 처리한다", async () => {
    getAnalysis.mockResolvedValue(null);
    await expect(ResultPage(resultProps())).rejects.toThrow("404");
  });
});

it("쿠키가 없으면 새 분석과 기록을 영어로 렌더링한다", async () => {
  localeCookie.value = undefined;
  const history = render(await HistoryPage(), { locale: "en" });
  expect(screen.getByRole("heading", { name: "Analysis history" })).toBeInTheDocument();
  expect(screen.getByText("No analyses yet.")).toBeInTheDocument();
  history.unmount();
  render(await NewPage({ searchParams: Promise.resolve({}) }), { locale: "en" });
  expect(screen.getByRole("heading", { name: "New analysis" })).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Analysis steps" })).toHaveTextContent("Requirements");
});
it.each(["pending", "failed"] as const)("영어 %s 화면 제목과 입력 요약을 표시한다", async (status) => {
  localeCookie.value = undefined;
  getAnalysis.mockResolvedValue({ ...record, status, result: null });
  render(await ResultPage(resultProps()), { locale: "en" });
  expect(screen.getByRole("heading", { name: status === "pending" ? "Analysis in progress" : "Analysis failed" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Submitted requirements" })).toBeInTheDocument();
});
