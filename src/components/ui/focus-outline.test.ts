import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.(test|test-data)\./.test(path) ? [path] : [];
  });
}

// Tailwind v4: outline-none sets --tw-outline-style: none, and focus-visible:outline-2 reads that
// variable, so the focus ring ends up with outline-style: none (UX_GUIDE §7, BROWSER_TESTING A6).
it("does not pair outline-none with a focus-visible outline", () => {
  // A class list can be split across cn() arguments, so look at the lines around each outline-none.
  const offenders = sourceFiles("src").flatMap((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, index) => /(^|[\s"'`])outline-none([\s"'`]|$)/.test(line)
      && /focus-visible:outline-/.test(lines.slice(Math.max(0, index - 3), index + 4).join("\n"))
      ? [`${file}:${index + 1}`] : []);
  });
  expect(offenders).toEqual([]);
});

// UX_GUIDE §7: every focus ring is 2px with a 2px offset.
it("gives every focus-visible outline an offset", () => {
  const offenders = sourceFiles("src").flatMap((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, index) => /focus-visible:outline-2/.test(line)
      && !/focus-visible:outline-offset-/.test(lines.slice(Math.max(0, index - 3), index + 4).join("\n"))
      ? [`${file}:${index + 1}`] : []);
  });
  expect(offenders).toEqual([]);
});
