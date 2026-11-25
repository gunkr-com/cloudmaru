// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  analysis: null as unknown,
  records: [] as unknown[],
  error: "",
  cookie: "",
}));


vi.mock("@/services/db/analyses", () => ({
  StoreError: class StoreError extends Error {},
  getAnalysis: vi.fn(async () => { if (mocks.error) throw Error(mocks.error); return mocks.analysis; }),
}));
vi.mock("@/services/db/artifacts", () => ({
  listArtifacts: vi.fn(async () => { if (mocks.error) throw Error(mocks.error); return mocks.records; }),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "cs_locale" && mocks.cookie ? { value: mocks.cookie } : undefined }) }));

vi.mock("@/services/claude", () => ({ requestStructuredOutput: vi.fn() }));

import { GET } from "./route";
import { getAnalysis } from "@/services/db/analyses";
import { listArtifacts } from "@/services/db/artifacts";
import { requestStructuredOutput } from "@/services/claude";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { loadCatalog } from "@/lib/catalog/load";
import { validateArtifact } from "@/lib/artifacts/validate";
import input from "@/lib/analysis/fixtures/sample-input.json";
import output from "@/lib/analysis/fixtures/sample-model-output.json";
import guideFixture from "@/lib/artifacts/fixtures/sample-guide-output.json";
import evaluationFixture from "@/lib/artifacts/fixtures/sample-evaluation-output.json";
import bicepFixture from "@/lib/artifacts/fixtures/sample-bicep-output.json";
import type { ArtifactKind } from "@/types/artifact";
import type { ArtifactRecord, AnalysisRecord } from "@/types/db";

const id = "11111111-1111-4111-8111-111111111111";
const parsedInput = analysisInputSchema.parse(input);
const built = buildAnalysisResult(output, parsedInput, loadCatalog());
if (!built.ok) throw new Error("invalid analysis fixture");
const analysis = { id, status: "succeeded", input: parsedInput, result: built.result } as AnalysisRecord;
const rawFixtures = { guide: guideFixture, evaluation: evaluationFixture, bicep: bicepFixture };
const contents = Object.fromEntries((Object.keys(rawFixtures) as ArtifactKind[]).map((kind) => {
  const tierPlan = built.result.plans.find((plan) => plan.tier === "balanced")!;
  const validated = validateArtifact(kind, rawFixtures[kind], { plan: tierPlan, catalog: loadCatalog(), region: "canadacentral" });
  if (!validated.ok) throw new Error(`invalid ${kind} fixture`);
  return [kind, validated.content];
}));

function request(tier = "balanced", kind = "bicep") {
  return new NextRequest(`http://localhost/api/analyses/${id}/artifacts/download?tier=${tier}&kind=${kind}`);
}
function record(kind: ArtifactKind, status = "succeeded", content: unknown = contents[kind]): ArtifactRecord {
  return { id: "artifact-id", analysisId: id, tier: "balanced", kind, status: status as ArtifactRecord["status"], content, createdAt: "2026-10-14T00:00:00.000Z", completedAt: "2026-10-14T00:01:00.000Z" };
}
function ctx(analysisId = id) { return { params: Promise.resolve({ id: analysisId }) }; }

describe("artifact download route", () => {
  beforeEach(() => {
    mocks.analysis = analysis;
    mocks.records = [record("bicep")];
    mocks.error = "";
    mocks.cookie = "";
    vi.mocked(getAnalysis).mockClear();
    vi.mocked(listArtifacts).mockClear();
    vi.mocked(requestStructuredOutput).mockClear();
  });

  it("downloads Bicep as an attachment with the draft notice and safe headers", async () => {
    const response = await GET(request() as never, ctx());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="cloudsight-balanced-main.bicep"');
    expect(response.headers.get("content-disposition")).toMatch(/^[\x20-\x7e]+$/);
    const body = await response.text();
    expect(body).toContain("Unverified draft");
    expect(body).toContain((contents.bicep as { code: string }).code);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(requestStructuredOutput).not.toHaveBeenCalled();
  });

  it.each(["guide", "evaluation"] as const)("downloads %s as Markdown", async (kind) => {
    mocks.records = [record(kind)];
    const response = await GET(request("balanced", kind) as never, ctx());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="cloudsight-balanced-.+\.md"$/);
  });

  it.each([
    ["pending", null, "2026-10-14T00:00:00.000Z"],
    ["failed", null, "2026-10-14T00:00:00.000Z"],
    ["pending", contents.bicep, "2026-10-14T00:00:00.000Z"],
    ["pending", contents.bicep, "2000-01-01T00:00:00.000Z"],
    ["succeeded", null, "2026-10-14T00:00:00.000Z"],
  ] as const)("returns 404 when artifact state/content is unavailable (%s)", async (status, content, createdAt) => {
    mocks.records = [{ ...record("bicep", status, content), createdAt }];
    const response = await GET(request() as never, ctx());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 for malformed IDs, missing analyses and non-succeeded analyses", async () => {
    expect((await GET(request() as never, ctx("not-a-uuid"))).status).toBe(404);
    mocks.analysis = null;
    expect((await GET(request() as never, ctx())).status).toBe(404);
    mocks.analysis = { ...analysis, status: "pending" };
    expect((await GET(request() as never, ctx())).status).toBe(404);
    mocks.analysis = { ...analysis, result: null };
    expect((await GET(request() as never, ctx())).status).toBe(404);
    expect(getAnalysis).toHaveBeenCalledWith(id);
  });

  it.each(["", "nonsense"]) ("returns 400 for invalid tier %s", async (tier) => {
    const response = await GET(request(tier, "bicep") as never, ctx());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "artifacts.downloadMissing" });
  });

  it("returns 400 for missing or unsupported kind", async () => {
    for (const url of [`http://localhost/api/analyses/${id}/artifacts/download?kind=bicep`, `http://localhost/api/analyses/${id}/artifacts/download?tier=balanced`, `http://localhost/api/analyses/${id}/artifacts/download?tier=balanced&kind=other`]) {
      const response = await GET(new NextRequest(url), ctx());
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("hides storage errors and marks all errors no-store", async () => {
    mocks.error = "private upstream error";
    const response = await GET(request() as never, ctx());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "artifacts.internalError" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});


it.each(["", "ko"])("uses the locale cookie (%s) for all downloaded artifacts", async (cookie) => {
  mocks.cookie = cookie;
  for (const kind of ["guide", "evaluation", "bicep"] as const) {
    mocks.analysis = analysis;
    mocks.records = [record(kind)];
    mocks.error = "";
    const response = await GET(request("balanced", kind), ctx());
    expect(response.status).toBe(200);
    const suffix = kind === "bicep" ? "main.bicep" : `${kind}${cookie === "ko" ? ".ko" : ""}.md`;
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="cloudsight-balanced-${suffix}"`);
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.text();
    const expected = kind === "bicep" ? (cookie === "ko" ? "// 검증 전 초안" : "// Unverified draft") : kind === "guide" ? (cookie === "ko" ? "## 구축 단계" : "## Build steps") : (cookie === "ko" ? "| 축 | 등급 | 근거 | 개선 제안 |" : "| Pillar | Grade | Rationale | Improvement |");
    expect(body).toContain(expected);
    if (!cookie) expect(body).not.toMatch(/[가-힣ㄱ-ㅎㅏ-ㅣ]/);
  }
});
