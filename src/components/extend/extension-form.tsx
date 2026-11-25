"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { useI18n } from "@/i18n/provider";
import { EXPECTED_USERS_OPTIONS, AVAILABILITY_OPTIONS } from "@/lib/analysis/input-schema";
import { EXTENSION_FIELD_ORDER, validateExtensionForm } from "@/lib/extend-app/form";
import type { ExtensionFormField, ExtensionFormErrors, ExtensionFormValues } from "@/lib/extend-app/form";
import type { MessageKey } from "@/i18n/messages/types";
import type { ExtensionInput } from "@/types/extension";
import type { LocalizedText } from "@/types/i18n";

export type ExtensionScanOption = { id: string; collectedAt: string; source: "live" | "import" };
type Props = {
  workspaceId: string; defaultRegion: string; regions: { id: string; label: LocalizedText }[];
  scans: ExtensionScanOption[]; initialScanId?: string; initialInput?: ExtensionInput; sourceExtensionId?: string;
};
const control = "w-full min-w-0 rounded-lg border border-control bg-canvas p-3.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const focusLink = "inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const availabilityHelp = { low: "analysis.availabilityLowHelp", medium: "analysis.availabilityMediumHelp", high: "analysis.availabilityHighHelp" } as const;

export function ExtensionForm(props: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const id = useId();
  // 언어 변경/서버 재렌더에서 다른 회사나 원본으로 조용히 재결합하지 않는다.
  const [binding] = useState({ workspaceId: props.workspaceId, sourceExtensionId: props.sourceExtensionId });
  const [values, setValues] = useState<ExtensionFormValues>(() => ({
    sourceScanId: props.initialInput?.sourceScanId ?? props.initialScanId ?? "",
    description: props.initialInput?.description ?? "", expectedUsers: props.initialInput?.expectedUsers ?? "",
    monthlyBudget: props.initialInput ? String(props.initialInput.monthlyBudget) : "",
    availability: props.initialInput?.availability ?? "", region: props.initialInput?.region ?? props.defaultRegion,
  }));
  const [errors, setErrors] = useState<ExtensionFormErrors>({});
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const request = useRef<AbortController | null>(null);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const controls = useRef<Partial<Record<ExtensionFormField, HTMLElement | null>>>({});
  const errorFocus = useRef<ExtensionFormField>(binding.sourceExtensionId ? "description" : "sourceScanId");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); clearTimeout(requestTimer.current); }; }, []);
  useEffect(() => { if (error && !pending) controls.current[errorFocus.current]?.focus(); }, [error, pending]);

  const validate = (next: ExtensionFormValues) => validateExtensionForm(next, {
    workspaceId: binding.workspaceId, scanIds: props.scans.map(scan => scan.id), regionIds: props.regions.map(region => region.id),
  });
  function update(field: ExtensionFormField, value: string) {
    const next = { ...values, [field]: value };
    setValues(next); setError(null);
    if (errors[field]) {
      const result = validate(next);
      setErrors(previous => ({ ...previous, [field]: result.ok ? undefined : result.errors[field] }));
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if (props.workspaceId !== binding.workspaceId || props.sourceExtensionId !== binding.sourceExtensionId) {
      setError("extension.errors.workspace-changed"); return;
    }
    const parsed = validate(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      const field = EXTENSION_FIELD_ORDER.find(field => parsed.errors[field]) ?? "sourceScanId";
      controls.current[field === "sourceScanId" && binding.sourceExtensionId ? "description" : field]?.focus(); return;
    }
    lock.current = true; setPending(true); setError(null); setErrors({});
    const controller = new AbortController(); request.current = controller;
    let accepted = false;
    const timeout = setTimeout(() => { controller.abort(); if (mounted.current) { lock.current = false; setPending(false); setError("extension.errors.timeout"); } }, 20_000);
    requestTimer.current = timeout;
    try {
      const response = await fetch("/api/extensions", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ ...parsed.input, ...(binding.sourceExtensionId ? { sourceExtensionId: binding.sourceExtensionId } : {}) }) });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 202 && typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id)) {
        accepted = true;
        router.push(`/extensions/${encodeURIComponent(body.id)}`); return;
      }
      const code: MessageKey = body.code === "claude-unavailable" ? "extension.errors.key-unavailable"
        : body.code === "pricing_unavailable" ? "pricing.unavailable"
        : body.code === "workspace-changed" ? "extension.errors.workspace-changed"
        : body.code === "invalid-source" ? "extension.ui.scanUnavailable"
        : body.code === "invalid-body" ? "extension.errors.invalid-request" : "extension.errors.internal";
      errorFocus.current = binding.sourceExtensionId ? "description" : "sourceScanId"; setError(code);
      if (body.code === "invalid-source") setErrors({ sourceScanId: "extension.ui.scanUnavailable" });
    } catch {
      // 키/서버 원문은 표시하지 않고 언마운트 뒤 상태를 바꾸지 않는다.
      if (!controller.signal.aborted) setError("extension.errors.internal");
    } finally {
      clearTimeout(timeout);
      // 성공하면 이동이 끝날 때까지 중복 제출을 막는다.
      if (mounted.current && request.current === controller && !accepted) { lock.current = false; setPending(false); }
    }
  }
  const described = (field: ExtensionFormField) => `${id}-${field}-help${errors[field] ? ` ${id}-${field}-error` : ""}`;
  const fieldError = (field: ExtensionFormField) => errors[field] && <p role="alert" id={`${id}-${field}-error`} className="text-sm text-warning">{t(errors[field]!)}</p>;
  const selectedScan = props.scans.find(scan => scan.id === values.sourceScanId);
  return <form noValidate onSubmit={submit} aria-busy={pending} className="min-w-0 space-y-6 rounded-xl border border-hairline bg-surface-1 p-6 text-body">
    {error && <p role="alert" className="text-warning">{t(error)}{error === "extension.errors.key-unavailable" && <> <Link className={focusLink} href={`/workspaces/${binding.workspaceId}/claude`}>{t("workspace.claude.configure")}</Link></>}</p>}
    <div className="space-y-2">
      <label htmlFor={`${id}-sourceScanId`}>{t("extension.ui.selectScan")}</label>
      <p id={`${id}-sourceScanId-help`} className="text-sm text-subtle">{t("extension.ui.scanHelp")}</p>
      <select ref={node => { controls.current.sourceScanId = node; }} id={`${id}-sourceScanId`} className={control} value={values.sourceScanId} disabled={pending || !!binding.sourceExtensionId} aria-invalid={!!errors.sourceScanId} aria-describedby={described("sourceScanId")} onChange={e => update("sourceScanId", e.target.value)}>
        <option value="">{t("extension.ui.choose")}</option>
        {values.sourceScanId && !selectedScan && <option value={values.sourceScanId}>{t("extension.ui.scanUnavailable")} · {values.sourceScanId}</option>}
        {props.scans.map(scan => <option key={scan.id} value={scan.id}>{scan.id} · {t(scan.source === "import" ? "inventory.source.import" : "inventory.source.live")}</option>)}
      </select>
      {selectedScan && <p className="text-sm text-muted"><LocalTime value={selectedScan.collectedAt} format="datetime" /></p>}
      {fieldError("sourceScanId")}
    </div>
    <div className="space-y-2">
      <label htmlFor={`${id}-description`}>{t("extension.ui.requirements")}</label>
      <p id={`${id}-description-help`} className="text-sm text-subtle">{t("analysis.descriptionHelp")}</p>
      <textarea ref={node => { controls.current.description = node; }} id={`${id}-description`} className={control} rows={6} value={values.description} disabled={pending} aria-invalid={!!errors.description} aria-describedby={described("description")} onChange={e => update("description", e.target.value)} onKeyDown={e => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
      }} />
      <p className="text-right text-sm tabular-nums text-subtle">{t("analysis.characterCount", { count: new Intl.NumberFormat(locale).format(values.description.length) })}</p>
      {fieldError("description")}
    </div>
    <div className="space-y-2">
      <label htmlFor={`${id}-expectedUsers`}>{t("analysis.usersLabel")}</label>
      <p id={`${id}-expectedUsers-help`} className="text-sm text-subtle">{t("analysis.usersHelp")}</p>
      <select ref={node => { controls.current.expectedUsers = node; }} id={`${id}-expectedUsers`} className={control} value={values.expectedUsers} disabled={pending} aria-invalid={!!errors.expectedUsers} aria-describedby={described("expectedUsers")} onChange={e => update("expectedUsers", e.target.value)}>
        <option value="">{t("analysis.usersRequired")}</option>{EXPECTED_USERS_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
      </select>{fieldError("expectedUsers")}
    </div>
    <div className="space-y-2">
      <label htmlFor={`${id}-monthlyBudget`}>{t("extension.ui.budgetLabel")}</label>
      <p id={`${id}-monthlyBudget-help`} className="text-sm text-subtle">{t("extension.ui.budgetHelp")}</p>
      <input ref={node => { controls.current.monthlyBudget = node; }} id={`${id}-monthlyBudget`} className={control} inputMode="numeric" value={values.monthlyBudget} disabled={pending} aria-invalid={!!errors.monthlyBudget} aria-describedby={described("monthlyBudget")} onChange={e => update("monthlyBudget", e.target.value)} />{fieldError("monthlyBudget")}
    </div>
    <div className="space-y-2">
      <label htmlFor={`${id}-availability`}>{t("analysis.availabilityLabel")}</label>
      <p id={`${id}-availability-help`} className="text-sm text-subtle">{t(values.availability in availabilityHelp ? availabilityHelp[values.availability as keyof typeof availabilityHelp] : "analysis.availabilityRequired")}</p>
      <select ref={node => { controls.current.availability = node; }} id={`${id}-availability`} className={control} value={values.availability} disabled={pending} aria-invalid={!!errors.availability} aria-describedby={described("availability")} onChange={e => update("availability", e.target.value)}>
        <option value="">{t("analysis.availabilityRequired")}</option>{AVAILABILITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
      </select>{fieldError("availability")}
    </div>
    <div className="space-y-2">
      <label htmlFor={`${id}-region`}>{t("analysis.regionLabel")}</label>
      <p id={`${id}-region-help`} className="text-sm text-subtle">{t("extension.ui.regionHelp")}</p>
      <select ref={node => { controls.current.region = node; }} id={`${id}-region`} className={control} value={values.region} disabled={pending} aria-invalid={!!errors.region} aria-describedby={described("region")} onChange={e => update("region", e.target.value)}>
        {!props.regions.some(region => region.id === values.region) && <option value={values.region}>{values.region}</option>}
        {props.regions.map(region => <option key={region.id} value={region.id}>{region.label[locale]}</option>)}
      </select>{fieldError("region")}
    </div>
    <p className="text-sm text-muted">{t("extension.freeGrantNotice")}</p>
    <Button type="submit" disabled={pending} aria-keyshortcuts="Meta+Enter Control+Enter">{t("extension.run")}</Button>
    <p role="status" className={pending ? "text-sm text-muted" : "sr-only"}>{pending ? t("extension.ui.sending") : ""}</p>
  </form>;
}
