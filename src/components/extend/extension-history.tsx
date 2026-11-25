"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/ui/local-time";
import { useI18n } from "@/i18n/provider";
import { extensionFailureMessage } from "@/lib/extend-app/error-message";
import { JOB_STALE_AFTER_SECONDS } from "@/lib/jobs/timing";
import type { LocalizedText } from "@/types/i18n";

export type ExtensionHistoryItem = {
  workspaceId?: string; id: string; status: "pending" | "succeeded" | "failed"; sourceScanId: string; createdAt: string;
  description: string; title: LocalizedText | null; errorCode: string | null;
};
const link = "inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
export function ExtensionHistory({ items }: { items: ExtensionHistoryItem[] }) {
  const { t, locale } = useI18n();
  const { refresh } = useRouter();
  const [stopped, setStopped] = useState(false);
  const [failed, setFailed] = useState(false);
  const pendingKey = items.filter(item => item.status === "pending").map(item => item.id).join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const ids = pendingKey.split(",");
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const deadline = Date.now() + JOB_STALE_AFTER_SECONDS * 1000;
    let count = 0;
    async function poll() {
      if (!active) return;
      if (Date.now() >= deadline || count++ >= 110) { setStopped(true); return; }
      controller = new AbortController();
      const signal = controller.signal;
      timeout = setTimeout(() => { controller?.abort(); if (active) { setFailed(true); setStopped(true); } }, 10_000);
      try {
        const states = await Promise.all(ids.map(async id => {
          const response = await fetch(`/api/extensions/${encodeURIComponent(id)}`, { cache: "no-store", signal });
          if (!response.ok) throw Error();
          const body = await response.json();
          if (!["pending", "succeeded", "failed"].includes(body.status) || typeof body.workspaceMismatch !== "boolean") throw Error();
          return { pending: body.status === "pending", mismatch: body.workspaceMismatch };
        }));
        if (!active || signal.aborted) return;
        if (states.some(state => !state.pending || state.mismatch)) refresh();
        if (states.every(state => !state.pending) || states.some(state => state.mismatch)) return;
        timer = setTimeout(poll, 3000);
      } catch {
        if (active) { setFailed(true); setStopped(true); }
      } finally { clearTimeout(timeout); }
    }
    timer = setTimeout(poll, 3000);
    return () => { active = false; clearTimeout(timer); clearTimeout(timeout); controller?.abort(); };
  }, [pendingKey, refresh]);
  return <div className="min-w-0 space-y-5">
    {!items.length && <p>{t("extension.ui.empty")}</p>}
    {failed && <p role="alert" className="text-warning">{t("extension.ui.loadError")}</p>}
    {stopped && <p>{t("extension.ui.pollStopped")}</p>}
    <ul className="space-y-4">{items.map(item => <li key={item.id} className="min-w-0 space-y-3 rounded-xl border border-hairline bg-surface-1 p-5">
      <Link href={`/extensions/${item.id}`} className={`block min-w-0 space-y-2 ${link}`}>
        <p className="break-words font-semibold text-ink">{item.title?.[locale] ?? t("extension.ui.open")}</p>
        <LocalTime value={item.createdAt} format="datetime" />
        <p>{t(item.status === "pending" ? "extension.status.pending" : item.status === "succeeded" ? "extension.status.succeeded" : "extension.status.failed")}</p>
        <p className="break-all text-sm text-muted">{t("extension.sourceScan", { id: item.sourceScanId })}</p>
      </Link>
      {item.status === "pending" && <p role="status" className="text-sm text-muted">{t("extension.ui.pendingHelp")}</p>}
      {item.status === "failed" && <div className="space-y-2"><p role="alert" className="text-sm text-warning">{t(extensionFailureMessage(item.errorCode).key)}</p>
        {extensionFailureMessage(item.errorCode).keyUnavailable && item.workspaceId && <Link className={link} href={`/workspaces/${encodeURIComponent(item.workspaceId)}/claude`}>{t("workspace.claude.configure")}</Link>}
      </div>}
      <details><summary className="min-h-6 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("extension.ui.requirements")}</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">{item.description}</p></details>
      <Link href={`/extensions/new?from=${item.id}`} className={link}>{t("extension.ui.rerun")}</Link>
    </li>)}</ul>
  </div>;
}
