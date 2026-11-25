import { assessment, syntheticResources } from "@/lib/completion/fixtures.test-data";
import { evaluateAssessmentRules } from "@/lib/assessment/rules/engine";
import { currentAssessmentCatalogData } from "@/lib/assessment/app/saved-evidence";
import type { AssessmentResult } from "@/types/assessment";
import { composeExplanation } from "./explanation";
import type { RoadmapPayload } from "./context";

export function roadmapModelFixture(payload: RoadmapPayload) {
  return { summary: composeExplanation({ relation: "review", actions: [payload.actions[0].alias], focus: "review" }, payload),
    phases: payload.actions.map(a => ({ title: composeExplanation({ relation: "review", actions: [a.alias], focus: "review" }, payload, "before", true),
      findingAliases: [...a.findingAliases], actionAliases: [a.alias] })) };
}

export function roadmapFixture() {
  // 실제 규칙으로 40개 자원의 violation/unknown 60개 이상을 만든다.
  const sample = syntheticResources.find(r => r.type === "microsoft.web/sites")!;
  const resources = Array.from({ length: 40 }, (_, i) => ({ ...structuredClone(sample),
    id: sample.id.replace(/[^/]+$/, `private-name-${i}`), name: `private-name-${i}`,
    properties: i % 2 ? {} : { httpsOnly: false, siteConfig: { minTlsVersion: "1.0" } },
  }));
  const parent: AssessmentResult = { ...structuredClone(assessment),
    local: evaluateAssessmentRules(resources, "2026-11-12T10:00:00Z"),
    advisor: { state: "not-requested" }, actualCost: { schemaVersion: 1,
      monthToDate: { state: "not-requested" }, trailing30Days: { state: "not-requested" } },
    diff: { state: "not-requested" }, roadmap: { state: "not-requested" },
  };
  return { parent, catalogData: currentAssessmentCatalogData(), resources };
}
