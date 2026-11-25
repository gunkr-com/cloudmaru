"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { SCAN_STALE_AFTER_SECONDS } from "@/lib/scans/timing";

const focusKey = (id: string) => `cs-scan-focus:${id}`;

export function ScanStatusPoller({ id, createdAt }: { id: string; createdAt: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [stalled, setStalled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let stopped = false;
    let inFlight = false;
    let errors = 0;
    let fallbackTimer: number | undefined;
    const stop = () => { stopped = true; window.clearInterval(timer); };
    const refresh = () => {
      try { sessionStorage.setItem(focusKey(id), "1"); } catch { /* 저장소가 없어도 화면은 갱신한다. */ }
      router.refresh();
    };
    const recordError = () => {
      if (++errors >= 5) { stop(); setStalled(true); }
    };
    const check = async () => {
      if (!active || stopped) return;
      // 응답이 돌아오지 않는 중에도 제한 시간은 확인한다.
      if (Date.now() - Date.parse(createdAt) > SCAN_STALE_AFTER_SECONDS * 1000) {
        stop();
        refresh();
        fallbackTimer = window.setTimeout(() => { if (active) setStalled(true); }, 4000);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/scans/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!active || stopped) return;
        if (response.status === 404) { stop(); router.refresh(); return; }
        if (!response.ok) { recordError(); return; }
        const body: unknown = await response.json();
        if (!active || stopped) return;
        if (typeof body !== "object" || body === null || !("status" in body)) { recordError(); return; }
        if (body.status === "pending") { errors = 0; return; }
        if (body.status !== "succeeded" && body.status !== "failed") { recordError(); return; }
        stop();
        refresh();
      } catch {
        if (active && !stopped) recordError();
      } finally { inFlight = false; }
    };
    const timer = window.setInterval(() => { void check(); }, 4000);
    return () => { active = false; window.clearInterval(timer); window.clearTimeout(fallbackTimer); };
  }, [id, createdAt, router, attempt]);

  if (!stalled) return null;
  return <div className="space-y-4">
    <p role="alert" className="text-sm leading-[1.7] text-warning">{t("inventory.pending.stalled")}</p>
    <Button type="button" onClick={() => { setStalled(false); setAttempt(value => value + 1); router.refresh(); }}>{t("common.retry")}</Button>
  </div>;
}

// 인벤토리 본문은 받지 않고, 서버가 그린 제목으로 포커스만 옮긴다.
export function ScanCompletionFocus({ id }: { id: string }) {
  useEffect(() => {
    let timer: number | undefined;
    try {
      const key = focusKey(id);
      if (sessionStorage.getItem(key) !== null) {
        // StrictMode의 effect 정리 후에도 표시가 남도록 실제 실행 때 지운다.
        timer = window.setTimeout(() => {
          try { sessionStorage.removeItem(key); } catch { /* 저장소 접근 실패 */ }
          document.getElementById("scan-heading")?.focus();
        }, 0);
      }
    } catch { /* 저장소가 없으면 포커스를 유지한다. */ }
    return () => window.clearTimeout(timer);
  }, [id]);
  return null;
}
