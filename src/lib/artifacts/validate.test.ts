import { describe, expect, it } from "vitest";
import { buildAnalysisResult } from "@/lib/analysis/build-result";
import { validateArtifact } from "@/lib/artifacts/validate";
import type { ArtifactKind, EvaluationContent } from "@/types/artifact";
import type { Catalog } from "@/types/catalog";
import type { AnalysisInput } from "@/types/analysis";
import components from "@/catalog/components.json";
import architectures from "@/catalog/reference-architectures.json";
import prices from "@/catalog/prices.json";
import input from "@/lib/analysis/fixtures/sample-input.json";
import model from "@/lib/analysis/fixtures/sample-model-output.json";
import guideFixture from "@/lib/artifacts/fixtures/sample-guide-output.json";
import evaluationFixture from "@/lib/artifacts/fixtures/sample-evaluation-output.json";
import bicepFixture from "@/lib/artifacts/fixtures/sample-bicep-output.json";

const catalog = { components, architectures, prices } as Catalog;
const analysisInput = input as AnalysisInput;
const analysis = buildAnalysisResult(model, analysisInput, catalog);
if (!analysis.ok) throw new Error(analysis.errors.join("; "));
const plan = analysis.result.plans.find(({ tier }) => tier === "balanced")!;
const ctx = { plan, catalog, region: "canadacentral" };
// 테스트마다 고치므로 복사본을 돌려준다. 가져온 JSON을 그대로 고치면 뒤 테스트에 영향이 남는다.
const fixture = (name: string) => structuredClone({
  "sample-guide-output.json": guideFixture,
  "sample-evaluation-output.json": evaluationFixture,
  "sample-bicep-output.json": bicepFixture,
}[name]) as unknown;

const cases: [ArtifactKind, string][] = [
  ["guide", "sample-guide-output.json"],
  ["evaluation", "sample-evaluation-output.json"],
  ["bicep", "sample-bicep-output.json"],
];
type MutableGuide = { overview: { en: string; ko: string }; steps: { componentIds: string[] }[] };
type MutableEvaluation = { cost: { grade: string } };
type MutableBicep = { code: string; parameters: { name: string; description: { en: string; ko: string } }[] };
type Mutation = (code: string) => string;

// 검증을 통과하는 예시 코드에 한 가지 변화만 더해, 그 검사 하나가 거부 이유인지 확인한다.
const bicep = (mutate: Mutation, extraParameters: string[] = []) => {
  const raw = fixture("sample-bicep-output.json") as MutableBicep;
  raw.code = mutate(raw.code);
  raw.parameters.push(...extraParameters.map((name) => ({ name, description: { en: "Input", ko: "입력" } })));
  return raw;
};
const append = (snippet: string): Mutation => (code) => `${code}${snippet}\n`;
const replace = (from: string, to: string): Mutation => (code) => {
  if (!code.includes(from)) throw new Error(`예시 코드에 '${from}'이(가) 없습니다.`);
  return code.replace(from, to);
};
const bicepErrors = (raw: unknown) => {
  const result = validateArtifact("bicep", raw, ctx);
  return result.ok ? [] : result.errors;
};

const frontDoorType = "'Microsoft.Network/frontDoors@2021-06-01'";
const frontDoorBody = "{\n  name: 'edge'\n  location: 'global'\n}";
const cdnModule = "module cdn 'br/public:avm/res/cdn/profile:0.3.0' = {\n  name: 'cdn'\n}";
const disallowedFrontDoor = "허용되지 않은 리소스 타입 'Microsoft.Network/frontDoors'";
const forbiddenStatement = "module, import, extension, using 문은 사용할 수 없습니다";
const unreadableResource = "resource 선언 형식을 확인할 수 없습니다";
const regionParameter = "분석 지역 location 매개변수가 필요합니다";
const backupPasswordSecret = "비밀 매개변수 'backupPassword'";

const unsafeBicep: [string, Mutation, string[], string][] = [
  ["disallowed resource type", append("resource sql 'Microsoft.Sql/servers@2023-01-01' = {\n  name: 'x'\n  location: location\n}"), [], "허용되지 않은 리소스 타입 'Microsoft.Sql/servers'"],
  ["relative child type", append("resource db 'databases@2024-08-01' existing = {\n  parent: postgres\n  name: 'x'\n}"), [], "하위 리소스는 parent 속성과 전체 타입 이름으로 선언해야 합니다"],
  ["invalid API version", append("resource otherVault 'Microsoft.KeyVault/vaults@latest' existing = {\n  name: vaultName\n}"), [], "API 버전 'latest' 형식이 올바르지 않습니다"],
  ["module", append("module child './main.bicep' = {\n  name: 'x'\n}"), [], forbiddenStatement],
  ["wrong location parameter", replace("param location string = 'canadacentral'", "param location string = 'eastus'"), [], regionParameter],
  ["wrong location value", replace("  location: location\n", "  location: 'eastus'\n"), [], "허용되지 않은 지역 'eastus'"],
  ["unsecured password", append("param backupPassword string"), ["backupPassword"], backupPasswordSecret],
  ["secret default", append("@secure()\nparam backupPassword string = 'bad'"), ["backupPassword"], backupPasswordSecret],
  ["secret default under other decorators", append("@secure()\n@description('Backup password.')\nparam backupPassword string = 'bad'"), ["backupPassword"], backupPasswordSecret],
  ["@secure() only inside a description string", append("@description('Mark this @secure() later.')\nparam backupPassword string"), ["backupPassword"], backupPasswordSecret],
  ["@secure() on an earlier declaration", append("@secure()\nparam backupSecret string\nvar backupMode = 'daily'\nparam backupPassword string"), ["backupSecret", "backupPassword"], backupPasswordSecret],
  ["secret output", append("output storageKey string = storage.listKeys().keys[0].value"), [], "비밀 값을 output으로 내보낼 수 없습니다"],
  ["parameter mismatch", append("param unexpected string"), [], "parameters: name이 코드의 param 이름과 일치해야 합니다"],
  // 상위 타입이 허용돼도 목록에 없는 하위 타입은 거부한다. 둘 다 견적에 없는 요금이 생긴다.
  ["unlisted child of a plan component type", append("resource threatProtection 'Microsoft.DBforPostgreSQL/flexibleServers/advancedThreatProtectionSettings@2024-08-01' = {\n  parent: postgres\n  name: 'Default'\n  properties: {\n    state: 'Enabled'\n  }\n}"), [], "허용되지 않은 리소스 타입 'Microsoft.DBforPostgreSQL/flexibleServers/advancedThreatProtectionSettings'"],
  ["unlisted child of a common type", append("resource peering 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2024-01-01' = {\n  name: 'vnet/peer'\n}"), [], "허용되지 않은 리소스 타입 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings'"],
];

// 주석·여러 줄 문자열로 정규식 검사를 피하려는 입력. Bicep은 주석을 토큰 사이 공백으로 취급하므로 그대로 배포된다.
const bypassBicep: [string, Mutation, string[], string][] = [
  ["block comment after the resource keyword", append(`resource /* edge */ fd ${frontDoorType} = ${frontDoorBody}`), [], disallowedFrontDoor],
  ["line comment after the resource keyword", append(`resource // edge\n  fd ${frontDoorType} = ${frontDoorBody}`), [], disallowedFrontDoor],
  ["multi-line block comment inside the declaration", append(`resource /* edge\n  network */ fd ${frontDoorType} = ${frontDoorBody}`), [], disallowedFrontDoor],
  ["comment between the symbolic name and the type", append(`resource fd /* edge */ ${frontDoorType} = ${frontDoorBody}`), [], disallowedFrontDoor],
  ["block comment between the type and =", append(`resource fd ${frontDoorType} /* edge */ = ${frontDoorBody}`), [], disallowedFrontDoor],
  ["line comment between the type and =", append(`resource fd ${frontDoorType} // edge\n  = ${frontDoorBody}`), [], disallowedFrontDoor],
  ["multi-line string as the resource type", append(`resource fd '''Microsoft.Network/frontDoors@2021-06-01''' = ${frontDoorBody}`), [], unreadableResource],
  ["multi-line string type balanced by a declaration inside a string", append(`resource fd '''Microsoft.Network/frontDoors@2021-06-01''' = ${frontDoorBody}\nvar decoy = '''\nresource site 'Microsoft.Web/sites@2023-12-01' = {\n'''`), [], unreadableResource],
  ["comment before module", append(`/* cdn */ ${cdnModule}`), [], forbiddenStatement],
  ["module after a closing brace on the same line", (code) => `${code.trimEnd()} ${cdnModule}\n`, [], forbiddenStatement],
  ["import after a comment", append("/* shared */ import * as shared from 'shared.bicep'"), [], forbiddenStatement],
  ["extension after a closing brace", (code) => `${code.trimEnd()} extension microsoftGraphV1\n`, [], forbiddenStatement],
  ["comment-hidden secret parameter", append("@secure()\nparam /* db */ backupPassword string = 'bad'"), ["backupPassword"], backupPasswordSecret],
  ["parameter the declaration pattern cannot read", append("param adminKey 'fixed' = 'fixed'"), [], "param 선언 형식을 확인할 수 없습니다"],
  ["location parameter faked inside a multi-line string", replace("param location string = 'canadacentral'", "param location string = 'eastus'\nvar note = '''\nparam location string = 'canadacentral'\n'''"), [], regionParameter],
  ["unterminated block comment", append("/* 닫히지 않은 주석"), [], "닫히지 않은 문자열이나 주석이 있습니다"],
];

const safeBicep: [string, Mutation][] = [
  ["comments on their own lines", append("// 운영 메모: 배포 전에 이름을 확인합니다.\n/* 여러 줄 주석\n   module, resource 같은 단어가 있어도 됩니다. */")],
  ["trailing comments", (code) => replace("  kind: 'linux'\n", "  kind: 'linux' /* Linux 플랜 */\n")(replace("param location string = 'canadacentral'", "param location string = 'canadacentral' // 가격 기준 지역")(code))],
  ["comment markers inside strings", replace("\nresource plan", "\nvar pathNote = 'a//b'\nvar globNote = '/* not a comment'\nvar quoteNote = 'it\\'s // fine'\nvar nested = '${appName}-//-${'/*'}'\nvar script = '''\n// 문자열 안의 줄\n/* 닫지 않은 표시\n'''\n\nresource plan")],
  ["resourceGroup() and a property named resource", replace("  kind: 'linux'\n", "  kind: 'linux'\n  tags: {\n    region: resourceGroup().location\n    resource: 'plan'\n  }\n")],
  ["an existing resource declaration", append("resource existingVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {\n  name: vaultName\n}")],
  ["a child type listed for a plan component", append("resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {\n  parent: postgres\n  name: 'AllowAzureServices'\n  properties: {\n    startIpAddress: '0.0.0.0'\n    endIpAddress: '0.0.0.0'\n  }\n}")],
];

describe("validateArtifact", () => {
  it.each(cases)("accepts the hand-written %s example and normalizes evaluation axes", (kind, name) => {
    const result = validateArtifact(kind, fixture(name), ctx);
    expect(result.ok).toBe(true);
    if (kind === "evaluation" && result.ok) {
      expect((result.content as EvaluationContent).axes.map(({ axis }) => axis)).toEqual(["reliability", "security", "cost", "operations", "performance"]);
    }
  });

  it.each(cases)("rejects URL strings in %s", (kind, name) => {
    const raw = fixture(name) as Record<string, unknown>;
    if (kind === "guide") raw.overview = { en: "Read the documentation", ko: "문서 www.example.com 확인" };
    if (kind === "evaluation") raw.summary = { en: "Summary", ko: "https://example.com" };
    if (kind === "bicep") raw.code = "// http://example.com";
    const result = validateArtifact(kind, raw, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/URL/);
  });

  it.each(["CA$12,000", "3만 원", "120000원", "$19", "20 USD", "20 CAD", "20,000 KRW", "20,000 원", "₩20,000", "20달러"])("rejects model-authored amount %s", (amount) => {
    const raw = fixture("sample-guide-output.json") as MutableGuide;
    raw.overview.ko = `예상 비용 ${amount}`;
    const result = validateArtifact("guide", raw, ctx);
    expect(result.ok).toBe(false);
  });

  it("allows budget ratios and rejects out-of-plan or compute-free guides and invalid step counts", () => {
    const good = fixture("sample-guide-output.json") as MutableGuide;
    good.overview.ko = "예산의 80% 수준입니다.";
    expect(validateArtifact("guide", good, ctx).ok).toBe(true);
    const outside = structuredClone(good); outside.steps[0].componentIds = ["not-in-plan"];
    expect(validateArtifact("guide", outside, ctx).ok).toBe(false);
    const noCompute = structuredClone(good); noCompute.steps.forEach((step) => { step.componentIds = ["postgres-flex-b2s"]; });
    expect(validateArtifact("guide", noCompute, ctx).ok).toBe(false);
    const tooFew = structuredClone(good); tooFew.steps = tooFew.steps.slice(0, 4);
    expect(validateArtifact("guide", tooFew, ctx).ok).toBe(false);
  });

  it("rejects missing or invalid evaluation axes", () => {
    const missing = fixture("sample-evaluation-output.json") as Record<string, unknown>; delete missing.security;
    expect(validateArtifact("evaluation", missing, ctx).ok).toBe(false);
    const invalid = fixture("sample-evaluation-output.json") as MutableEvaluation; invalid.cost.grade = "excellent";
    expect(validateArtifact("evaluation", invalid, ctx).ok).toBe(false);
  });

  it("accepts the unmodified Bicep fixture", () => {
    expect(bicepErrors(fixture("sample-bicep-output.json"))).toEqual([]);
  });

  // 오류가 정확히 하나라야 다른 검사(예: resource 선언 없음)에 기대어 통과하는 테스트가 되지 않는다.
  it.each(unsafeBicep)("rejects unsafe Bicep: %s", (_name, mutate, extraParameters, expected) => {
    expect(bicepErrors(bicep(mutate, extraParameters))).toEqual([expect.stringContaining(expected)]);
  });

  it("rejects Bicep without a resource declaration", () => {
    const raw = fixture("sample-bicep-output.json") as MutableBicep;
    raw.code = "param location string = 'canadacentral'\nvar region = location\n";
    raw.parameters = [{ name: "location", description: { en: "Azure region.", ko: "Azure 리소스 지역입니다." } }];
    expect(bicepErrors(raw)).toEqual([expect.stringContaining("resource 선언이 하나 이상 필요합니다")]);
  });

  it.each(bypassBicep)("rejects Bicep that hides a check behind a %s", (_name, mutate, extraParameters, expected) => {
    expect(bicepErrors(bicep(mutate, extraParameters))).toEqual([expect.stringContaining(expected)]);
  });

  it.each(safeBicep)("accepts Bicep with %s", (_name, mutate) => {
    expect(bicepErrors(bicep(mutate))).toEqual([]);
  });

  // Bicep은 데코레이터 순서를 따지지 않는다. 실제 모델 출력은 @secure() 위나 아래에 @description()을 둔다.
  it.each([
    ["@secure() above @description()", "@secure()\n@description('Backup password.')\nparam backupPassword string"],
    ["@secure() below @description() and @minLength()", "@description('Backup password.')\n@minLength(12)\n@secure()\nparam backupPassword string"],
    ["a multi-line @allowed() between", "@secure()\n@allowed([\n  'one'\n  'two'\n])\nparam backupPassword string"],
    ["a comment and a parenthesis inside a string between", "@secure()\n// set at deploy time\n@description('Password (12+ chars).')\nparam backupPassword string"],
    ["the sys namespace", "@sys.secure()\n@sys.description('Backup password.')\nparam backupPassword string"],
    ["decorators on the same line", "@description('Backup password.') @secure() param backupPassword string"],
  ])("accepts a secret parameter with %s", (_name, snippet) => {
    expect(bicepErrors(bicep(append(snippet), ["backupPassword"]))).toEqual([]);
  });

  // 재시도 때 이 문장이 모델에 그대로 간다. 위치는 따지지 않으므로 고칠 것만 말한다.
  const secureMissing = "code: 비밀 매개변수 'backupPassword'에 @secure()를 붙여야 합니다.";
  const secretDefault = "code: 비밀 매개변수 'backupPassword'에서 기본값을 지워야 합니다.";
  it.each([
    ["no @secure()", "@description('Backup password.')\nparam backupPassword string", [secureMissing]],
    ["a default value", "@description('Backup password.')\n@secure()\nparam backupPassword string = 'bad'", [secretDefault]],
    ["no @secure() and a default value", "param backupPassword string = 'bad'", [secureMissing, secretDefault]],
  ])("tells the model what to fix for a secret parameter with %s", (_name, snippet, expected) => {
    expect(bicepErrors(bicep(append(snippet), ["backupPassword"]))).toEqual(expected);
  });

  it.each([
    ["URL", "// 참고: https://learn.microsoft.com", "URL을 포함할 수 없습니다"],
    ["amount", "/* 월 3만 원 예상 */", "금액은 모델이 작성할 수 없습니다"],
  ])("still rejects a model-authored %s inside a Bicep comment", (_name, comment, expected) => {
    expect(bicepErrors(bicep(append(comment)))).toEqual([expect.stringContaining(expected)]);
  });

  // 견적은 서버리스 Cosmos DB만 다룬다. 프로비저닝 모드면 처리량이 시간당 고정 과금되어 견적과 어긋난다.
  describe("Cosmos DB", () => {
    const cosmosService = { componentId: "cosmos-db-serverless-ru", name: { en: "Cosmos DB serverless request units", ko: "Cosmos DB 서버리스 요청 단위" }, quantity: 10, unitLabel: { en: "백만 RU", ko: "백만 RU" } };
    const cosmosCtx = { plan: { ...plan, services: [...plan.services, cosmosService] }, catalog, region: ctx.region };
    const cosmosErrors = (snippet: string) => {
      const result = validateArtifact("bicep", bicep(append(snippet)), cosmosCtx);
      return result.ok ? [] : result.errors;
    };
    const capabilities = "    capabilities: [\n      {\n        name: 'EnableServerless'\n      }\n    ]\n";
    const account = (properties: string, extra = "") => `resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {\n  name: 'cosmos-app'\n  location: location\n${extra}  properties: {\n    databaseAccountOfferType: 'Standard'\n    locations: [\n      {\n        locationName: location\n      }\n    ]\n${properties}  }\n}\n`;
    const database = (options = "", parent = "  parent: cosmos\n") => `resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {\n${parent}  name: 'app'\n  properties: {\n    resource: {\n      id: 'app'\n    }\n${options}  }\n}\n`;
    const container = (options = "") => `resource cosmosItems 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {\n  parent: cosmosDb\n  name: 'items'\n  properties: {\n    resource: {\n      id: 'items'\n      partitionKey: {\n        paths: [\n          '/id'\n        ]\n        kind: 'Hash'\n      }\n    }\n${options}  }\n}\n`;
    const notServerless = "Cosmos DB 계정은 서버리스(capabilities에 EnableServerless)로 새로 만들어야 합니다";
    const throughput = "Cosmos DB에는 처리량(throughput, autoscaleSettings)을 지정할 수 없습니다";

    it.each([
      ["a serverless account with a database and a container", `${account(capabilities)}${database()}${container()}`],
      ["capacityMode Serverless alongside EnableServerless", account(`${capabilities}    capacityMode: 'Serverless'\n`)],
      ["comments and strings that mention throughput", `${account(capabilities)}// throughput: 400 은 서버리스에서 쓰지 않습니다.\nvar note = 'autoscaleSettings: none'\n`],
    ])("accepts %s", (_name, snippet) => {
      expect(cosmosErrors(snippet)).toEqual([]);
    });

    it.each([
      ["an account without EnableServerless", account(""), notServerless],
      ["EnableServerless only inside a comment", account("    // capabilities: [ { name: 'EnableServerless' } ]\n"), notServerless],
      ["EnableServerless as a tag instead of a capability", account("", "  tags: {\n    name: 'EnableServerless'\n  }\n"), notServerless],
      ["EnableServerless inside a string", account("    capabilities: [\n      {\n        name: 'x'\n        note: 'name: \\'EnableServerless\\''\n      }\n    ]\n"), notServerless],
      ["a provisioned capacityMode", account(`${capabilities}    capacityMode: 'Provisioned'\n`), notServerless],
      ["an existing account", `resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' existing = {\n  name: 'cosmos-app'\n}\n${database()}`, notServerless],
      ["a database without an account in the file", database("", ""), notServerless],
      ["database throughput", `${account(capabilities)}${database("    options: {\n      throughput: 400\n    }\n")}`, throughput],
      ["container autoscale", `${account(capabilities)}${database()}${container("    options: {\n      autoscaleSettings: {\n        maxThroughput: 1000\n      }\n    }\n")}`, throughput],
    ])("rejects %s", (_name, snippet, expected) => {
      expect(cosmosErrors(snippet)).toEqual([expect.stringContaining(expected)]);
    });
  });

  it("collects schema and content errors together", () => {
    const raw = fixture("sample-guide-output.json") as MutableGuide;
    raw.overview.ko = "www.bad.example";
    raw.steps = [];
    const result = validateArtifact("guide", raw, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(1);
  });
});

it.each(["canadacentral", "global", "eastus2", "koreacentral", "eastasia"])("literal location %s follows the analysis region and exceptions", location => {
  const raw = bicep(replace("  location: location\n", `  location: '${location}'\n`));
  expect(validateArtifact("bicep", raw, ctx).ok).toBe(["canadacentral", "global", "eastus2"].includes(location));
});
it("rejects a different default location and escapes regex metacharacters", () => {
  expect(validateArtifact("bicep", bicep(replace("'canadacentral'", "'koreacentral'")), ctx).ok).toBe(false);
  const region = "test.region+";
  expect(validateArtifact("bicep", bicep(replace("'canadacentral'", `'${region}'`)), { ...ctx, region }).ok).toBe(true);
  expect(validateArtifact("bicep", bicep(replace("'canadacentral'", "'testXregionnn'")), { ...ctx, region }).ok).toBe(false);
});

it.each(["eastus2", "eastasia"])("Static Web Apps exception location %s", location => {
  const component = catalog.components.find(({ id }) => id === "static-web-apps-standard")!;
  const context = { ...ctx, plan: { ...plan, services: [...plan.services, { componentId: component.id, name: component.name, unitLabel: component.unitLabel, quantity: 1 }] } };
  const raw = bicep(append(`resource staticSite 'Microsoft.Web/staticSites@2023-12-01' = {\n  name: 'static-site'\n  location: '${location}'\n}`));
  expect(validateArtifact("bicep", raw, context).ok).toBe(location === "eastus2");
});

it.each(["CA$120", "$120", "120 dollars", "USD 120", "120 CAD", "40 Canadian dollars", "1.2k CAD", "1.2K USD", "3M dollars"])("rejects English amounts: %s", amount => {
  const raw = structuredClone(guideFixture);
  Object.assign(raw, { overview: { en: amount, ko: "설명" } });
  const result = validateArtifact("guide", raw, ctx);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors).toContainEqual(expect.stringContaining("overview.en: 금액"));
});
it.each(["2 instances", "100 GB"])("allows quantities: %s", quantity => {
  const raw = structuredClone(guideFixture);
  Object.assign(raw, { overview: { en: quantity, ko: "설명" } });
  expect(validateArtifact("guide", raw, ctx).ok).toBe(true);
});
