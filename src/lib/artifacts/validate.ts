import { STATIC_WEB_APPS_LOCATION } from "@/lib/workspace/regions";
import { z } from "zod";
import { scanBicep } from "@/lib/artifacts/bicep-source";
import { allowedResourceTypes, isResourceTypeAllowed } from "@/lib/artifacts/resource-types";
import { bicepOutputSchema, evaluationOutputSchema, guideOutputSchema } from "@/lib/artifacts/schemas";
import type { PlanResult } from "@/types/analysis";
import type { ArtifactContentMap, ArtifactKind, EvaluationAxis } from "@/types/artifact";
import type { Catalog } from "@/types/catalog";

type Context = { plan: PlanResult; catalog: Catalog; region: string };
const axes: EvaluationAxis[] = ["reliability", "security", "cost", "operations", "performance"];
const axisLabels = { reliability: "신뢰성", security: "보안", cost: "비용", operations: "운영", performance: "성능" };
const urlPattern = /https?:\/\/|www\./i;
// 숫자 뒤의 k·M·B 단위("1.2k CAD")와 "Canadian dollars" 같은 영어 표기도 금액이다. "100 GB" 같은 수량은 통과한다.
const amountPattern = /₩\s*\d|\$\s*\d|(?:USD|CAD|KRW)\s*\d|\d[\d,]*(?:\.\d+)?\s*[kmb]?(?:만)?\s*(?:원|달러|USD|CAD|KRW|(?:canadian\s+|us\s+|american\s+)?dollars?\b)/i;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function strings(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function allStrings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => allStrings(item, `${path}.${index}`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => allStrings(child, path ? `${path}.${key}` : key));
  return [];
}
function isSensitiveParam(name: string): boolean {
  return /password|secret|connectionstring|key$/i.test(name);
}

// 문자열 밖(mask 기준)에서 이름이 이어지는 키워드. foo.resource 같은 속성 접근은 문장이 될 수 없어 뺀다.
const resourceKeyword = /(?<![\w.])resource\s+[A-Za-z_]/g;
const paramKeyword = /(?<![\w.])param\s+[A-Za-z_]/g;
const statementKeyword = /(?<![\w.])(?:module|import|extension|using)\s+(?=[A-Za-z_'"{*])/;
// 타입은 이스케이프·보간 없는 한 줄 문자열만 받는다. '''…''' 타입은 여기에 맞지 않아 형식 오류가 된다.
const declarationPattern = String.raw`\bresource\s+([A-Za-z_][\w]*)\s+(['"])([^'"\s\\$]+)\2\s*(existing\s*)?=`;

// mask에서 open 위치의 괄호와 짝이 맞는 구간을 찾는다. 문자열 안의 괄호는 mask에서 가려져 있다.
function bracketed(mask: string, open: number, opening: string, closing: string): { start: number; end: number } | null {
  if (open < 0 || mask[open] !== opening) return null;
  let depth = 0;
  for (let index = open; index < mask.length; index++) {
    if (mask[index] === opening) depth++;
    else if (mask[index] === closing && --depth === 0) return { start: open, end: index + 1 };
  }
  return null;
}

// 선언 바로 앞에 붙은 데코레이터 이름들(`@secure()`, `@sys.description('…')`). 순서는 상관없다.
// 문자열 안의 괄호와 주석은 mask에서 가려져 있어 짝 맞추기에 끼지 않는다.
function decoratorsBefore(mask: string, keywordIndex: number): string[] {
  const names: string[] = [];
  let index = keywordIndex;
  for (;;) {
    let close = index - 1;
    while (close >= 0 && /\s/.test(mask[close])) close--;
    if (mask[close] !== ")") return names;
    let depth = 0; let open = close;
    for (; open >= 0; open--) {
      if (mask[open] === ")") depth++;
      else if (mask[open] === "(" && --depth === 0) break;
    }
    const name = /@([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)$/.exec(mask.slice(Math.max(0, open - 200), Math.max(0, open)));
    if (open < 0 || !name) return names;
    names.push(name[1]);
    index = open - name[0].length;
  }
}

// 문자열 밖에 있는 키 `key: '값'`의 값들. 키 위치가 mask에 남아 있어야 문자열 안의 글자에 속지 않는다.
function stringValuesOf(key: string, code: string, mask: string, range: { start: number; end: number }): string[] {
  const pattern = new RegExp(String.raw`(?<![\w.])${key}\s*:\s*'([^'\\]*)'`, "g");
  return [...code.slice(range.start, range.end).matchAll(pattern)]
    .filter(({ index }) => mask.startsWith(key, range.start + index))
    .map((match) => match[1]);
}

// 견적은 서버리스 Cosmos DB만 다룬다. 프로비저닝 모드에서는 할당한 처리량이 시간당 고정으로 과금되므로
// 비용을 정하는 계정의 용량 모드와 처리량 설정을 코드로 확인한다.
const cosmosAccountType = "microsoft.documentdb/databaseaccounts";
function checkCosmos(resources: RegExpExecArray[], code: string, mask: string, errors: string[]): void {
  const typeOf = (match: RegExpExecArray) => match[3].split("@")[0].toLowerCase();
  const cosmos = resources.filter((match) => typeOf(match) === cosmosAccountType || typeOf(match).startsWith(`${cosmosAccountType}/`));
  if (!cosmos.length) return;

  // existing으로 참조한 계정은 모드를 알 수 없고, 계정 없이 선언한 하위 리소스도 마찬가지다.
  const accounts = cosmos.filter((match) => typeOf(match) === cosmosAccountType);
  const isServerless = (match: RegExpExecArray) => {
    if (match[4]) return false;
    const body = bracketed(mask, mask.indexOf("{", match.index + match[0].length), "{", "}");
    if (!body) return false;
    const modes = stringValuesOf("capacityMode", code, mask, body);
    if (modes.some((mode) => mode.toLowerCase() !== "serverless")) return false;
    const capabilityLists = [...mask.slice(body.start, body.end).matchAll(/(?<![\w.])capabilities\s*:\s*\[/g)]
      .map(({ index, 0: text }) => bracketed(mask, body.start + index + text.length - 1, "[", "]"))
      .filter((range) => range !== null);
    return capabilityLists.some((range) => stringValuesOf("name", code, mask, range).some((name) => name.toLowerCase() === "enableserverless"));
  };
  if (!accounts.length || !accounts.every(isServerless)) {
    errors.push("code: Cosmos DB 계정은 서버리스(capabilities에 EnableServerless)로 새로 만들어야 합니다.");
  }
  if (/(?<![\w.])(?:throughput|autoscaleSettings)\s*:/i.test(mask)) {
    errors.push("code: Cosmos DB에는 처리량(throughput, autoscaleSettings)을 지정할 수 없습니다.");
  }
}

function checkBicep(source: string, parameters: { name: string }[], context: Context, errors: string[]): void {
  const allowed = allowedResourceTypes(context.plan, context.catalog);
  // Bicep은 주석을 토큰 사이 공백으로 보므로 구조 검사는 주석을 걷어낸 code로 한다. URL·금액 검사는 원문에 이미 했다.
  const { code, mask, unterminated } = scanBicep(source);
  const outsideString = (index: number, keyword: string) => mask.startsWith(keyword, index);
  if (unterminated) errors.push("code: 닫히지 않은 문자열이나 주석이 있습니다.");
  if (/^\s*(?:module|import|extension|using)\b/im.test(code) || statementKeyword.test(mask)) errors.push("code: module, import, extension, using 문은 사용할 수 없습니다.");
  const escapedRegion = context.region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const locationParam = new RegExp(String.raw`^(\s*)param\s+location\s+string\s*=\s*['"]${escapedRegion}['"]\s*$`, "gim");
  if (![...code.matchAll(locationParam)].some((match) => outsideString(match.index + match[1].length, "param"))) errors.push("code: 분석 지역 location 매개변수가 필요합니다.");
  const locationRegex = /\blocation\s*:\s*(['"])(.*?)\1/g;
  for (const match of code.matchAll(locationRegex)) if (![context.region.toLowerCase(), "global", STATIC_WEB_APPS_LOCATION].includes(match[2].toLowerCase())) errors.push(`code: 허용되지 않은 지역 '${match[2]}'입니다.`);

  // 문자열 밖의 resource 키워드는 모두 그 자리에서 엄격한 선언 형식이어야 하고, 형식에 맞는 선언이 문자열 안에 있어서도 안 된다.
  // 개수만 맞추면 문자열 안의 가짜 선언으로 읽지 못한 선언을 상쇄할 수 있으므로 위치로 대조한다.
  const declarationAt = new RegExp(declarationPattern, "y");
  const resources: RegExpExecArray[] = [];
  let unreadable = false;
  for (const { index } of mask.matchAll(resourceKeyword)) {
    declarationAt.lastIndex = index;
    const match = declarationAt.exec(code);
    if (match) resources.push(match);
    else unreadable = true;
  }
  const declared = new Set(resources.map(({ index }) => index));
  if ([...code.matchAll(new RegExp(declarationPattern, "g"))].some(({ index }) => !declared.has(index))) unreadable = true;
  if (unreadable) errors.push("code: resource 선언 형식을 확인할 수 없습니다.");
  if (!resources.length) errors.push("code: resource 선언이 하나 이상 필요합니다.");
  for (const match of resources) {
    const typeVersion = match[3];
    const [type, version] = typeVersion.split("@");
    if (!type?.startsWith("Microsoft.")) errors.push("code: 하위 리소스는 parent 속성과 전체 타입 이름으로 선언해야 합니다.");
    else if (!isResourceTypeAllowed(type, allowed)) errors.push(`code: 허용되지 않은 리소스 타입 '${type}'입니다.`);
    if (!version || !/^\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(version)) errors.push(`code: API 버전 '${version ?? ""}' 형식이 올바르지 않습니다.`);
  }
  checkCosmos(resources, code, mask, errors);

  const params = new Map<string, { hasDefault: boolean; secure: boolean }>();
  const paramStarts = new Set<number>();
  const paramRegex = /(^|\n)([^\n]*?)\bparam\s+([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*)([^\n]*)/g;
  for (const match of code.matchAll(paramRegex)) {
    const lineStart = match.index + match[1].length; const keywordIndex = lineStart + match[2].length;
    paramStarts.add(keywordIndex);
    // @secure()는 데코레이터 블록 어디에 있어도 된다. 문자열 안의 글자에 속지 않도록 mask에서 찾는다.
    const secure = decoratorsBefore(mask, keywordIndex).some((name) => name === "secure" || name === "sys.secure");
    params.set(match[3], { hasDefault: match[5].includes("="), secure });
  }
  // 위 형식으로 읽지 못한 param(예: 리터럴 타입)은 이름 대조와 비밀 매개변수 검사를 피하므로 거부한다.
  if ([...mask.matchAll(paramKeyword)].some(({ index }) => !paramStarts.has(index))) errors.push("code: param 선언 형식을 확인할 수 없습니다.");
  const codeNames = [...params.keys()].sort();
  const suppliedNames = parameters.map(({ name }) => name).sort();
  if (JSON.stringify(codeNames) !== JSON.stringify(suppliedNames)) errors.push("parameters: name이 코드의 param 이름과 일치해야 합니다.");
  // 재시도 때 이 문장이 모델에 그대로 간다. @secure()는 데코레이터 블록 어디에 있어도 되므로 고칠 것만 말한다.
  for (const [name, meta] of params) {
    if (!isSensitiveParam(name)) continue;
    if (!meta.secure) errors.push(`code: 비밀 매개변수 '${name}'에 @secure()를 붙여야 합니다.`);
    if (meta.hasDefault) errors.push(`code: 비밀 매개변수 '${name}'에서 기본값을 지워야 합니다.`);
  }
  for (const match of code.matchAll(/\boutput\b[^\n]*\b(?:listKeys|listConnectionStrings)\s*\(|\boutput\b[^\n]*\b(?:[A-Za-z_]\w*(?:password|secret|connectionstring|key))\b/gi)) {
    errors.push(`code: 비밀 값을 output으로 내보낼 수 없습니다 (${match[0].trim()}).`);
  }
}

export function validateArtifact<K extends ArtifactKind>(
  kind: K,
  raw: unknown,
  ctx: Context,
): { ok: true; content: ArtifactContentMap[K] } | { ok: false; errors: string[] } {
  const schema = kind === "guide" ? guideOutputSchema : kind === "evaluation" ? evaluationOutputSchema : bicepOutputSchema;
  const parsed = schema.safeParse(raw, { error: z.locales.ko().localeError });
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  for (const [path, value] of allStrings(raw)) {
    if (urlPattern.test(value)) errors.push(`${path}: 모델이 작성한 글에는 URL을 포함할 수 없습니다.`);
    if (amountPattern.test(value)) errors.push(`${path}: 금액은 모델이 작성할 수 없습니다.`);
  }

  if (kind === "guide") {
    const root = record(raw);
    const planIds = new Set(ctx.plan.services.map(({ componentId }) => componentId));
    const computeIds = new Set(ctx.catalog.components.filter(({ category }) => category === "compute").map(({ id }) => id));
    let hasCompute = false;
    strings(root.steps).forEach((stepValue, index) => {
      const step = record(stepValue); const ids = strings(step.componentIds); const seen = new Set<string>();
      ids.forEach((id) => {
        if (typeof id !== "string") return;
        if (!planIds.has(id)) errors.push(`steps.${index}.componentIds: 구성요소 '${id}'가 선택한 안에 없습니다.`);
        if (seen.has(id)) errors.push(`steps.${index}.componentIds: 구성요소 '${id}'가 중복되었습니다.`);
        seen.add(id); if (computeIds.has(id)) hasCompute = true;
      });
    });
    if (!hasCompute) errors.push("steps: 컴퓨트 구성요소를 다루는 단계가 하나 이상 필요합니다.");
  }

  if (kind === "evaluation") {
    const root = record(raw);
    for (const axis of axes) {
      const value = record(root[axis]);
      if (!("grade" in value) || !("rationale" in value) || !("improvement" in value)) errors.push(`${axisLabels[axis]}: 등급·근거·개선 제안이 필요합니다.`);
      if ("grade" in value && !["high", "medium", "low"].includes(String(value.grade))) errors.push(`${axisLabels[axis]}: 등급은 high, medium, low 중 하나여야 합니다.`);
    }
  }
  if (kind === "bicep") {
    const root = record(raw); if (typeof root.code === "string") checkBicep(root.code, Array.isArray(root.parameters) ? root.parameters as { name: string }[] : [], ctx, errors);
  }

  if (!parsed.success || errors.length) return { ok: false, errors };
  let content: unknown = parsed.data;
  if (kind === "evaluation") {
    const result = parsed.data as z.infer<typeof evaluationOutputSchema>;
    content = { summary: result.summary, axes: axes.map((axis) => ({ axis, ...result[axis] })) };
  }
  return { ok: true, content: content as ArtifactContentMap[K] };
}
