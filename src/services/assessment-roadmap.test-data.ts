// @vitest-environment node
import { vi } from "vitest";
import { createTestDatabase, insertTestWorkspace } from "@/lib/db/test-db.test-data";
import { createScansDb } from "./db/scans";
import { createAssessmentsDb } from "./db/assessments";
import { completeSnapshot } from "@/lib/completion/fixtures.test-data";
import { toCompletionSourceScan } from "@/lib/completion/source-scan";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import { buildRoadmapContext } from "@/lib/assessment/roadmap/context";
import { roadmapModelFixture } from "@/lib/assessment/roadmap/fixtures.test-data";
import { createAssessmentRoadmapServices } from "./assessment-roadmap";
import type { AssessmentResult } from "@/types/assessment";
import type { StructuredLlm } from "@/types/analysis";
export async function setupRoadmapIntegration() {
  const db = await createTestDatabase(); const workspaceId = await insertTestWorkspace(db);
  const scans = createScansDb({ db: async () => db }), parents = createAssessmentsDb({ db: async () => db });
  const sourceScanId = await scans.createImportScan({ workspaceId, inventory: completeSnapshot.inventory,
    subscriptionIds: completeSnapshot.record.subscriptionIds, summary: completeSnapshot.record.summary!, collectedAt: completeSnapshot.record.collectedAt! });
  const id = (await parents.reserveAssessment({ schemaVersion: 1, workspaceId, sourceScanId, previousScanId: null }))!.id;
  const pending = (await parents.getAssessment(id))!;
  const result: AssessmentResult = { schemaVersion: 1, id, workspaceId, sourceScanId, createdAt: pending.createdAt,
    sourceScan: toCompletionSourceScan((await scans.getScan(sourceScanId))!, completeSnapshot.inventory),
    local: evaluateAssessmentRules(completeSnapshot.inventory.resources, new Date().toISOString()),
    advisor: { state: "unavailable", reason: "not-supported" }, actualCost: { schemaVersion: 1, monthToDate: { state: "unavailable", reason: "not-supported" }, trailing30Days: { state: "unavailable", reason: "not-supported" } },
    diff: { state: "not-requested" }, roadmap: { state: "not-requested" } };
  await parents.completeAssessment(id, result);
  const context = buildRoadmapContext(result, (await parents.getAssessmentCatalogData(id))!);
  const data = roadmapModelFixture(context.payload);
  const hasKey = vi.fn(async () => true), request = vi.fn<StructuredLlm>(async () => ({ data, usage: { promptTokens: 10, completionTokens: 20, costUsd: 0.2 } }));
  const completionRequest = vi.fn(async (_source: unknown, input: Parameters<StructuredLlm>[0]) => request(input));
  let offsetMs = 0;
  const jobs = createAssessmentRoadmapServices({ now: () => new Date(Date.now() + offsetMs), db: async () => db, hasCompletionClaudeKey: hasKey, requestCompletionStructuredOutput: completionRequest });
  return { db, id, workspaceId, parents, result, jobs, hasKey, request, completionRequest, setClockOffset: (value: number) => { offsetMs = value; } };
}