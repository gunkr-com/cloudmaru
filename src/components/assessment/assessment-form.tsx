"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { useI18n } from "@/i18n/provider";

type ScanOption = { id: string; collectedAt: string; source: "live" | "import" };
const control = "w-full min-w-0 rounded-lg border border-control bg-canvas p-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
export function AssessmentForm({ workspaceId, scans, initialSource = "", initialPrevious = "", disabled = false }: {
  workspaceId: string; scans: ScanOption[]; initialSource?: string; initialPrevious?: string; disabled?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [source, setSource] = useState(initialSource);
  const [previous, setPrevious] = useState(initialPrevious);
  const [error, setError] = useState<"invalid-request" | "workspace-changed" | "internal" | null>(null);
  const [pending, setPending] = useState(false);
  const sourceRef = useRef<HTMLSelectElement>(null);
  // 비동기 실패는 disabled가 해제된 렌더 뒤에 포커스를 옮긴다.
  useEffect(() => { if (error && !pending) sourceRef.current?.focus(); }, [error, pending]);
  const sourceScan = scans.find(scan => scan.id === source);
  const earlier = scans.filter(scan => sourceScan && Date.parse(scan.collectedAt) < Date.parse(sourceScan.collectedAt));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || pending) return;
    const fail = (code: typeof error) => { setPending(false); setError(code); sourceRef.current?.focus(); };
    if (!sourceScan || previous && !earlier.some(scan => scan.id === previous)) { fail("invalid-request"); return; }
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/assessments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, sourceScanId: source, previousScanId: previous || null }) });
      const body = await response.json();
      if (response.status !== 202 || typeof body.id !== "string") { fail(body.code === "workspace-changed" ? "workspace-changed" : body.code === "invalid-source" || body.code === "invalid-body" ? "invalid-request" : "internal"); return; }
      router.push(`/assessments/${encodeURIComponent(body.id)}`);
    } catch { fail("internal"); }
  }
  return <form onSubmit={submit} className="min-w-0 space-y-5">
    <label className="block space-y-2"><span>{t("assessment.ui.selectSource")}</span>
      <select ref={sourceRef} className={control} value={source} disabled={disabled || pending} aria-invalid={!!error} aria-describedby={error ? "assessment-form-error" : undefined} onChange={e => { setSource(e.target.value); setPrevious(""); setError(null); }}>
        <option value="">{t("assessment.ui.choose")}</option>
        {scans.map(scan => <option key={scan.id} value={scan.id}>{scan.id} · {t(scan.source === "import" ? "assessment.ui.scanFile" : "assessment.ui.scanLive")}</option>)}
      </select>
    </label>
    {sourceScan && <p className="text-sm text-muted">{t("assessment.ui.collected")} · <LocalTime value={sourceScan.collectedAt} format="datetime" /></p>}
    <label className="block space-y-2"><span>{t("assessment.ui.selectPrevious")}</span>
      <select className={control} value={previous} disabled={disabled || pending || !sourceScan} onChange={e => { setPrevious(e.target.value); setError(null); }}>
        <option value="">{t("assessment.ui.noComparison")}</option>
        {earlier.map(scan => <option key={scan.id} value={scan.id}>{scan.id} · {t(scan.source === "import" ? "assessment.ui.scanFile" : "assessment.ui.scanLive")}</option>)}
      </select>
    </label>
    {previous && <p className="text-sm text-muted">{t("assessment.ui.collected")} · <LocalTime value={earlier.find(scan => scan.id === previous)!.collectedAt} format="datetime" /></p>}
    {error && <p id="assessment-form-error" role="alert" className="text-warning">{t(`assessment.errors.${error}`)}</p>}
    {pending && <p role="status">{t("assessment.ui.starting")}</p>}
    <Button type="submit" disabled={disabled || pending || !scans.length}>{t("assessment.run")}</Button>
  </form>;
}
