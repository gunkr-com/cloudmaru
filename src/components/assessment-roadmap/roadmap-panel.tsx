"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { roadmapErrorMessageKey } from "@/lib/assessment/roadmap/error-message";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import type { RoadmapStatusData } from "@/lib/assessment/roadmap/job";
import { JOB_STALE_AFTER_SECONDS } from "@/lib/jobs/timing";

// 전송과 본문 읽기를 함께 제한한다. abort를 무시하는 transport도 UI를 잠그지 못한다.
async function readJson<T>(url: string, controller: AbortController, init: RequestInit = {}): Promise<{ response: Response; body: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const deadline = new Promise<never>((_, reject) => {
    abort = () => reject(new Error());
    controller.signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => controller.abort(), 10000);
    if (controller.signal.aborted) abort();
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetch(url, { ...init, signal: controller.signal });
      return { response, body: await response.json() as T };
    })()]);
  } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); }
}

/** initial은 서버 roadmapJobs.get() 결과다. */
export function RoadmapPanel({ initial, disabled = false }: { initial: RoadmapStatusData; disabled?: boolean }) {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  // 상태/시도 갱신은 진행 중 요청을 취소하되 완료 포커스를 받은 제목은 보존한다.
  return <section aria-labelledby={`roadmap-${initial.id}`} className="min-w-0 space-y-4 rounded-xl border border-hairline bg-surface-1 p-6">
    <h2 ref={heading} tabIndex={-1} id={`roadmap-${initial.id}`} className="text-xl font-semibold text-ink">{t("assessmentRoadmap.title")}</h2>
    <RoadmapPanelState key={`${initial.id}:${initial.roadmap.status}:${initial.roadmap.attemptId}:${initial.workspaceMismatch}`} initial={initial} disabled={disabled} heading={heading} />
  </section>;
}
function RoadmapPanelState({ initial, disabled, heading }: { initial: RoadmapStatusData; disabled: boolean; heading: RefObject<HTMLHeadingElement | null> }) {
  const { t, locale } = useI18n(), router = useRouter();
  const [data, setData] = useState(initial);
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState(false), [reload, setReload] = useState(0), [elapsed, setElapsed] = useState(0);
  const active = useRef(true), submission = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const url = `/api/assessments/${encodeURIComponent(data.id)}/roadmap`;
  useEffect(() => { active.current = true; return () => { active.current = false; submission.current?.abort(); }; }, []);
  useEffect(() => {
    if (data.roadmap.status !== "pending" || !data.roadmap.createdAt) return;
    let mounted = true, stopped = false, failures = 0;
    let controller: AbortController | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.parse(data.roadmap.createdAt);
    const stop = () => { stopped = true; clearTimeout(poll); controller?.abort(); };
    const updateElapsed = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    updateElapsed();
    const elapsedTimer = setInterval(updateElapsed, 1000);
    const cutoff = setTimeout(() => { stop(); if (mounted) { setPollError(true); router.refresh(); } }, Math.max(0, startedAt + JOB_STALE_AFTER_SECONDS * 1000 - Date.now()));
    async function check() {
      if (!mounted || stopped) return;
      controller = new AbortController();
      try {
        // fetch가 abort를 무시해도 10초 뒤 제어권을 되찾는다.
        const { response, body } = await readJson<RoadmapStatusData>(url, controller, { cache: "no-store" });
        if (!mounted || stopped) return;
        if (!response.ok) throw new Error();
        if (!mounted || stopped) return;
        if (body.id !== data.id || body.workspaceId !== data.workspaceId || !["not-requested", "pending", "succeeded", "failed"].includes(body.roadmap?.status)) throw new Error();
        failures = 0;
        if (body.roadmap.status !== "pending" || body.roadmap.attemptId !== data.roadmap.attemptId) {
          stop(); setData(body); router.refresh(); heading.current?.focus(); return;
        }
        if (body.workspaceMismatch) setData(old => ({ ...old, workspaceMismatch: true }));
      } catch { if (mounted && !stopped && ++failures >= 3) { stop(); setPollError(true); } }
      finally { if (mounted && !stopped) poll = setTimeout(() => { void check(); }, 4000); }
    }
    poll = setTimeout(() => { void check(); }, 4000);
    return () => { mounted = false; stop(); clearInterval(elapsedTimer); clearTimeout(cutoff); };
  }, [data.id, data.workspaceId, data.roadmap.status, data.roadmap.attemptId, data.roadmap.createdAt, url, reload, router, heading]);
  async function generate() {
    if (submitting || disabled || data.workspaceMismatch || data.roadmap.status === "pending") return;
    const sequence = ++generation.current;
    const controller = new AbortController(); submission.current = controller;
    setSubmitting(true); setError(null);
    try {
      const { response, body } = await readJson<{ id?: unknown; code?: unknown }>(url, controller, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: data.workspaceId }), signal: controller.signal });
      if (!active.current || sequence !== generation.current) return;
      if (!response.ok) { setError(typeof body.code === "string" ? body.code : "internal"); return; }
      if (body.id !== data.id) throw new Error();
      // 새 예약의 시각·attempt는 POST body로 만들지 않고 검증된 GET에서만 읽는다.
      const { response: status, body: saved } = await readJson<RoadmapStatusData>(url, controller, { cache: "no-store" });
      if (!active.current || sequence !== generation.current) return;
      if (!status.ok || saved.id !== data.id || saved.workspaceId !== data.workspaceId) throw new Error();
      setData(saved); setPollError(false); router.refresh(); heading.current?.focus();
    } catch { if (active.current && sequence === generation.current) setError("internal"); }
    finally { if (active.current && sequence === generation.current) setSubmitting(false); }
  }
  const noData = data.availability === "no-data" || data.roadmap.error?.code === "no-data";
  const problem = error ?? (data.roadmap.status === "failed" ? data.roadmap.error?.code ?? "internal" : null);
  return <>
    <p className="text-sm text-muted">{t("assessmentRoadmap.notice")}</p>
    <p className="text-sm text-subtle">{t("assessmentRoadmap.localPreserved")}</p>
    {data.coverage && <p className="text-sm text-muted">{t("assessmentRoadmap.ui.coverage", { included: data.coverage.included, total: data.coverage.total, excluded: data.coverage.excluded })}</p>}
    {data.workspaceMismatch && <p role="alert" className="text-warning">{t("assessmentRoadmap.errors.workspace-changed")}</p>}
    {noData ? <p role="status">{t("assessmentRoadmap.errors.no-data")}</p> : data.availability === "unavailable" ? <p role="status">{t("assessmentRoadmap.errors.unavailable")}</p> : <>
      {data.roadmap.status === "pending" && <div><p role="status">{t("assessmentRoadmap.status.pending")}</p><p className="text-sm text-subtle">{t("assessmentRoadmap.ui.elapsed", { seconds: elapsed })}</p></div>}
      {problem && <p role="alert" className="text-warning">{t(roadmapErrorMessageKey(problem))}
        {(problem === "key-unavailable" || problem === "not-configured") && <> <Link className="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href={`/workspaces/${encodeURIComponent(data.workspaceId)}/claude`}>{t("assessmentRoadmap.ui.keySettings")}</Link></>}
      </p>}
      {pollError && <div><p role="alert" className="text-warning">{t("assessmentRoadmap.ui.pollError")}</p><Button variant="secondary" onClick={() => { setPollError(false); setReload(value => value + 1); router.refresh(); }}>{t("assessmentRoadmap.ui.reload")}</Button></div>}
      {data.roadmap.status === "succeeded" && data.roadmap.content && <div className="space-y-4 break-words">
        <p>{data.roadmap.content.summary[locale]}</p>
        <p className="text-sm text-subtle">{t("assessmentRoadmap.ui.generatedAt")} <LocalTime value={data.roadmap.content.generatedAt} format="datetime" /></p>
        <ol className="list-inside list-decimal space-y-4">{data.roadmap.content.phases.map(phase => <li key={phase.id}>
          <h3 className="inline font-semibold text-ink">{phase.title[locale]}</h3>
          <p className="text-sm text-muted">{t("assessmentRoadmap.ui.findings", { count: phase.findingIds.length })}</p>
          <ul className="list-inside list-disc">{phase.actions.map((action, i) => <li key={i}>{action[locale]}</li>)}</ul>
        </li>)}</ol>
      </div>}
      {(data.roadmap.status === "not-requested" || data.roadmap.status === "failed") && <Button variant="secondary" disabled={submitting || disabled || data.workspaceMismatch} onClick={() => { void generate(); }}>
        {t(data.roadmap.status === "failed" ? "assessmentRoadmap.retry" : "assessmentRoadmap.generate")}
      </Button>}
      {submitting && <p role="status">{t("assessmentRoadmap.status.pending")}</p>}
    </>}
  </>;
}
