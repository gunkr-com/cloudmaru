"use client";

import { useI18n } from "@/i18n/provider";
import { useState } from "react";
import { AnalysisForm } from "@/components/analysis/analysis-form";
import { Button } from "@/components/ui/button";
import sampleInput from "@/lib/analysis/fixtures/sample-input.json";
import { analysisInputSchema } from "@/lib/analysis/input-schema";
import { DRAFT_STORAGE_PREFIX } from "@/lib/form/draft";
import type { AnalysisInput } from "@/types/analysis";

const savedInput = analysisInputSchema.parse(sampleInput);
const MOCK_DELAY_MS = 1500;
const DRAFT_KEY = "preview";

// 입력 폼을 서버 없이 확인하는 개발용 화면. 제출은 모델을 부르지 않고 잠시 기다린 뒤 검증된 입력을 그대로 보여 준다.
export default function AnalysisFormPreviewPage() {
  const { t } = useI18n();
  const [formKey, setFormKey] = useState(0);
  const [defaultValues, setDefaultValues] = useState<AnalysisInput>();
  const [pending, setPending] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [errorMessage, setErrorMessage] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<AnalysisInput>();

  function resetForm(values?: AnalysisInput) {
    // 다시 마운트된 폼은 임시 저장값을 기본값보다 먼저 복원하므로, 버튼으로 바꾼 값이 보이도록 먼저 지운다.
    try { window.sessionStorage.removeItem(DRAFT_STORAGE_PREFIX + DRAFT_KEY); } catch { /* 저장소 접근 실패는 무시한다. */ }
    setDefaultValues(values);
    setErrorMessage(false);
    setSubmitted(undefined);
    setFormKey((key) => key + 1);
  }

  async function handleSubmit(input: AnalysisInput): Promise<boolean | void> {
    setPending(true);
    setErrorMessage(false);
    setSubmitted(undefined);
    await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
    setPending(false);
    if (failNext) {
      setErrorMessage(true);
      return false;
    }
    setSubmitted(input);
  }

  return (
    <main className="min-w-0 max-w-180 space-y-6 px-10 pt-7 pb-12">
      <p className="text-[13px] leading-[1.6] text-subtle">{t("analysis.preview.formCaption")}</p>

      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => resetForm(savedInput)}>
          {t("analysis.preview.loadInput")}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => resetForm()}>
          {t("analysis.preview.emptyForm")}
        </Button>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={failNext} onChange={(event) => setFailNext(event.target.checked)} />
          {t("analysis.preview.failNext")}
        </label>
      </div>

      <AnalysisForm
        key={formKey}
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        pending={pending}
        errorMessage={errorMessage ? "analysis.preview.failed" : undefined}
        draftKey={DRAFT_KEY}
      />

      {submitted && (
        <section aria-label={t("analysis.preview.submitted")} className="space-y-2">
          <h2 className="text-xs font-semibold tracking-[0.6px] text-subtle">{t("analysis.preview.submitted")}</h2>
          <pre className="overflow-x-auto rounded-md border border-hairline bg-surface-1 p-4 text-[13px] leading-[1.6] text-body">
            {JSON.stringify(submitted, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}
