import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import type { ScanRecord } from "@/types/scan";
import { formatDateTime } from "@/i18n/format";
import { summarizeInventory } from "@/lib/inventory/summarize";
import { ScanHistory } from "./scan-history";

it.each(["en", "ko"] as const)("renders empty and failed/completed/pending history in %s", locale => {
  const { rerender } = render(<I18nProvider locale={locale}><ScanHistory scans={[]} /></I18nProvider>);
  expect(screen.getByText(locale === "en" ? "No scans yet." : "아직 스캔이 없습니다.")).toBeInTheDocument();
  const row: ScanRecord = { id: "failed", workspaceId: "fake", source: "live", status: "failed", subscriptionIds: [], summary: null, collectedAt: null, errorCode: "forbidden", createdAt: "2026-01-01T00:00:00Z", completedAt: null };
  const scans: ScanRecord[] = [row, { ...row, id: "success", status: "succeeded", source: "import", errorCode: null, summary: { ...summarizeInventory([], []), resourceCount: 1234 } }, { ...row, id: "pending", status: "pending", errorCode: null }];
  rerender(<I18nProvider locale={locale}><ScanHistory scans={scans} /></I18nProvider>);
  expect(screen.getByText(locale === "en" ? /Assign the Reader role/ : /Reader 역할을 할당/)).toBeInTheDocument();
  expect(screen.getByText("1,234")).toBeInTheDocument();
  expect(screen.getAllByText("—")).toHaveLength(2);
  expect(screen.getByText(locale === "en" ? "File" : "파일")).toBeInTheDocument();
  expect(screen.getByText(locale === "en" ? "Scanning" : "스캔 중")).toBeInTheDocument();
  expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(scans.map(scan => "/inventory/scans/" + scan.id));
  expect(screen.getAllByText(formatDateTime(row.createdAt, locale))).toHaveLength(3);
});
