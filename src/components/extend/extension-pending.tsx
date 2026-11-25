"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { JOB_STALE_AFTER_SECONDS } from "@/lib/jobs/timing";

const focusKey = (id: string) => `cs-extension-focus:${id}`;
export function ExtensionPending({ id, createdAt }: { id: string; createdAt: string }) {
  const { t } = useI18n();
  const { refresh } = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let timeout: ReturnType<typeof setTimeout>;
    let fallback: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    let count = 0;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 1000)));
    update(); const clock = setInterval(update, 1000);
    function finish() {
      try { sessionStorage.setItem(focusKey(id), "1"); } catch { /* Focus is optional when storage is disabled. */ }
      refresh();
      fallback = setTimeout(() => { if (active) setStopped(true); }, 4000);
    }
    async function poll() {
      if (!active) return;
      if (Date.now() - Date.parse(createdAt) > JOB_STALE_AFTER_SECONDS * 1000) { finish(); return; }
      if (count++ >= 110) { setStopped(true); return; }
      controller = new AbortController(); const signal = controller.signal;
      timeout = setTimeout(() => { controller?.abort(); if (active) setStopped(true); }, 10_000);
      try {
        const response = await fetch(`/api/extensions/${encodeURIComponent(id)}`, { cache: "no-store", signal });
        if (!response.ok) throw Error();
        const body = await response.json();
        if (!active || signal.aborted) return;
        if (body.id !== id || !["pending", "succeeded", "failed"].includes(body.status)) throw Error();
        if (body.status !== "pending") { finish(); return; }
        timer = setTimeout(poll, 3000);
      } catch { if (active && !signal.aborted) setStopped(true); }
      finally { clearTimeout(timeout); }
    }
    timer = setTimeout(poll, 3000);
    return () => { active = false; clearInterval(clock); clearTimeout(timer); clearTimeout(timeout); clearTimeout(fallback); controller?.abort(); };
  }, [id, createdAt, refresh, attempt]);
  return <div className="space-y-4">
    <p role="status" className="font-semibold text-ink">{t(elapsed >= 120 ? "analysis.longRunning" : "extension.result.pending")}</p>
    <div role="progressbar" aria-label={t("extension.status.pending")} className="h-2 overflow-hidden rounded-full bg-progress-track motion-reduce:hidden"><div className="progress-indeterminate h-full w-1/3 bg-ink" /></div>
    <p className="text-sm tabular-nums text-subtle">{t("analysis.elapsed")}{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</p>
    <p>{t("extension.ui.pendingHelp")}</p>
    {stopped && <div className="space-y-3"><p role="alert" className="text-warning">{t("extension.ui.pollStopped")}</p><Button variant="secondary" onClick={() => { setStopped(false); setAttempt(value => value + 1); refresh(); }}>{t("common.retry")}</Button></div>}
  </div>;
}

export function ExtensionCompletionFocus({ id }: { id: string }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    try {
      if (sessionStorage.getItem(focusKey(id)) !== null) timer = setTimeout(() => {
        try { sessionStorage.removeItem(focusKey(id)); } catch { /* Storage may be disabled. */ }
        document.getElementById("extension-heading")?.focus();
      }, 0);
    } catch { /* Keep the existing focus if storage is disabled. */ }
    return () => clearTimeout(timer);
  }, [id]);
  return null;
}
