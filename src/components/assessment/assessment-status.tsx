"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import Link from "next/link";

// pending 페이지에서만 마운트한다. 본문 payload를 렌더링하지 않고 서버 조회를 갱신한다.
export function AssessmentStatus({ id, startedAt, expiresAt }: { id: string; startedAt: number; expiresAt: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true, stopped = false, inFlight = false, failures = 0;
    let controller: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { stopped = true; clearInterval(timer); clearTimeout(timeout); controller?.abort(); };
    const fail = () => { stop(); if (active) setError(true); };
    async function check() {
      if (!active || stopped) return;
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      if (Date.now() >= expiresAt) { fail(); router.refresh(); return; }
      if (inFlight) return;
      inFlight = true; controller = new AbortController();
      timeout = setTimeout(() => controller?.abort(), 10000);
      try {
        const response = await fetch(`/api/assessments/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
        if (!active || stopped) return;
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (!active || stopped) return;
        if (body.id !== id || !["pending", "succeeded", "failed"].includes(body.status)) throw new Error();
        if (body.workspaceMismatch === true) setMismatch(true);
        failures = 0;
        if (body.status !== "pending") {
          stop();
          try { sessionStorage.setItem(`cs-assessment-focus:${id}`, "1"); } catch { /* 포커스 저장 실패 */ }
          router.refresh();
        }
      } catch { if (active && !stopped && ++failures >= 3) fail(); }
      finally { clearTimeout(timeout); inFlight = false; }
    }
    const timer = setInterval(() => { void check(); }, 4000);
    return () => { active = false; stop(); };
  }, [id, startedAt, expiresAt, router, attempt]);
  return <div className="space-y-4">
    {!error && <p role="status">{t("assessment.ui.pending")}</p>}
    <p className="text-sm text-muted">{t("assessment.ui.elapsed", { seconds: elapsed })}</p>
    {mismatch && <p role="alert">{t("assessment.ui.mismatch")} <Link className="underline" href="/assessments/new">{t("assessment.ui.safeNew")}</Link></p>}
    {error && <div><p role="alert" className="text-warning">{t("assessment.ui.pollError")}</p><Button variant="secondary" onClick={() => { setError(false); setAttempt(value => value + 1); router.refresh(); }}>{t("assessment.ui.reload")}</Button></div>}
  </div>;
}

export function AssessmentCompletionFocus({ id }: { id: string }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const key = `cs-assessment-focus:${id}`;
      if (sessionStorage.getItem(key)) timer = setTimeout(() => {
        try { sessionStorage.removeItem(key); } catch { /* 저장소 접근 실패 */ }
        document.getElementById("assessment-heading")?.focus();
      }, 0);
    } catch { /* 저장소가 없으면 포커스를 유지한다. */ }
    return () => clearTimeout(timer);
  }, [id]);
  return null;
}
