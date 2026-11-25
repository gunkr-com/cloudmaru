"use client";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/i18n/translate";
import type { JSX } from "react";
import { Button } from "@/components/ui/button";
import type { GuideContent } from "@/types/artifact";
import type { PlanResult } from "@/types/analysis";

export type GuideViewProps = {
  content: GuideContent;
  services: PlanResult["services"];
  downloadHref: string;
};

export function GuideView({ content, services, downloadHref }: GuideViewProps): JSX.Element {
  const { locale, t } = useI18n();
  const serviceNames = new Map(services.map(({ componentId, name }) => [componentId, pickText(name, locale)]));

  return (
    <div className="min-w-0 space-y-6 text-sm leading-[1.7] text-body">
      <p>{pickText(content.overview, locale)}</p>
      <section className="space-y-2">
        <h4 className="text-base font-semibold text-ink">{t("artifacts.prerequisites")}</h4>
        <ul aria-label={t("artifacts.prerequisites")} className="list-disc space-y-1 pl-5">
          {content.prerequisites.map((item, index) => <li key={index}>{pickText(item, locale)}</li>)}
        </ul>
      </section>
      <ol className="min-w-0 list-decimal space-y-6 pl-5">
        {content.steps.map((step, index) => (
          <li className="min-w-0 pl-1" key={index}>
            <div className="space-y-2">
              <h4 className="text-base font-semibold text-ink">{pickText(step.title, locale)}</h4>
              <p className="text-muted">{pickText(step.goal, locale)}</p>
              <ul className="list-disc space-y-1 pl-5">
                {step.instructions.map((instruction, instructionIndex) => (
                  <li className="min-w-0 break-words" key={instructionIndex}>
                    {pickText(instruction, locale).startsWith("az ")
                      ? <code className="block max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-canvas px-2 py-1 font-mono text-[13px]">{pickText(instruction, locale)}</code>
                      : pickText(instruction, locale)}
                  </li>
                ))}
              </ul>
              {step.componentIds.length > 0 && (
                <ul aria-label={t("artifacts.relatedServices", { title: pickText(step.title, locale) })} className="flex flex-wrap gap-2">
                  {step.componentIds.map((id) => {
                    const name = serviceNames.get(id);
                    return name ? <li className="rounded-full border border-hairline bg-surface-1 px-2.5 py-1 text-[13px] text-body" key={id}>{name}</li> : null;
                  })}
                </ul>
              )}
              <p><span className="text-muted">{t("artifacts.verification")}</span> {pickText(step.verification, locale)}</p>
            </div>
          </li>
        ))}
      </ol>
      {content.cautions.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-base font-semibold text-ink">{t("artifacts.cautions")}</h4>
          <ul className="list-disc space-y-1 pl-5">{content.cautions.map((item, index) => <li key={index}>{pickText(item, locale)}</li>)}</ul>
        </section>
      )}
      <Button asChild variant="secondary"><a href={downloadHref} download>{t("artifacts.downloadGuide")}</a></Button>
    </div>
  );
}
