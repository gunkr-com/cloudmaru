import { expect, it } from "vitest";
import { reportHref } from "./links";
import { parseSelection } from "./selection";

const id = "00000000-0000-4000-8000-000000000001";
it.each([["build", "analyses"], ["extend", "extensions"]] as const)("%s report links carry only the saved record, UI language and selected tier", (kind, segment) => {
  const href = reportHref(kind, id, { locale: "ko", tier: "ha" });
  expect(href).toBe(`/${segment}/${id}/report?lang=ko&tier=ha`);
  const query = Object.fromEntries(new URL(href, "http://127.0.0.1").searchParams);
  // The link is accepted by the report scope parser and does not name a workspace: the route reads the saved owner.
  expect(parseSelection(query, "en", kind)).toMatchObject({ locale: "ko", tier: "ha", scope: "full" });
  expect(href).not.toMatch(/workspace|owner/i);
});
it("encodes the record ID path segment", () => {
  expect(reportHref("build", "a/b?c", { locale: "en", tier: "low" })).toBe("/analyses/a%2Fb%3Fc/report?lang=en&tier=low");
});
