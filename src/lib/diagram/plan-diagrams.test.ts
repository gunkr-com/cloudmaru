import { describe, expect, it } from "vitest";
import { loadCatalog } from "@/lib/catalog/load";
import { USER_NODE_ID, tierSchema } from "@/lib/catalog/schema";
import { buildMermaid } from "@/lib/diagram/build-mermaid";
import { buildPlanDiagrams, getPlanConnections, type DiagramPlan } from "@/lib/diagram/plan-diagrams";
import type { Catalog } from "@/types/catalog";

function service(componentId: string, name: string) {
  return { componentId, name: { en: name, ko: name }, quantity: 1, unitLabel: { en: "개", ko: "개" } };
}

// 연결된 웹 앱·DB·파일 저장소와, 어디에도 연결되지 않은 과금 항목 넷.
function createPlan(): DiagramPlan {
  return {
    services: [
      service("web-app", "웹 앱"),
      service("database", "관계형 DB"),
      service("db-storage", "DB 스토리지"),
      service("storage", "파일 저장소"),
      service("egress", "데이터 송신"),
      service("logs", "로그 수집"),
      service("secrets", "키 작업"),
    ],
    connections: [
      { from: USER_NODE_ID, to: "web-app" },
      { from: "web-app", to: "database" },
      { from: "web-app", to: "storage" },
    ],
    mermaid: { en: "", ko: "" },
  };
}

const PREVIEW = [
  "flowchart TB",
  '  n0["웹 앱"]',
  '  n1["관계형 DB"]',
  '  n3["파일 저장소"]',
  '  n7["사용자"]',
  "  n7 --> n0",
  "  n0 --> n1",
  "  n0 --> n3",
].join("\n");

function createCatalog(plan: DiagramPlan): Catalog {
  return {
    components: plan.services.map(({ componentId, name }) => ({
      id: componentId,
      name,
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

function legacyOf(plan: DiagramPlan): DiagramPlan {
  const items = plan.services.map(({ componentId, quantity }) => ({ componentId, quantity }));
  return { ...plan, connections: undefined, mermaid: buildMermaid({ items, connections: plan.connections! }, createCatalog(plan)) };
}

describe("buildPlanDiagrams", () => {
  it("카드용 그림에는 연결에 참여하는 구성요소와 사용자만 위에서 아래로 그린다", () => {
    expect(buildPlanDiagrams(createPlan(), "ko").preview).toBe(PREVIEW);
  });

  it("큰 그림은 같은 흐름 아래에 연결 없는 항목을 '부가·과금 항목' 묶음으로 줄 맞춰 붙인다", () => {
    expect(buildPlanDiagrams(createPlan(), "ko").full).toBe([
      PREVIEW.split("\n").slice(0, 5).join("\n"),
      '  subgraph extra["부가·과금 항목"]',
      '    n2["DB 스토리지"]',
      '    n4["데이터 송신"]',
      '    n5["로그 수집"]',
      '    n6["키 작업"]',
      // 같은 칸의 위아래 항목을 보이지 않게 이어 2×2로 놓는다.
      "    n2 ~~~ n5",
      "    n4 ~~~ n6",
      "  end",
      PREVIEW.split("\n").slice(5).join("\n"),
      // 흐름의 끝 노드에 보이지 않는 연결을 걸어 묶음을 흐름 아래에 둔다.
      "  n1 ~~~ extra",
      "  n3 ~~~ extra",
    ].join("\n"));
  });

  it.each([
    [1, 1], [3, 3], [4, 2], [5, 3], [6, 3], [7, 3], [10, 3],
  ])("연결 없는 항목 %i개는 한 줄에 %i개씩, 줄 수를 최소로 고르게 나눈다", (count, columns) => {
    const plan = createPlan();
    plan.services = [
      ...plan.services.slice(0, 2),
      ...Array.from({ length: count }, (_, index) => service(`extra-${index}`, `과금 항목 ${index}`)),
    ];
    plan.connections = plan.connections!.slice(0, 2);
    const links = buildPlanDiagrams(plan, "ko").full.split("\n").filter((line) => /^    n\d+ ~~~ n\d+$/.test(line));
    const extraNodes = Array.from({ length: count }, (_, index) => `n${index + 2}`);
    expect(links).toEqual(extraNodes.slice(columns).map((nodeId, index) => `    ${extraNodes[index]} ~~~ ${nodeId}`));
  });

  it("사용자 연결이 없으면 사용자 노드를 그리지 않는다", () => {
    const plan = createPlan();
    plan.connections = plan.connections!.filter(({ from }) => from !== USER_NODE_ID);
    const { preview } = buildPlanDiagrams(plan, "ko");
    expect(preview).not.toContain("사용자");
    expect(preview).toBe('flowchart TB\n  n0["웹 앱"]\n  n1["관계형 DB"]\n  n3["파일 저장소"]\n  n0 --> n1\n  n0 --> n3');
  });

  it("모든 항목이 연결되어 있으면 큰 그림은 카드용 그림과 같다", () => {
    const plan = createPlan();
    plan.services = plan.services.slice(0, 2);
    plan.connections = plan.connections!.slice(0, 2);
    const { preview, full } = buildPlanDiagrams(plan, "ko");
    expect(full).toBe(preview);
    expect(full).not.toContain("subgraph");
  });

  it.each([
    ["연결 목록이 비어 있으면", (plan: DiagramPlan) => ({ ...plan, connections: [] })],
    ["이전 결과에 화살표가 없으면", (plan: DiagramPlan) => ({ ...plan, connections: undefined, mermaid: { en: 'flowchart LR\n  n0["웹 앱"]', ko: 'flowchart LR\n  n0["웹 앱"]' } })],
    ["모든 연결이 목록에 없는 구성요소를 가리키면", (plan: DiagramPlan) => ({ ...plan, connections: [{ from: "missing", to: "web-app" }] })],
  ])("%s 두 그림 모두 이전처럼 모든 항목을 왼쪽에서 오른쪽으로 쌓는다", (_, change) => {
    const plan = change(createPlan());
    const { preview, full } = buildPlanDiagrams(plan, "ko");
    expect(preview).toBe(buildMermaid({ items: plan.services, connections: [] }, createCatalog(plan)).ko);
    expect(full).toBe(preview);
  });

  it("연결 순서를 유지하고 같은 방향의 중복 연결은 한 번만 그린다", () => {
    const plan = createPlan();
    plan.connections = [
      { from: "web-app", to: "database" },
      { from: USER_NODE_ID, to: "web-app" },
      { from: "web-app", to: "database" },
      { from: "database", to: "web-app" },
    ];
    expect(buildPlanDiagrams(plan, "ko").preview.split("\n").filter((line) => line.includes("-->"))).toEqual([
      "  n0 --> n1",
      "  n7 --> n0",
      "  n1 --> n0",
    ]);
  });

  it("끝 노드가 없는 순환 흐름이면 연결된 모든 노드 아래에 묶음을 둔다", () => {
    const plan = createPlan();
    plan.connections = [{ from: "web-app", to: "database" }, { from: "database", to: "web-app" }];
    expect(buildPlanDiagrams(plan, "ko").full.split("\n").filter((line) => line.endsWith("~~~ extra"))).toEqual([
      "  n0 ~~~ extra",
      "  n1 ~~~ extra",
    ]);
  });

  it("목록에 없는 구성요소를 가리키는 연결은 오류 없이 건너뛴다", () => {
    const plan = createPlan();
    plan.connections = [...plan.connections!, { from: "web-app", to: "missing" }, { from: "missing", to: USER_NODE_ID }];
    expect(buildPlanDiagrams(plan, "ko")).toEqual(buildPlanDiagrams(createPlan(), "ko"));
  });

  it("연결 필드가 없는 이전 결과는 저장된 정의의 화살표로 같은 그림을 만든다", () => {
    const plan = createPlan();
    expect(buildPlanDiagrams(legacyOf(plan), "ko")).toEqual(buildPlanDiagrams(plan, "ko"));
  });

  it("저장된 정의의 라벨이나 모델이 쓴 글은 다이어그램에 넣지 않는다", () => {
    const plan = {
      ...createPlan(),
      title: "모델 제목 https://example.com",
      pros: ['<a href="https://example.com">링크</a>'],
      mermaid: { en: 'flowchart LR\n  n0["위조된 라벨"]\n  click n0 "https://example.com"', ko: 'flowchart LR\n  n0["위조된 라벨"]\n  click n0 "https://example.com"' },
    };
    const { preview, full } = buildPlanDiagrams(plan, "ko");
    for (const code of [preview, full]) {
      expect(code).not.toMatch(/위조|모델 제목|https|<a/);
    }
  });

  it.each([
    ['앱 "운영" <웹>', "앱 '운영' (웹)"],
    ['앱"]\nstyle n0 fill:red\nclick n0', "앱'] style n0 fill:red click n0"],
    ["&lt;b&gt; #quot; \\", "＆lt;b＆gt; ＃quot; ＼"],
  ])("서비스 이름 %s의 문법 문자와 줄바꿈을 안전하게 치환한다", (name, safeName) => {
    const plan = createPlan();
    plan.services[0].name = { en: name, ko: name };
    plan.services[2].name = { en: name, ko: name };
    const { preview, full } = buildPlanDiagrams(plan, "ko");
    expect(preview).toContain(`  n0["${safeName}"]`);
    expect(full).toContain(`    n2["${safeName}"]`);
    for (const code of [preview, full]) {
      expect(code.match(/\[".*"\]/g)!.join("")).not.toMatch(/[<>`]/);
      expect(code).not.toMatch(/^\s*(?:style|classDef|click)\b/m);
    }
  });

  it("입력을 변경하지 않고 반복 호출에 같은 결과를 반환한다", () => {
    const plan = createPlan();
    const original = structuredClone(plan);
    const result = buildPlanDiagrams(plan, "ko");
    expect(buildPlanDiagrams(plan, "ko")).toEqual(result);
    expect(plan).toEqual(original);
  });
});

describe("getPlanConnections", () => {
  it("연결 필드가 있으면 알려진 끝점의 연결만 순서대로 중복 없이 돌려준다", () => {
    const plan = createPlan();
    plan.connections = [...plan.connections!, plan.connections![0], { from: "web-app", to: "missing" }];
    expect(getPlanConnections(plan)).toEqual(createPlan().connections);
  });

  it("이전 결과는 저장된 정의의 노드 순번을 서비스 순서와 사용자로 되돌린다", () => {
    expect(getPlanConnections(legacyOf(createPlan()))).toEqual(createPlan().connections);
  });

  it("이전 결과의 범위를 벗어난 순번과 화살표가 아닌 줄은 무시한다", () => {
    const plan: DiagramPlan = { ...createPlan(), connections: undefined, mermaid: { en: "flowchart LR\n  n0 --> n9\n  n0 --> n1 --> n3\n  n7 --> n0\n  n0 -.-> n1", ko: "flowchart LR\n  n0 --> n9\n  n0 --> n1 --> n3\n  n7 --> n0\n  n0 -.-> n1" } };
    expect(getPlanConnections(plan)).toEqual([{ from: USER_NODE_ID, to: "web-app" }]);
  });
});

describe("실제 카탈로그 다이어그램", () => {
  const catalog = loadCatalog();
  const names = new Map(catalog.components.map(({ id, name }) => [id, name]));
  for (const architecture of catalog.architectures) {
    it.each(tierSchema.options)(`${architecture.id}의 %s 단계는 큰 그림에 모든 항목을, 카드에는 연결된 항목만 그린다`, (tier) => {
      const { items, connections } = architecture.tiers[tier];
      const plan: DiagramPlan = {
        services: items.map(({ componentId, quantity }) => ({ componentId, name: names.get(componentId)!, quantity, unitLabel: { en: "개", ko: "개" } })),
        connections,
        mermaid: { en: "", ko: "" },
      };
      const { preview, full } = buildPlanDiagrams(plan, "ko");
      const connected = new Set(connections.flatMap(({ from, to }) => [from, to]));
      const nodeLines = (code: string) => code.match(/^\s+n\d+\[".*"\]$/gm) ?? [];
      expect(nodeLines(full)).toHaveLength(items.length + (connected.has(USER_NODE_ID) ? 1 : 0));
      expect(nodeLines(preview)).toHaveLength(connected.size);
      for (const { componentId } of items) {
        expect(full).toContain(`["${names.get(componentId)!.ko}"]`);
        expect(preview.includes(`["${names.get(componentId)!.ko}"]`)).toBe(connected.has(componentId));
      }
      for (const code of [preview, full]) {
        expect(code).not.toContain("http");
        expect(code).not.toMatch(/^\s*(?:style|classDef|click)\b/m);
      }
    });
  }
});
