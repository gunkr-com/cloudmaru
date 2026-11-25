"use client";
import type { AssessmentReport, ReportBlock } from "@/lib/assessment/report/document";
import { LocalTime } from "@/components/ui/local-time";
import { I18nProvider } from "@/i18n/provider";
import { createTranslator } from "@/i18n/translate";
import styles from "./report.module.css";
const focus="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
/** 표시 투영만 받아 React 텍스트 노드로 렌더링한다. Markdown/HTML 파싱은 하지 않는다. */
export function AssessmentReportView({report}:{report:AssessmentReport}) {
  const t=createTranslator(report.locale);
  const block=(value:ReportBlock,index:number)=>{
    switch(value.kind){
      case "text":return <p key={index} className="whitespace-pre-wrap text-sm leading-relaxed">{value.text}</p>;
      case "code":return <pre key={index} className="whitespace-pre-wrap break-all rounded-md bg-canvas p-2 font-mono text-xs"><code>{value.text}</code></pre>;
      case "time":return <p key={index} className="text-sm">{value.label} · <LocalTime value={value.value} format="datetime"/><code className="block break-all text-xs text-muted">{value.value}</code></p>;
      case "source":return <p key={index}><a href={value.href} className={`inline-block min-h-6 break-all underline ${focus}`} target="_blank" rel="noopener noreferrer">{value.label}<span className="sr-only"> {t("assessment.ui.newTab")}</span></a><span className={styles.printSource}> {value.href}</span></p>;
    }
  };
  return <I18nProvider locale={report.locale}><article lang={report.locale} className={`${styles.report} min-w-0 space-y-8 text-body`}>
    <header className="space-y-4"><h1 className="text-[32px] font-bold text-ink">{report.title}</h1>
      <div className={`${styles.controls} flex flex-wrap items-center gap-4`}>
        <button type="button" className={`min-h-10 rounded-lg bg-ink px-4 py-2 font-semibold text-canvas ${focus}`} onClick={()=>window.print()}>{t("assessmentRoadmap.report.print")}</button>
        <a className={`inline-block min-h-6 underline ${focus}`} href={`/api/assessments/${report.id}/report?format=markdown&lang=${report.locale}`}>{t("assessmentRoadmap.download")}</a>
        <a lang="en" className={`inline-block min-h-6 underline ${focus}`} href={`/assessments/${report.id}/report?lang=en`}>{t("common.languages.en")}</a>
        <a lang="ko" className={`inline-block min-h-6 underline ${focus}`} href={`/assessments/${report.id}/report?lang=ko`}>{t("common.languages.ko")}</a>
        <a className={`inline-block min-h-6 underline ${focus}`} href={`/assessments/${report.id}`}>{t("assessmentRoadmap.report.back")}</a>
      </div>
    </header>
    {report.sections.map(section=><section key={section.id} className="min-w-0 space-y-3 border-t border-hairline pt-5">
      {section.level === 2 ? <h2 className="text-xl font-semibold text-ink">{section.title}</h2> : <h3 className="text-lg font-semibold text-ink">{section.title}</h3>}
      {section.blocks.map(block)}
    </section>)}
  </article></I18nProvider>;
}
