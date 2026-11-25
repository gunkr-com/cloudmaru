import { describe, expect, it } from "vitest";
import { loadCatalog } from "@/lib/catalog/load";
import { USER_NODE_ID, tierSchema } from "@/lib/catalog/schema";
import { buildMermaid } from "@/lib/diagram/build-mermaid";
import type { ModelPlan } from "@/types/analysis";
import type { Catalog, Connection, PlanItem } from "@/types/catalog";

function createCatalog(): Catalog {
  return {
    components: [
      ["web-app", "웹 앱"],
      ["database", "관계형 DB"],
      ["storage", "파일 저장소"],
    ].map(([id, name]) => ({
      id,
      name: { en: name, ko: name },
      category: "compute",
      description: { en: "다이어그램 테스트 구성요소", ko: "다이어그램 테스트 구성요소" },
      unitLabel: { en: "개", ko: "개" },
      bicepResourceTypes: [],
      pricing: { kind: "free" },
    })),
    architectures: [],
    prices: { asOf: "2026-10-08", currency: "CAD", regions: ["canadacentral"], usdToCad: { rate: 1.4, pairs: 5 }, prices: {} },
  };
}

function createPlan(): { items: PlanItem[]; connections: Connection[] } {
  return {
    items: [
      { componentId: "web-app", quantity: 2 },
      { componentId: "database", quantity: 1 },
      { componentId: "storage", quantity: 50 },
    ],
    connections: [
      { from: USER_NODE_ID, to: "web-app" },
      { from: "web-app", to: "database" },
    ],
  };
}

describe("buildMermaid", () => {
  it("순번 ID와 카탈로그 이름으로 사용자 연결과 고립 노드를 포함한 전체 문자열을 만든다", () => {
    expect(buildMermaid(createPlan(), createCatalog()).ko).toBe([
      "flowchart LR",
      '  n0["웹 앱"]',
      '  n1["관계형 DB"]',
      '  n2["파일 저장소"]',
      '  n3["사용자"]',
      "  n3 --> n0",
      "  n0 --> n1",
    ].join("\n"));
  });

  it("사용자 연결이 없으면 사용자 노드를 만들지 않고 items 순서를 따른다", () => {
    const plan = createPlan();
    plan.items.reverse();
    plan.connections = [];
    expect(buildMermaid(plan, createCatalog()).ko).toBe([
      "flowchart LR",
      '  n0["파일 저장소"]',
      '  n1["관계형 DB"]',
      '  n2["웹 앱"]',
    ].join("\n"));
  });

  it("연결 순서를 유지하고 같은 방향의 중복 연결만 제거한다", () => {
    const plan = createPlan();
    plan.connections = [
      { from: "web-app", to: "database" },
      { from: USER_NODE_ID, to: "web-app" },
      { from: "web-app", to: "database" },
      { from: "database", to: "web-app" },
      { from: USER_NODE_ID, to: "web-app" },
      { from: USER_NODE_ID, to: "database" },
    ];
    expect(buildMermaid(plan, createCatalog()).ko).toBe([
      "flowchart LR",
      '  n0["웹 앱"]',
      '  n1["관계형 DB"]',
      '  n2["파일 저장소"]',
      '  n3["사용자"]',
      "  n0 --> n1",
      "  n3 --> n0",
      "  n1 --> n0",
      "  n3 --> n1",
    ].join("\n"));
  });

  it("사용자가 연결의 도착점이어도 예약 노드를 사용한다", () => {
    const plan = {
      items: [{ componentId: "web-app", quantity: 1 }],
      connections: [{ from: "web-app", to: USER_NODE_ID }],
    };
    expect(buildMermaid(plan, createCatalog()).ko).toBe(
      'flowchart LR\n  n0["웹 앱"]\n  n1["사용자"]\n  n0 --> n1',
    );
  });

  it("빈 입력에는 방향 선언만 출력한다", () => {
    expect(buildMermaid({ items: [], connections: [] }, createCatalog()).ko).toBe("flowchart LR");
  });

  it.each(["end", "node[bad];\nclick n0", "n0", "__proto__"])(
    "구성요소 ID %s를 Mermaid 구문에 노출하지 않는다",
    (id) => {
      const catalog = createCatalog();
      catalog.components[0].id = id;
      expect(buildMermaid({
        items: [{ componentId: id, quantity: 1 }],
        connections: [{ from: USER_NODE_ID, to: id }],
      }, catalog).ko).toBe('flowchart LR\n  n0["웹 앱"]\n  n1["사용자"]\n  n1 --> n0');
    },
  );

  it.each([
    ['앱 "운영" <웹>', "앱 '운영' (웹)"],
    ["`앱`\r\nDB\n파일\r저장소\u2028로그\u2029키", "'앱' DB 파일 저장소 로그 키"],
    ['앱\"]\nstyle n0 fill:red\nclassDef x\nclick n0\n<b>파일</b>',
      "앱'] style n0 fill:red classDef x click n0 (b)파일(/b)"],
    ["&lt;b&gt;앱&lt;/b&gt; #quot; &#34; \\", "＆lt;b＆gt;앱＆lt;/b＆gt; ＃quot; ＆＃34; ＼"],
  ])("라벨 %s의 문법 문자와 줄바꿈을 안전하게 치환한다", (name, safeName) => {
    const catalog = createCatalog();
    catalog.components[0].name = { en: name, ko: name };
    const result = buildMermaid({
      items: [{ componentId: "web-app", quantity: 1 }],
      connections: [],
    }, catalog).ko;
    expect(result).toBe(`flowchart LR\n  n0["${safeName}"]`);
    expect(result).not.toMatch(/[<>`]/);
    expect(result).not.toMatch(/^\s*(?:style|classDef|click)\b/m);
    expect(result.split("\n")).toHaveLength(2);
  });

  it("모델이 쓴 제목·장점과 수량은 다이어그램에 포함하지 않는다", () => {
    const plan: ModelPlan = {
      ...createPlan(),
      tier: "low",
      referenceArchitectureId: "model-architecture",
      title: { en: "Model title https://example.com", ko: "모델 제목 https://example.com" },
      pros: [{ en: "Model pro", ko: "모델 장점" }, { en: '<a href="https://example.com">Link</a>', ko: '<a href="https://example.com">링크</a>' }],
    };
    expect(buildMermaid(plan, createCatalog()).ko).toBe(buildMermaid(createPlan(), createCatalog()).ko);
  });

  it("입력과 카탈로그를 변경하지 않고 반복 호출에 같은 문자열을 반환한다", () => {
    const plan = createPlan();
    plan.connections.push({ ...plan.connections[0] });
    const catalog = createCatalog();
    const original = structuredClone({ plan, catalog });
    const result = buildMermaid(plan, catalog).ko;
    expect(buildMermaid(plan, catalog).ko).toBe(result);
    expect({ plan, catalog }).toEqual(original);
  });

  it("연결이 없어도 카탈로그에 없는 구성요소는 오류를 던진다", () => {
    expect(() => buildMermaid({
      items: [{ componentId: "missing", quantity: 1 }],
      connections: [],
    }, createCatalog()).ko).toThrow(/missing.*카탈로그/);
  });

  it.each([
    { from: "storage", to: "web-app" },
    { from: "web-app", to: "storage" },
    { from: "missing", to: "web-app" },
    { from: "web-app", to: "missing" },
  ])("items에 없는 끝점을 참조하는 연결 $from → $to는 오류를 던진다", (connection) => {
    expect(() => buildMermaid({
      items: [{ componentId: "web-app", quantity: 1 }],
      connections: [connection],
    }, createCatalog()).ko).toThrow(/구성요소.*구성 목록/);
  });
});

describe("실제 카탈로그 다이어그램", () => {
  const catalog = loadCatalog();
  for (const architecture of catalog.architectures) {
    it.each(tierSchema.options)(`${architecture.id}의 %s 단계 전체를 안전하게 출력한다`, (tier) => {
      const plan = architecture.tiers[tier];
      const result = buildMermaid(plan, catalog).ko;
      expect(result).toMatch(/^flowchart LR\n/);
      expect(result).not.toContain("http");
      expect(result).not.toContain("<");
      expect(result).not.toMatch(/^\s*(?:style|classDef|click)\b/m);
      expect(result.match(/^  n\d+\[".*"\]$/gm)).toHaveLength(plan.items.length + 1);
      for (const { componentId } of plan.items) {
        const component = catalog.components.find(({ id }) => id === componentId)!;
        expect(result).toContain(`["${component.name.ko}"]`);
      }
    });
  }
});
