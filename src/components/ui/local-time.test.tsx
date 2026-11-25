import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { formatDate, formatDateTime } from "@/i18n/format";
import { I18nProvider } from "@/i18n/provider";
import { LocalTime, TextWithLocalTime } from "./local-time";

const value = "2026-11-08T01:01:00.000Z";
const wrap = (children: ReactNode, locale: "en" | "ko" = "en") => <I18nProvider locale={locale}>{children}</I18nProvider>;

afterEach(() => { vi.restoreAllMocks(); });

it("renders the date or date and time in the browser time zone inside <time>", () => {
  render(wrap(<><LocalTime value={value} format="datetime" /><LocalTime value={value} format="date" /></>));
  const [datetime, date] = document.querySelectorAll("time");
  expect(datetime).toHaveAttribute("dateTime", value);
  expect(datetime).toHaveTextContent(formatDateTime(value, "en"));
  expect(date).toHaveTextContent(formatDate(value, "en"));
});

// The server (Node tz data) and the browser (macOS) can disagree on the offset, so the server leaves it empty.
it("leaves the server HTML empty and fills it after hydration without a mismatch", async () => {
  const html = renderToString(wrap(<p><LocalTime value={value} format="datetime" /></p>));
  expect(html).toContain(`<time dateTime="${value}"></time>`);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  await act(async () => { hydrateRoot(container, wrap(<p><LocalTime value={value} format="datetime" /></p>)); });
  expect(container.querySelector("time")).toHaveTextContent(formatDateTime(value, "en"));
  expect(errors).not.toHaveBeenCalled();
  container.remove();
});

it("puts the time into the {date} slot of a translated sentence", () => {
  render(wrap(<p data-testid="line"><TextWithLocalTime text="Collected {date} · File" value={value} format="datetime" /></p>));
  expect(screen.getByTestId("line")).toHaveTextContent(`Collected ${formatDateTime(value, "en")} · File`);
  render(wrap(<p data-testid="plain"><TextWithLocalTime text="No slot here" value={value} format="date" /></p>));
  expect(screen.getByTestId("plain")).toHaveTextContent("No slot here");
});

// Instants (scan, analysis, workspace times, certificate expiry) go through LocalTime. The price snapshot date is a
// calendar date parsed as local midnight, so it is the same on the server and in the browser.
it("formats instants only through LocalTime", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) && !/\.(test|test-data)\./.test(path) ? [path] : [];
  });
  const allowed = new Set(["src/i18n/format.ts", "src/components/ui/local-time.tsx"]);
  const offenders = files("src").filter(file => !allowed.has(file)).flatMap(file =>
    readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
      /\bformatDate(Time)?\(/.test(line) && !/formatDate\(priceAsOf \+ "T00:00:00"/.test(line) ? [`${file}:${index + 1}`] : []));
  expect(offenders).toEqual([]);
});
