"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type JSX, type KeyboardEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  analysisInputSchema,
  AVAILABILITY_OPTIONS,
  EXPECTED_USERS_OPTIONS,
} from "@/lib/analysis/input-schema";
import { useI18n } from "@/i18n/provider";
import { isMessageKey } from "@/i18n/translate";
import { DEFAULT_REGION, isSupportedRegion, SUPPORTED_REGIONS } from "@/lib/workspace/regions";
import { formatMoney } from "@/i18n/format";
import { formatBudgetInput, getFormattedBudgetCaret, parseBudgetInput } from "@/lib/form/budget";
import { isEmptyDraft, type AnalysisDraft } from "@/lib/form/draft";
import { useAnalysisDraft } from "@/components/analysis/use-analysis-draft";
import type { AnalysisInput } from "@/types/analysis";

export type AnalysisFormProps = {
  workspaceId?: string;
  defaultRegion?: string;
  defaultValues?: Partial<AnalysisInput>;
  onSubmit: (input: AnalysisInput) => void | boolean | Promise<void | boolean>;
  pending?: boolean;
  errorMessage?: string;
  draftKey?: string;
  mode?: "new" | "rerun";
  sourceHref?: string;
};

const EXAMPLES = [
  { labelKey: "analysis.exampleReservationLabel", valueKey: "analysis.exampleReservation" },
  { labelKey: "analysis.exampleBoardLabel", valueKey: "analysis.exampleBoard" },
  { labelKey: "analysis.exampleStoreLabel", valueKey: "analysis.exampleStore" },
] as const;
const AVAILABILITY_HELP_KEYS = { low: "analysis.availabilityLowHelp", medium: "analysis.availabilityMediumHelp", high: "analysis.availabilityHighHelp" } as const;
const COMMON_BUDGETS = [100, 300, 500, 1_000] as const;
const FIELD_ORDER: (keyof AnalysisInput)[] = ["description", "expectedUsers", "monthlyBudget", "availability", "region"];

export function AnalysisForm({ workspaceId, defaultRegion = DEFAULT_REGION, defaultValues, onSubmit, pending = false, errorMessage, draftKey, mode = "new", sourceHref }: AnalysisFormProps): JSX.Element {
  const { locale, t } = useI18n();
  const copy = (message: string) => isMessageKey(message) ? t(message) : t("analysis.startFallback");
  const id = useId();
  const [values, setValues] = useState({
    region: [defaultValues?.region, defaultRegion].find((region): region is string => typeof region === "string" && isSupportedRegion(region)) ?? DEFAULT_REGION,
    description: defaultValues?.description ?? "",
    expectedUsers: defaultValues?.expectedUsers ?? "",
    monthlyBudget: defaultValues?.monthlyBudget === undefined ? "" : formatBudgetInput(String(defaultValues.monthlyBudget)),
    availability: defaultValues?.availability ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof AnalysisInput, string[]>>>({});
  const [draftReady, setDraftReady] = useState(false);
  const { read: readDraft, write: writeDraft, clear: clearDraft } = useAnalysisDraft(draftKey);
  const budgetRef = useRef<HTMLInputElement>(null);
  const budgetCaret = useRef<number | null>(null);

  useEffect(() => {
    const saved = readDraft();
    queueMicrotask(() => {
      if (saved && !isEmptyDraft(saved)) setValues(saved);
      setDraftReady(true);
    });
  }, [readDraft]);

  useEffect(() => {
    if (draftReady) writeDraft(values as AnalysisDraft);
  }, [draftReady, writeDraft, values]);

  // 쉼표를 다시 정리하면 브라우저가 커서를 끝으로 옮기므로 같은 숫자 뒤로 되돌린다.
  useLayoutEffect(() => {
    const caret = budgetCaret.current;
    if (caret === null) return;
    budgetCaret.current = null;
    budgetRef.current?.setSelectionRange(caret, caret);
  });

  function validateField(field: keyof AnalysisInput, value: string) {
    const parsedValue = field === "monthlyBudget" ? parseBudgetInput(value) : value;
    const result = analysisInputSchema.shape[field].safeParse(parsedValue);
    setErrors((previous) => {
      const next = { ...previous };
      if (result.success) delete next[field];
      else next[field] = [result.error.issues[0]?.message ?? "analysis.inputError"];
      return next;
    });
  }

  function updateField(field: keyof AnalysisInput, rawValue: string) {
    const value = field === "monthlyBudget" ? formatBudgetInput(rawValue) : rawValue;
    setValues((previous) => ({ ...previous, [field]: value }));
    if (errors[field]) validateField(field, value);
  }

  function handleBudgetChange(event: ChangeEvent<HTMLInputElement>) {
    const { value, selectionStart } = event.target;
    budgetCaret.current = selectionStart === null ? null : getFormattedBudgetCaret(value, selectionStart);
    updateField("monthlyBudget", value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = analysisInputSchema.safeParse({
      ...values,
      monthlyBudget: parseBudgetInput(values.monthlyBudget),
    });
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors;
      setErrors(fieldErrors);
      const firstInvalid = FIELD_ORDER.find((field) => fieldErrors[field]?.length);
      if (firstInvalid === "description") document.getElementById(`${id}-description`)?.focus();
      else if (firstInvalid === "monthlyBudget") document.getElementById(`${id}-budget`)?.focus();
      else if (firstInvalid === "expectedUsers") document.getElementById(`${id}-users-${EXPECTED_USERS_OPTIONS[0].value}`)?.focus();
      else if (firstInvalid === "region") document.getElementById(`${id}-region`)?.focus();
      else if (firstInvalid === "availability") document.getElementById(`${id}-availability-${AVAILABILITY_OPTIONS[0].value}`)?.focus();
      return;
    }
    setErrors({});
    const result = await onSubmit(parsed.data);
    if (result !== false) clearDraft();
  }

  function handleDescriptionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  const describedBy = (helpId: string, errorId: string, hasError: boolean) => hasError ? `${helpId} ${errorId}` : helpId;
  return (
    <form noValidate onSubmit={handleSubmit} aria-busy={pending} className="space-y-6 rounded-xl border border-hairline bg-surface-1 p-6 text-sm text-body">
      {errorMessage && <p role="alert" className="text-sm text-warning">{copy(errorMessage)}{errorMessage === "workspace.claude.unavailable" && workspaceId && <> <a href={`/workspaces/${encodeURIComponent(workspaceId)}/claude`} className="text-ink underline underline-offset-4">{t("workspace.claude.configure")}</a></>}</p>}
      <div className="flex items-center gap-3 text-xs font-semibold tracking-[0.6px] text-subtle">
        <p>{mode === "rerun" ? t("analysis.rerun") : t("analysis.requirementsStep")}</p>
        {mode === "rerun" && sourceHref && <a href={sourceHref} className="text-[13px] font-normal tracking-normal text-ink underline underline-offset-4">{t("analysis.sourceResult")}</a>}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${id}-description`}>{t("analysis.descriptionLabel")}</Label>
        <p id={`${id}-description-help`} className="text-[13px] leading-[1.7] text-subtle">{t("analysis.descriptionHelp")}</p>
        <Textarea id={`${id}-description`} name="description" rows={4} placeholder={t("analysis.descriptionPlaceholder")} value={values.description} onChange={(event) => updateField("description", event.target.value)} onKeyDown={handleDescriptionKeyDown} disabled={pending} aria-invalid={!!errors.description} aria-describedby={describedBy(`${id}-description-help`, `${id}-description-error`, !!errors.description)} />
        <div className="flex justify-end text-[13px] tabular-nums text-subtle" aria-hidden="true">
          <span className={values.description.length > 2000 ? "text-warning" : undefined}>{t("analysis.characterCount", { count: new Intl.NumberFormat(locale).format(values.description.length) })}</span>
        </div>
        {!values.description && <div role="group" aria-label={t("analysis.examplesLabel")} className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => <button key={example.labelKey} type="button" disabled={pending} onClick={() => { updateField("description", t(example.valueKey)); document.getElementById(`${id}-description`)?.focus(); }} className="min-h-8 rounded-full border border-hairline bg-surface-1 px-2.5 py-1 text-[13px] text-body disabled:pointer-events-none disabled:opacity-50">{t(example.labelKey)}</button>)}
        </div>}
        {errors.description && <p id={`${id}-description-error`} className="text-[13px] text-warning">{copy(errors.description[0])}</p>}
      </div>

      <div className="space-y-3">
        <Label id={`${id}-expected-users-label`}>{t("analysis.usersLabel")}</Label>
        <p id={`${id}-users-help`} className="text-[13px] leading-[1.7] text-subtle">{t("analysis.usersHelp")}</p>
        <RadioGroup name="expectedUsers" value={values.expectedUsers} onValueChange={(value) => updateField("expectedUsers", value)} disabled={pending} aria-labelledby={`${id}-expected-users-label`} aria-invalid={!!errors.expectedUsers} aria-describedby={describedBy(`${id}-users-help`, `${id}-expected-users-error`, !!errors.expectedUsers)} className="flex flex-wrap gap-x-6 gap-y-3">
          {EXPECTED_USERS_OPTIONS.map((option) => <div key={option.value} className="flex items-center gap-2"><RadioGroupItem id={`${id}-users-${option.value}`} value={option.value} aria-invalid={!!errors.expectedUsers} aria-describedby={describedBy(`${id}-users-help`, `${id}-expected-users-error`, !!errors.expectedUsers)} /><Label htmlFor={`${id}-users-${option.value}`}>{t(option.labelKey)}</Label></div>)}
        </RadioGroup>
        {errors.expectedUsers && <p id={`${id}-expected-users-error`} className="text-[13px] text-warning">{copy(errors.expectedUsers[0])}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${id}-budget`}>{t("analysis.budgetLabel")}</Label>
        <p id={`${id}-budget-help`} className="text-[13px] leading-[1.7] text-subtle">{t("analysis.budgetHelp")}</p>
        <div className="relative">
          <Input ref={budgetRef} id={`${id}-budget`} name="monthlyBudget" type="text" inputMode="numeric" value={values.monthlyBudget} onChange={handleBudgetChange} disabled={pending} aria-invalid={!!errors.monthlyBudget} aria-describedby={describedBy(`${id}-budget-help`, `${id}-budget-error`, !!errors.monthlyBudget)} className="pl-14 tabular-nums" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-subtle">CA$</span>
        </div>
        <div role="group" aria-label={t("analysis.budgetChips")} className="flex flex-wrap gap-2">
          {COMMON_BUDGETS.map((amount) => <button key={amount} type="button" disabled={pending} onClick={() => updateField("monthlyBudget", String(amount))} className="min-h-8 rounded-full border border-hairline bg-surface-1 px-2.5 py-1 text-[13px] text-body disabled:pointer-events-none disabled:opacity-50">{formatMoney(amount, "CAD", locale)}</button>)}
        </div>
        {errors.monthlyBudget && <p id={`${id}-budget-error`} className="text-[13px] text-warning">{copy(errors.monthlyBudget[0])}</p>}
      </div>

      <div className="space-y-3">
        <Label id={`${id}-availability-label`}>{t("analysis.availabilityLabel")}</Label>
        <RadioGroup name="availability" value={values.availability} onValueChange={(value) => updateField("availability", value)} disabled={pending} aria-labelledby={`${id}-availability-label`} aria-invalid={!!errors.availability} className="flex flex-wrap gap-x-6 gap-y-3">
          {AVAILABILITY_OPTIONS.map((option) => <div key={option.value} className="flex items-start gap-2"><RadioGroupItem id={`${id}-availability-${option.value}`} value={option.value} aria-invalid={!!errors.availability} aria-describedby={`${id}-availability-help-${option.value}${errors.availability ? ` ${id}-availability-error` : ""}`} /><div className="space-y-1"><Label htmlFor={`${id}-availability-${option.value}`}>{t(option.labelKey)}</Label><p id={`${id}-availability-help-${option.value}`} className="max-w-56 text-[13px] leading-[1.6] text-subtle">{t(AVAILABILITY_HELP_KEYS[option.value])}</p></div></div>)}
        </RadioGroup>
        {errors.availability && <p id={`${id}-availability-error`} className="text-[13px] text-warning">{copy(errors.availability[0])}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${id}-region`}>{t("analysis.regionLabel")}</Label>
        <p id={`${id}-region-help`} className="text-[13px] text-subtle">{t("analysis.regionHelp")}</p>
        <select id={`${id}-region`} name="region" value={values.region} onChange={(event) => updateField("region", event.target.value)} disabled={pending} aria-invalid={!!errors.region} aria-describedby={describedBy(`${id}-region-help`, `${id}-region-error`, !!errors.region)} className="w-full rounded-lg border border-control bg-canvas p-3.5 text-sm">
          {SUPPORTED_REGIONS.map((region) => <option key={region.id} value={region.id}>{region.label}</option>)}
        </select>
        {errors.region && <p id={`${id}-region-error`} className="text-[13px] text-warning">{copy(errors.region[0])}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-keyshortcuts="Meta+Enter Control+Enter">{t("analysis.run")}</Button>
        <span className="text-[13px] text-subtle">{t("analysis.shortcut")}</span>
        {/* 라이브 영역은 늘 두고 문구만 바꿔야 화면 낭독기가 변화를 읽는다. */}
        <p role="status" className={pending ? "text-[13px] text-muted" : "sr-only"}>{pending ? t("analysis.sending") : ""}</p>
      </div>
    </form>
  );
}
