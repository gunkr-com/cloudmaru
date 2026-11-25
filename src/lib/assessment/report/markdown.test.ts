import { expect, it } from "vitest";
import type { AssessmentReport } from "./document";
import { reportMarkdown, parseReportQuery } from "./markdown";
it("fences arbitrary backticks/HTML/remote images/links/line breaks without executable Markdown", () => {
  const attack = '<script>alert(1)</script>\n![image](https://evil.test/x)\n[go](javascript:alert(1)) | ` ``` ```` `\n# Forged';
  const doc: AssessmentReport = {id:"00000000-0000-4000-8000-000000000001",locale:"en",title:"Assessment report",sections:[{
    id:"one",title:"Evidence",level:2,blocks:[{kind:"code",text:attack},{kind:"text",text:attack},
      {kind:"source",label:"Source",href:"https://learn.microsoft.com/en-us/azure/templates/microsoft.web/sites"}]
  }]};
  const md = reportMarkdown(doc);
  expect(md).toContain("`````text\n"+attack+"\n`````");
  // Free prose never contains active URL syntax, raw HTML or a new Markdown heading.
  const prose = md.slice(md.indexOf("\n`````\n")+8);
  expect(prose).not.toContain("<script>"); expect(prose).not.toContain("![image]");
  expect(prose).not.toContain("https://evil"); expect(prose).toContain("&#10;");
  expect(prose.match(/\]\(https:\/\//g)).toHaveLength(1);
});
it("validates exact format/lang names, duplicate params and unknown params", () => {
  expect(parseReportQuery(new URLSearchParams(),"en")).toEqual({format:"markdown",locale:"en"});
  expect(parseReportQuery(new URLSearchParams("format=markdown&lang=ko"),"en")).toEqual({format:"markdown",locale:"ko"});
  for (const query of ["format=pdf","lang=xx","lang=en&lang=ko","x=1","format=markdown&format=markdown","lang=","format="]) {
    expect(()=>parseReportQuery(new URLSearchParams(query),"en")).toThrow("invalid-query");
  }
});
it("handles many separated backtick runs without variadic stack limits",()=>{
  const text="`x".repeat(150000)+"\n````end";
  const doc:AssessmentReport={id:"00000000-0000-4000-8000-000000000001",locale:"en",title:"Report",sections:[{id:"e",title:"Evidence",level:2,blocks:[{kind:"code",text}]}]};
  expect(()=>reportMarkdown(doc)).not.toThrow();expect(reportMarkdown(doc).includes("`````text\n")).toBe(true);
});
