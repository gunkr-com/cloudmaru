import { expect, it } from "vitest";
import { MESSAGES } from "../index";
import { en } from "../en";
import { ko } from "../ko";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { MessageKey } from "../types";
import {
  componentStateSchema, deterministicCheckSchema, findingVerdictSchema,
  networkEngineResultSchema, networkQuerySchema, networkReasonCodeSchema,
  observationSchema, pillarSchema, reasonCodeSchema, severitySchema, sourceScanSchema,
  extensionArtifactRequestSchema,
} from "@/lib/completion/schema";
it("언어별 사전을 묶는다", () => { expect(MESSAGES).toEqual({ en, ko }); });

// locale-toggle, history, artifacts-section에서 런타임 값으로 조합하는 키.
const dynamicKeys: MessageKey[] = [
  // assessment-result.tsx와 report/document.ts: 검증된 저장 enum만 조합한다.
  ...componentStateSchema.options.map(value => `assessment.componentStatus.${value}` as const),
  ...findingVerdictSchema.options.flatMap(value => [`assessment.verdict.${value}`, `extension.verdict.${value}`] as const),
  ...severitySchema.options.map(value => `assessment.severity.${value}` as const),
  ...pillarSchema.options.map(value => `assessment.pillars.${value}` as const),
  ...reasonCodeSchema.options.flatMap(value => [`assessment.reasons.${value}`, `extension.reasons.${value}`] as const),
  ...observationSchema.options.map(option => `assessment.ui.${option.shape.state.value}` as const),
  ...sourceScanSchema.shape.completeness.options.map(option => `assessment.ui.${option.shape.state.value}` as const),
  ...(["filterSeverity", "filterPillar", "added", "removed", "changed", "diffUnknown",
    "outside-inventory", "missing-resource-id", "invalid-resource-id"] as const).map(value => `assessment.ui.${value}` as const),
  // Resource maps use known resource/relationship types and pinned catalog rule IDs.
  ...leafKeys({ assessment: { topology: { types: en.assessment.topology.types,
    relations: en.assessment.topology.relations, ruleSummaries: en.assessment.topology.ruleSummaries,
    nextChecks: en.assessment.topology.nextChecks, roles: en.assessment.topology.roles, state: en.assessment.topology.state } } }) as MessageKey[],
  // 기록 페이지의 저장 작업 상태. 로드맵 상태는 보고서에서도 사용한다.
  ...(["pending", "succeeded", "failed"] as const).flatMap(value => [`assessment.status.${value}`, `network.status.${value}`, `assessmentRoadmap.status.${value}`] as const),
  "assessmentRoadmap.status.not-requested",
  // AssessmentForm의 닫힌 오류 union; NetworkForm의 API allowlist와 상세 실패 분기.
  ...(["invalid-request", "workspace-changed", "internal"] as const).map(value => `assessment.errors.${value}` as const),
  ...(["invalid-query", "inventory-too-large", "scan-missing", "scan-not-succeeded", "resource-missing",
    "workspace-changed", "timeout", "interrupted", "internal"] as const).map(value => `network.errors.${value}` as const),
  // network-ui.tsx: 저장 query/engine의 검증된 enum.
  ...networkQuerySchema.shape.protocol.options.map(value => `network.protocols.${value}` as const),
  ...networkEngineResultSchema.shape.verdict.options.map(value => `network.verdict.${value}` as const),
  ...networkReasonCodeSchema.options.map(value => `network.reasons.${value}` as const),
  ...networkEngineResultSchema.shape.paths.element.shape.hops.element.shape.hopType.options.map(value => `network.hopTypes.${value}` as const),
  // extension-result/panel/render-file: 저장 검사 종류와 요청 종류만 조합한다.
  ...deterministicCheckSchema.shape.kind.options.map(value => `extension.result.${value}` as const),
  ...extensionArtifactRequestSchema.shape.kind.options.map(value => `extensionArtifacts.${value}` as const),
  // 인벤토리 화면이 코드 값(단계, 계열, 상태, 오류 코드, 표 열, 폼 필드)으로 조합하는 키 묶음만 둔다.
  ...leafKeys({ inventory: { stages: en.inventory.stages, families: en.inventory.families, status: en.inventory.status, errors: en.inventory.errors } }) as MessageKey[],
  ...(["resourceGroup", "region", "subscription", "tags"] as const).map(key => `inventory.table.${key}` as const),
  ...(["tenantId", "clientId", "certificatePath", "certificatePathHelp", "passwordEnv", "passwordEnvHelp", "subscriptionIds", "subscriptionIdsHelp"] as const satisfies readonly (keyof typeof en.inventory.connection.form)[])
    .map(key => `inventory.connection.form.${key}` as const),
  "workspace.connection", "workspace.connected", "workspace.notConnected", "workspace.lastScan",
  "common.languages.en", "common.languages.ko",
  "common.tiers.low", "common.tiers.balanced", "common.tiers.ha",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.(test|test-data)\./.test(path)
      && !path.startsWith("src/i18n/messages/") ? [path] : [];
  });
}

function leafKeys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "string" ? [path] : leafKeys(child, path);
  });
}

it("모든 사전 키는 제품 코드에서 참조하거나 동적 키 목록에 있다", () => {
  const references = new Set<string>(dynamicKeys);
  for (const file of sourceFiles("src")) {
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isStringLiteral(node)) references.add(node.text);
      // global-error와 프롬프트용 ko.analysis.* 같은 직접 사전 접근도 센다.
      if (ts.isPropertyAccessExpression(node)) {
        const path = node.getText(ast).split(".");
        if (path[0] === "en" || path[0] === "ko") references.add(path.slice(1).join("."));
        if (path[0] === "MESSAGES") references.add(path.slice(2).join("."));
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  expect(leafKeys(en).filter((key) => !references.has(key))).toEqual([]);
});
