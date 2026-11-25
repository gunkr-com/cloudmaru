"use client";
import { pickText } from "@/i18n/translate";
import { useI18n } from "@/i18n/provider";
import type { JSX } from "react";
import { Button } from "@/components/ui/button";
import { BICEP_DRAFT_LABEL, BICEP_DRAFT_NOTICE } from "@/lib/artifacts/labels";
import type { BicepContent } from "@/types/artifact";

export type BicepViewProps = { content: BicepContent; downloadHref: string };

export function BicepView({ content, downloadHref }: BicepViewProps): JSX.Element {
  const { locale, t } = useI18n();
  return (
    <div className="min-w-0 space-y-5 text-sm leading-[1.7] text-body">
      <div className="space-y-1 text-[13px] leading-[1.6] text-warning">
        <p className="font-semibold">{t(BICEP_DRAFT_LABEL)}</p>
        <p>{t(BICEP_DRAFT_NOTICE)}</p>
      </div>
      <pre aria-label={t("artifacts.bicepName")} tabIndex={0} className="max-h-[480px] max-w-full overflow-auto whitespace-pre rounded-lg border border-hairline bg-canvas p-4 font-mono text-[13px] leading-[1.6]"><code>{content.code}</code></pre>
      <section className="space-y-2">
        <h4 className="text-base font-semibold text-ink">{t("artifacts.parameters")}</h4>
        <dl className="divide-y divide-border-row">
          {content.parameters.map(({ name, description }) => (
            <div className="grid min-w-0 gap-1 py-2 sm:grid-cols-[minmax(10rem,0.7fr)_1.3fr]" key={name}>
              <dt className="break-all font-mono text-ink">{name}</dt><dd>{pickText(description, locale)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="space-y-2">
        <h4 className="text-base font-semibold text-ink">{t("artifacts.deploymentNotes")}</h4>
        <ul className="list-disc space-y-1 pl-5">{content.deploymentNotes.map((note, index) => <li key={`${index}-${pickText(note, locale)}`}>{pickText(note, locale)}</li>)}</ul>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="secondary"><a href={downloadHref} download>{t("artifacts.downloadBicep")}</a></Button>
        <span className="text-[13px] leading-[1.6] text-warning">{t(BICEP_DRAFT_LABEL)}</span>
      </div>
    </div>
  );
}
