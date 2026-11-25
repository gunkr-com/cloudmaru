import type { ScanRecord } from "@/types/scan";

export const SCAN_TIMEOUT_MS = 10 * 60_000;
export const SCAN_STALE_AFTER_SECONDS = 15 * 60;

export function getScanStaleBefore(now: Date): Date {
  return new Date(now.getTime() - SCAN_STALE_AFTER_SECONDS * 1000);
}

export function resolveScanStatus<T extends Pick<ScanRecord, "status" | "createdAt" | "errorCode">>(record: T, now: Date): T {
  const created = new Date(record.createdAt).getTime();
  if (record.status === "pending" && (Number.isNaN(created) || created < getScanStaleBefore(now).getTime())) {
    return { ...record, status: "failed", errorCode: "interrupted" };
  }
  return record;
}
