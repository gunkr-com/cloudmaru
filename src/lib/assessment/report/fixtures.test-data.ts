import { roadmapFixture } from "@/lib/assessment/roadmap/fixtures.test-data";
import type { AssessmentRecord } from "@/types/assessment";
export function reportFixture() {
  const { parent, catalogData } = roadmapFixture();
  const record: AssessmentRecord = { id: parent.id, workspaceId: parent.workspaceId, sourceScanId: parent.sourceScanId,
    previousScanId: null, status: "succeeded", input: { schemaVersion: 1, workspaceId: parent.workspaceId, sourceScanId: parent.sourceScanId, previousScanId: null },
    result: parent, error: null, createdAt: parent.createdAt, completedAt: "2026-11-12T11:00:00Z",
    roadmap: { status: "not-requested", attemptId: null, content: null, error: null, usage: null, createdAt: null, completedAt: null } };
  return { record, catalogData };
}
