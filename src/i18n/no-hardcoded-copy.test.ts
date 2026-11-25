import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const hangul = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/;
const letters = /[a-zA-Z\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/;
const copyAttributes = new Set(["aria-label", "title", "placeholder", "alt"]);

// 예외가 필요하면 파일과 문자열을 함께 적고 각 항목의 이유를 남긴다.
const allowed: { file: string; text: string }[] = [
  // 예산 입력 앞의 CAD 통화 기호는 두 언어에서 동일하다.
  { file: "src/components/analysis/analysis-form.tsx", text: "CA$" },
];

function findCopy(file: string, source: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const failures: string[] = [];
  function visit(node: ts.Node) {
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    // 표시되는 값 경로만 거슬러 올라간다. 호출 인자·조건식·스타일 속성은 문구가 아니다.
    function isCopyValue(value: ts.Node): boolean {
      const parent = value.parent;
      if (!parent) return false;
      if (ts.isJsxExpression(parent)) {
        return ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent)
          || (ts.isJsxAttribute(parent.parent) && copyAttributes.has(parent.parent.name.getText(ast)));
      }
      if (ts.isJsxAttribute(parent)) return copyAttributes.has(parent.name.getText(ast));
      if (ts.isParenthesizedExpression(parent) || ts.isTemplateExpression(parent) || ts.isTemplateSpan(parent)) return isCopyValue(parent);
      if (ts.isConditionalExpression(parent) && parent.condition !== value) return isCopyValue(parent);
      if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(parent.operatorToken.kind)) return isCopyValue(parent);
      return false;
    }
    const attribute = literal && isCopyValue(node);
    const text = literal || ts.isJsxText(node) ? node.text : undefined;
    if (text !== undefined && (hangul.test(text) || ((ts.isJsxText(node) || attribute) && letters.test(text)))
      && !allowed.some((entry) => entry.file === file && entry.text === text)) {
      const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      failures.push(`${file}:${line + 1}: ${JSON.stringify(text.trim())}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return failures;
}

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

describe("화면 문구 AST 검사", () => {
  it.each([
    'const value = "한국어 문장";',
    'const value = `한국어 ${name} 끝`;',
    'const value = `prefix ${name} 한국어 ${name} tail`;',
    'const value = <p>한국어 문장</p>;',
    'const value = <p>English copy</p>;',
    ...["aria-label", "title", "placeholder", "alt"].map((name) => `const value = <input ${name}="English copy" />;`),
    'const value = <input title={"English copy"} />;',
    'const value = <p>{open ? "Show less" : "Show more"}</p>;',
    'const value = <input aria-label={`View ${name}`} />;',
    'const value = <input title={open ? "Close" : "Open"} />;',
    'const value = <p>{name ?? ("Fallback")}</p>;',
    'const value = <p>{name || "Fallback"}</p>;',
    'const value = <p>{`View ${name ? "One" : "Many"}`}</p>;',

  ])("하드코딩 문구를 찾는다: %s", (source) => {
    expect(findCopy("fixture.tsx", source).join("\n")).toContain("fixture.tsx:1:");
  });

  it("주석·기술 문자열·기호·번역 호출은 허용한다", () => {
    expect(findCopy("fixture.tsx", `// 한국어 주석
      /* English and 한국어 */
      const path = "https://example.com";
      const view = <p className="text-ink">{/* 한국어 */} · 123 / {t("common.retry")}{"open" === name ? t("x") : t("y")}<span className={a ? "p-2" : "p-4"}>{cn("x")}</span></p>;`)).toEqual([]);
  });

  it("컴포넌트와 모든 app 라우트에는 사전 밖 문구가 없다", () => {
    const files = ["src/components", "src/app"].flatMap(filesIn).filter((file) =>
      (file.startsWith("src/components/") ? /\.tsx$/ : /\.tsx?$/).test(file)
      && !/\.(test|test-data)\./.test(file));
    expect(files.length).toBeGreaterThan(0);
    const failures = files.flatMap((file) => findCopy(relative(process.cwd(), join(process.cwd(), file)), readFileSync(file, "utf8")));
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
