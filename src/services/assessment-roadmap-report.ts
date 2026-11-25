import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { PGlite } from "@electric-sql/pglite";
import type { Locale } from "@/types/i18n";
import { assessmentTopology } from "@/lib/assessment/topology";
import { createScansDb } from "./db/scans";
import { assessDocument } from "@/lib/report/document";
import { reportOwner, withOwnerIdentity } from "@/lib/report/owner";
import type { ReportSelection } from "@/lib/report/selection";
import { buildAssessmentReport } from "@/lib/assessment/report/document";
import { getDb } from "./db/client";
import { createAssessmentsDb } from "./db/assessments";
import { createAssessmentRoadmapsDb } from "./db/assessment-roadmaps";
import { createWorkspacesStore } from "./db/workspaces";
/** 먼저 pinned19 reader를 통과하므로 증거 없는16 legacy 재평가는 실행하지 않는다.
 * 읽기만 수행한다. pending 로드맵 stale 처리·키 조회·청구·모델/Azure 호출은 없다.
 * 소유자 이름·회사는 저장된 workspaceId로 워크스페이스 행을 한 번 읽어 붙인다(현재 선택 쿠키는 읽지 않는다).
 */
export function createAssessmentReportService(deps: {
    db: () => Promise<PGlite>;
}) {
    const parents = createAssessmentsDb(deps), roadmaps = createAssessmentRoadmapsDb(deps), workspaces = createWorkspacesStore(deps), scans = createScansDb(deps);
    async function read(id: string, locale: Locale) {
        if (!z.uuid().safeParse(id).success)
            return null;
        try {
            const verified = await roadmaps.getAssessmentRoadmap(id);
            if (!verified)
                return null;
            if (verified.status !== "succeeded")
                throw new Error();
            const parent = await parents.getAssessment(id);
            const catalogData = await parents.getAssessmentCatalogData(id);
            const pinned = await roadmaps.getAssessmentRoadmapCatalogData(id);
            if (!parent || !catalogData || !pinned || !isDeepStrictEqual(parent.result, verified.result)
                || !isDeepStrictEqual(catalogData, pinned))
                throw new Error();
            // 로드맵은 proof를 검증한 단일 reader의 상태와 내용을 함께 사용한다.
            const record = { ...parent, roadmap: verified.roadmap };
            const owner = reportOwner(parent.workspaceId, await workspaces.getWorkspace(parent.workspaceId));
            return { record, catalogData, owner, document: withOwnerIdentity(buildAssessmentReport(record, catalogData, locale), owner) };
        }
        catch {
            throw new Error("assessment-report-unavailable");
        }
    }
    return {
        async get(id: string, locale: Locale) { return (await read(id, locale))?.document ?? null; },
        async presentation(id: string, selection: ReportSelection) {
            const saved = await read(id, selection.locale);
            if (!saved) return null;
            const inventory = await scans.getScanInventory(saved.record.sourceScanId);
            return assessDocument(saved.record, saved.catalogData, saved.document, selection, saved.owner,
                inventory ? assessmentTopology(inventory) : undefined);
        },
    };
}
export const assessmentReports = createAssessmentReportService({ db: getDb });
