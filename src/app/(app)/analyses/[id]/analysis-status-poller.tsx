"use client";
import { useI18n } from "@/i18n/provider";

import { useEffect, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { RESULT_FOCUS_FLAG_PREFIX } from "@/lib/dashboard/result-links";
import { isJobStale } from "@/lib/jobs/timing";

export type AnalysisStatusPollerProps = { id: string; createdAt: string; intervalMs?: number; maxConsecutiveErrors?: number };

export function AnalysisStatusPoller({ id, createdAt, intervalMs = 4000, maxConsecutiveErrors = 5 }: AnalysisStatusPollerProps): JSX.Element | null {
  const { t } = useI18n();
  const router = useRouter();
  const [stalled, setStalled] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let stopped = false;
    let inFlight = false;
    let consecutiveErrors = 0;
    let fallbackTimer: number | undefined;
    const stop = () => { stopped = true; window.clearInterval(timer); };
    const recordError = () => {
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) { stop(); setStalled(true); }
    };
    const check = async () => {
      if (!active || stopped || inFlight) return;
      if (isJobStale(createdAt, new Date())) {
        // 제한 시간이 지났으면 서버가 시간 초과 상태를 그린다. 기기 시계가 빨라 서버가 아직 분석 중을 그리면
        // 이 컴포넌트가 남아 있으므로, 멈춘 채 두지 않고 다시 시도 안내를 보인다.
        stop();
        router.refresh();
        fallbackTimer = window.setTimeout(() => { if (active) setStalled(true); }, intervalMs);
        return;
      }
      inFlight = true;
      try {
        const response = await fetch(`/api/analyses/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!active || stopped) return;
        if (response.status === 404) {
          stop();
          router.refresh();
          return;
        }
        if (!response.ok) { recordError(); return; }
        const body: unknown = await response.json();
        if (!active || stopped) return;
        if (typeof body !== "object" || body === null || !("status" in body)) { recordError(); return; }
        const status = (body as { status?: unknown }).status;
        if (status === "pending") { consecutiveErrors = 0; return; }
        stop();
        // 결과 화면만 표시를 읽어 제목에 포커스를 둔다. 실패 화면에 남기면 지울 곳이 없다.
        if (status === "succeeded") {
          try { window.sessionStorage.setItem(`${RESULT_FOCUS_FLAG_PREFIX}${id}`, "1"); } catch { /* storage may be unavailable */ }
        }
        router.refresh();
      } catch {
        // 일시적인 네트워크 오류는 다음 주기에 다시 확인한다. 연달아 실패하면 멈추고 안내한다.
        if (active && !stopped) recordError();
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => { void check(); }, intervalMs);
    return () => { active = false; window.clearInterval(timer); window.clearTimeout(fallbackTimer); };
  }, [id, createdAt, intervalMs, maxConsecutiveErrors, router, attempt]);

  if (!stalled) return null;
  return (
    <div className="space-y-4">
      <p role="alert" className="text-sm leading-[1.7] text-warning">{t("analysis.stalled")}</p>
      <button
        type="button"
        onClick={() => { setStalled(false); setAttempt((count) => count + 1); router.refresh(); }}
        className="inline-flex min-h-10 items-center rounded-lg bg-ink px-[18px] text-sm font-semibold text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
