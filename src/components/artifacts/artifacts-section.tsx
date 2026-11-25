"use client";

import { useEffect, useId, useMemo, useState, type JSX } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BicepView } from "@/components/artifacts/bicep-view";
import { EvaluationView } from "@/components/artifacts/evaluation-view";
import { GuideView } from "@/components/artifacts/guide-view";
import { artifactsApi, type ArtifactsApi } from "@/components/artifacts/artifacts-api";
import { ARTIFACT_KINDS, ARTIFACT_LABELS, BICEP_DRAFT_NOTICE } from "@/lib/artifacts/labels";
import { buildArtifactDownloadHref } from "@/lib/artifacts/links";
import type { ArtifactView } from "@/lib/artifacts/artifact-job";
import { useI18n } from "@/i18n/provider";
import { isMessageKey } from "@/i18n/translate";
import type { ArtifactKind } from "@/types/artifact";
import type { PlanResult } from "@/types/analysis";
import type { Tier } from "@/types/catalog";

export type ArtifactsSectionProps = {
  analysisId?: string;
  plan: PlanResult;
  initialArtifacts: ArtifactView[];
  api?: ArtifactsApi;
  pollIntervalMs?: number;
};

const descriptions = ARTIFACT_LABELS;
const keyFor = (tier: Tier, kind: ArtifactKind) => `${tier}:${kind}`;
function elapsed(createdAt: string, now: number): string {
  const seconds = Math.floor(Math.max(0, now - Date.parse(createdAt)) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ArtifactsSection({ analysisId, plan, initialArtifacts, api = artifactsApi, pollIntervalMs = 4000 }: ArtifactsSectionProps): JSX.Element {
  const { t } = useI18n();
  const [errorKeys, setErrorKeys] = useState<Record<string, string>>({});
  const [errorWorkspaceIds, setErrorWorkspaceIds] = useState<Record<string, string>>({});
  const headingId = useId();
  const router = useRouter();
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [failures, setFailures] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState<ArtifactKind[]>([]);
  const [elapsedNow, setElapsedNow] = useState(0);
  const hasPending = artifacts.some(({ status }) => status === "pending");
  const hasPendingKey = useMemo(() => artifacts.filter(({ status }) => status === "pending").map(({ tier, kind }) => keyFor(tier, kind)).join("|"), [artifacts]);

  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => setElapsedNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasPending]);

  // Keyed on the pending set: the timer stops once every job settles, and each poll
  // compares against the keys that were pending when it started.
  useEffect(() => {
    if (!analysisId || !hasPendingKey) return;
    const wasPending = new Set(hasPendingKey.split("|"));
    let active = true;
    const timer = window.setInterval(() => {
      void api.list(analysisId).then((result) => {
        if (!active) return;
        if (!result.ok) {
          return;
        }
        const next = result.artifacts;
        const settled = new Set(next.filter(({ status }) => status === "pending" || status === "succeeded").map(({ tier, kind }) => keyFor(tier, kind)));
        const succeeded = next.filter(({ tier, kind, status }) => status === "succeeded" && wasPending.has(keyFor(tier, kind)));
        // 끝난 결과물의 사용량이 저장됐으니 사이드바의 이번 달 API 비용을 다시 읽는다.
        if (next.some(({ tier, kind, status }) => status !== "pending" && wasPending.has(keyFor(tier, kind)))) router.refresh();
        setArtifacts(next);
        setFailures((current) => new Set([...current].filter((key) => !settled.has(key))));
        if (succeeded.length > 0) setAnnouncement(succeeded.map(({ kind }) => kind));
      }).catch(() => undefined);
    }, pollIntervalMs);
    return () => { active = false; window.clearInterval(timer); };
  }, [analysisId, api, hasPendingKey, pollIntervalMs, router]);

  const visibleArtifacts = artifacts.filter(({ tier }) => tier === plan.tier);
  const findArtifact = (kind: ArtifactKind) => visibleArtifacts.find((artifact) => artifact.kind === kind);
  const setEntry = (entry: ArtifactView) => {
    setArtifacts((current) => [...current.filter(({ tier, kind }) => tier !== entry.tier || kind !== entry.kind), entry]);
    setFailures((current) => { const next = new Set(current); next.delete(keyFor(entry.tier, entry.kind)); return next; });
  };
  const toggle = (key: string) => setExpanded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const request = async (kind: ArtifactKind) => {
    if (!analysisId) return;
    const key = keyFor(plan.tier, kind);
    setBusy((current) => new Set(current).add(key));
    setErrorKeys((current) => { const next = { ...current }; delete next[key]; return next; });
    setErrorWorkspaceIds((current) => { const next = { ...current }; delete next[key]; return next; });
    setFailures((current) => { const next = new Set(current); next.delete(key); return next; });
    try {
      const result = await api.request(analysisId, plan.tier, kind);
      if (result.ok) {
        setEntry(result.artifact);
        if (result.status === 200) setExpanded((current) => new Set(current).add(key));
      } else {
        setFailures((current) => new Set(current).add(key));
        const message = result.errors?.[0] ?? result.message;
        setErrorKeys((current) => ({ ...current, [key]: isMessageKey(message) ? message : "artifacts.generationFailed" }));
        if (result.workspaceId) setErrorWorkspaceIds((current) => ({ ...current, [key]: result.workspaceId! }));
      }
    } catch {
      setFailures((current) => new Set(current).add(key));
    } finally {
      setBusy((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  };

  const renderContent = (artifact: ArtifactView) => {
    if (!analysisId || !artifact.content) return null;
    const downloadHref = buildArtifactDownloadHref(analysisId, artifact.tier, artifact.kind);
    if (artifact.kind === "guide") return <GuideView content={artifact.content as Extract<NonNullable<ArtifactView["content"]>, { overview: string }>} services={plan.services} downloadHref={downloadHref} />;
    if (artifact.kind === "evaluation") return <EvaluationView content={artifact.content as Extract<NonNullable<ArtifactView["content"]>, { axes: unknown[] }>} downloadHref={downloadHref} />;
    return <BicepView content={artifact.content as Extract<NonNullable<ArtifactView["content"]>, { code: string }>} downloadHref={downloadHref} />;
  };

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-5 rounded-lg border border-hairline bg-surface-1 p-6 text-sm text-body sm:p-7">
      <div className="space-y-1.5">
        <p className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("artifacts.title")}</p>
        <h2 id={headingId} data-artifacts-heading tabIndex={-1} className="text-xl leading-[1.2] font-semibold tracking-[-0.3px] text-ink">{t("artifacts.heading", { option: t(`common.tiers.${plan.tier}`) })}</h2>
        <p className="text-[13px] leading-[1.6] text-subtle">{t("artifacts.help")}</p>
        <p role="status" className={announcement.length ? "text-[13px] text-body" : "sr-only"}>{announcement.map((kind) => t("artifacts.ready", { name: t(descriptions[kind].name) })).join(" ")}</p>
      </div>
      <ul>
        {ARTIFACT_KINDS.map((kind) => {
          const entry = findArtifact(kind);
          const key = keyFor(plan.tier, kind);
          const isBusy = busy.has(key);
          const isExpanded = expanded.has(key);
          const failed = entry?.status === "failed" || failures.has(key);
          return <li key={kind} className="border-t border-border-row py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-1 basis-40 space-y-0.5"><h3 className="font-medium text-ink">{t(descriptions[kind].name)}</h3><p className="text-[13px] leading-[1.5] text-subtle">{t(descriptions[kind].description)}</p></div>
            {isBusy ? <Button variant="secondary" disabled className="px-3.5 py-2 text-[13px]">{t("artifacts.generating")}</Button>
                : entry?.status === "succeeded" && entry.content ? <Button variant="secondary" className="px-3.5 py-2 text-[13px]" aria-expanded={isExpanded} onClick={() => toggle(key)}>{isExpanded ? t("artifacts.collapse") : t("artifacts.view")}</Button>
                : entry?.status === "pending" ? <div className="w-40 space-y-2"><p role="status" className="text-[13px] text-body">{t("artifacts.generating")}</p><div role="progressbar" aria-label={t("artifacts.progress", { name: t(descriptions[kind].name) })} className="h-2 overflow-hidden rounded-full bg-progress-track motion-reduce:hidden"><div className="progress-indeterminate h-full w-1/3 rounded-full bg-ink" /></div><p className="text-[13px] tabular-nums text-subtle"><span className="sr-only">{t("artifacts.elapsed")} </span>{elapsed(entry.createdAt, elapsedNow)}</p></div>
                : failed ? <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-[13px] text-warning">{t(isMessageKey(errorKeys[key]) ? errorKeys[key] : "artifacts.generationFailed")}</p>{errorKeys[key] === "workspace.claude.unavailable" && errorWorkspaceIds[key] && <Link href={`/workspaces/${encodeURIComponent(errorWorkspaceIds[key])}/claude`} className="text-[13px] text-ink underline underline-offset-4">{t("workspace.claude.configure")}</Link>}<Button variant="secondary" className="px-3.5 py-2 text-[13px]" onClick={() => void request(kind)}>{t("common.retry")}</Button></div>
                : analysisId ? <Button variant="secondary" className="px-3.5 py-2 text-[13px]" onClick={() => void request(kind)}>{t("artifacts.generate")}</Button>
                : <Button asChild variant="secondary" className="px-3.5 py-2 text-[13px]"><Link href="/analyses/new">{t("artifacts.generate")}</Link></Button>}
            </div>
            {entry?.status === "succeeded" && entry.content && isExpanded && <div className="mt-5 border-t border-border-row pt-5">{renderContent(entry)}</div>}
          </li>;
        })}
      </ul>
      <p className="text-[13px] leading-[1.6] text-warning">{t(BICEP_DRAFT_NOTICE)}</p>
    </section>
  );
}
