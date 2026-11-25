import { describe, expect, it } from "vitest";
import { scanBicep } from "@/lib/artifacts/bicep-source";
import bicepFixture from "@/lib/artifacts/fixtures/sample-bicep-output.json";

describe("scanBicep", () => {
  it("leaves comment-free code unchanged", () => {
    expect(scanBicep(bicepFixture.code)).toMatchObject({ code: bicepFixture.code, unterminated: false });
  });

  it("replaces each comment with one space, keeping the line break after a line comment", () => {
    const source = "param a string // 설명\n/* 여러\n줄 */ param b string\nvar c = 1 /* x */ + 2";
    expect(scanBicep(source).code).toBe("param a string  \n  param b string\nvar c = 1   + 2");
  });

  it("keeps comment markers inside single-quoted strings, including escaped quotes and backslashes", () => {
    const source = "var a = 'a//b' // c\nvar b = '/* x' /* y */\nvar c = 'it\\'s // fine\\\\' // d";
    expect(scanBicep(source).code).toBe("var a = 'a//b'  \nvar b = '/* x'  \nvar c = 'it\\'s // fine\\\\'  ");
  });

  it("reads interpolation as code, so nested strings and braces do not end the outer string", () => {
    const source = "var a = '${concat('x//y', '}')}-${ {k: 1}.k }' // c";
    expect(scanBicep(source)).toMatchObject({ code: "var a = '${concat('x//y', '}')}-${ {k: 1}.k }'  ", unterminated: false });
  });

  it("strips comments inside interpolation and keeps escaped interpolation as text", () => {
    expect(scanBicep("var a = '${b /* c */}'").code).toBe("var a = '${b  }'");
    expect(scanBicep("var a = '\\${x // y}' // z").code).toBe("var a = '\\${x // y}'  ");
  });

  it("reads multi-line strings verbatim, without escapes or interpolation", () => {
    const source = "var a = '''\n// not a comment\n/* nor this\n${x} \\'''\nvar b = 1 // c";
    expect(scanBicep(source)).toMatchObject({ code: "var a = '''\n// not a comment\n/* nor this\n${x} \\'''\nvar b = 1  ", unterminated: false });
  });

  it("lets a multi-line string end with extra quotes", () => {
    expect(scanBicep("var a = ''''a'''' // c")).toMatchObject({ code: "var a = ''''a''''  ", mask: "var a = '''   '''  " });
  });

  it("masks string contents with spaces but keeps quotes, code and line breaks at the same offsets", () => {
    const source = "resource a 'T@1' = {\n  tags: { x: 'resource b ${'c'}' }\n  note: '''\nresource d\n'''\n}";
    const { code, mask } = scanBicep(source);
    expect(code).toBe(source);
    expect(mask).toBe(`resource a '${" ".repeat(3)}' = {\n  tags: { x: '${" ".repeat(17)}' }\n  note: '''\n${" ".repeat(10)}\n'''\n}`);
  });

  it.each([
    ["single-quoted string", "var a = 'abc"],
    ["string broken by a line break", "var a = 'abc\nvar b = 1"],
    ["block comment", "var a = 1 /* abc"],
    ["multi-line string", "var a = '''abc"],
    ["interpolation", "var a = '${abc'"],
  ])("reports an unterminated %s", (_name, source) => {
    expect(scanBicep(source).unterminated).toBe(true);
  });
});
