"use client";
import { useState } from "react";
import { createTranslator } from "@/i18n/translate";
import { I18nProvider } from "@/i18n/provider";
import { LocalTime } from "@/components/ui/local-time";
import { sectionKeys } from "@/lib/report/selection";
import { sectionsFor, selectionQuery } from "@/lib/report/selection";
import type { ConsultingReport, ReportTable } from "@/types/report";
import styles from "./report.module.css";

function Table({table,title,limit}:{table:ReportTable;title:string;limit?:number}) {
 return <table className={styles.table}><caption>{title}</caption><thead><tr>{table.headers.map((h,i)=><th scope="col" key={i}>{h}</th>)}</tr></thead><tbody>{table.rows.slice(0,limit).map((row,i)=><tr key={i}>{row.map((cell,j)=>j===0?<th scope="row" key={j}>{cell}</th>:<td key={j}>{cell}</td>)}</tr>)}</tbody></table>;
}
export function ReportView({report:r}:{report:ConsultingReport}) {
 const t=createTranslator(r.selection.locale),selection=r.selection;
 const available=sectionsFor(r.kind);
 // Only sections this report kind can show are carried by the hidden field.
 const [sections,setSections]=useState(()=>selection.sections.filter(id=>available.includes(id)));
 const base=`/${r.kind==="assess"?"assessments":r.kind==="build"?"analyses":"extensions"}/${r.id}`;
 const sectionNames=available.filter(id=>selection.sections.includes(id)).map(id=>t(sectionKeys[id])).join(" · ");
 const filtered=r.included!==r.total||selection.severity!=="all"||selection.pillar!=="all"||selection.tier!=="all"||available.some(id=>!selection.sections.includes(id));
 const href=(locale:"en"|"ko")=>`${base}/report?${selectionQuery({...selection,locale})}`;
 // The footer is the last block of the final page container, so print cannot place it on a page by itself.
 const footer=<footer className={styles.footer}>{t("common.siteName")} · {r.title} · {selection.locale.toUpperCase()}</footer>;
 const scopeText=t("reports.scopeCount",{included:r.included,total:r.total,unit:r.kind==="assess"?t("reports.findingsUnit"):t("reports.plansUnit")});
 return <I18nProvider locale={selection.locale}><article lang={selection.locale} className={styles.report} data-report-kind={r.kind}>
  <div className={styles.controls}>
   <div className={styles.toolbar}><a href={base}>{t("reports.back")}</a><div><a href={href("en")} lang="en">{t("common.languages.en")}</a><a href={href("ko")} lang="ko">{t("common.languages.ko")}</a><button type="button" onClick={()=>window.print()}>{t("reports.print")}</button></div></div>
   <form aria-label={t("reports.scope")} method="get" className={styles.scopeForm}>
    <input type="hidden" name="sections" value={sections.join(",")}/>
    <label>{t("reports.scope")}<select name="scope" defaultValue={selection.scope}><option value="summary">{t("reports.summary")}</option><option value="full">{t("reports.full")}</option></select></label>
    <label>{t("reports.language")}<select name="lang" defaultValue={selection.locale}><option value="en">{t("common.languages.en")}</option><option value="ko">{t("common.languages.ko")}</option></select></label>
    {r.kind==="assess"?<>
     <label>{t("reports.severity")}<select name="severity" defaultValue={selection.severity}><option value="all">{t("reports.all")}</option>{(["critical","high","medium","low","informational"] as const).map(s=><option key={s} value={s}>{t(`assessment.severity.${s}`)}</option>)}</select></label>
     <label>{t("reports.pillar")}<select name="pillar" defaultValue={selection.pillar}><option value="all">{t("reports.all")}</option>{(["reliability","security","cost","operations","performance"] as const).map(s=><option key={s} value={s}>{t(`assessment.pillars.${s}`)}</option>)}</select></label>
     <input type="hidden" name="tier" value={selection.tier}/>
    </>:<><label>{t("reports.option")}<select name="tier" defaultValue={selection.tier}><option value="all">{t("reports.all")}</option>{(["low","balanced","ha"] as const).map(s=><option key={s} value={s}>{t(`common.tiers.${s}`)}</option>)}</select></label><input type="hidden" name="severity" value={selection.severity}/><input type="hidden" name="pillar" value={selection.pillar}/></>}
    <fieldset><legend>{t("reports.sections")}</legend><div className={styles.checks}>{available.map(id=><label key={id}><input type="checkbox" checked={sections.includes(id)} onChange={event=>setSections(old=>event.target.checked?[...old,id]:old.filter(s=>s!==id))}/>{t(sectionKeys[id])}</label>)}</div></fieldset>
    <button type="submit" disabled={!available.some(id=>sections.includes(id))}>{t("reports.apply")}</button>
   </form><p className={styles.help}>{t("reports.printHelp")}</p>
  </div>
  <div className={styles.summaryPage}>
   <header className={styles.cover}><div className={styles.brand}>{t("common.siteName")} <span>{t("reports.saved")}</span></div><p className={styles.eyebrow}>{t("reports.executive")}</p><h1>{r.title}</h1><p className={styles.subject}>{r.subject}</p><dl className={styles.owner}><div><dt>{t("reports.company")}</dt><dd>{r.owner.companyName??t("reports.companyUnset")}</dd></div><div><dt>{t("reports.ownerWorkspace")}</dt><dd>{r.owner.name}</dd></div></dl><p className={styles.date}><LocalTime value={r.createdAt} format="datetime"/></p></header>
   <section className={styles.scopeNote} aria-label={t("reports.selected")}><strong>{scopeText}</strong><p>{t("reports.sectionScope",{sections:sectionNames})}</p><p>{r.kind==="assess"?<>{t("reports.severity")}: {selection.severity==="all"?t("reports.all"):t(`assessment.severity.${selection.severity}` as "assessment.severity.high")} · {t("reports.pillar")}: {selection.pillar==="all"?t("reports.all"):t(`assessment.pillars.${selection.pillar}` as "assessment.pillars.security")}</>:<>{t("reports.option")}: {selection.tier==="all"?t("reports.all"):t(`common.tiers.${selection.tier}`)}</>}</p>{r.kind==="assess"&&<p>{t("reports.findingFilter")}</p>}{filtered&&<p>{t("reports.filtered")}</p>}{selection.scope==="summary"&&<p>{t("reports.summaryNotice")}</p>}</section>
   <dl className={styles.metrics}>{r.metrics.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd>{m.note&&<p>{m.note}</p>}</div>)}</dl>
   {r.chart&&selection.sections.includes("findings")&&<figure className={styles.chart}><figcaption>{r.chart.title}</figcaption><p>{t("reports.allBaseline")}</p><table aria-label={r.chart.title}><thead className={styles.srOnly}><tr><th scope="col">{t("reports.verdict")}</th><th scope="col">{t("reports.findings")}</th></tr></thead><tbody>{r.chart.rows.map(row=><tr key={row.label}><th scope="row">{row.label}</th><td><span className={styles.barTrack} aria-hidden="true"><span className={styles[row.tone]} style={{width:`${r.chart!.total===0?0:100*row.value/r.chart!.total}%`}}/></span><span>{t("reports.denominator",{count:row.value,total:r.chart!.total})}</span></td></tr>)}</tbody></table></figure>}
   <section className={styles.limits}><h2>{t("reports.assumptions")}</h2>{r.partial&&<p className={styles.warning}>{t("reports.limited")}</p>}<ul>{r.limits.slice(0,r.kind==="assess"?3:4).map((p,i)=><li key={i}>{p}</li>)}</ul><p>{t("reports.notice")}</p></section>
  </div>
  <section className={styles.summaryPage} aria-label={t("reports.executive")} data-report-page="executive-detail">
   <div className={styles.runningTitle}><span>{t("common.siteName")}</span><span>{r.title} · {t("reports.executive")}</span></div>
   {r.sections.length===0&&<p>{t("reports.noData")}</p>}
   {r.sections.map(s=><section className={styles.summarySection} key={s.id}><h2>{s.title}</h2>{s.paragraphs.slice(0,s.id==="findings"?1:2).map((p,i)=><p key={i}>{p}</p>)}{s.table&&(s.table.rows.length?<Table table={s.table} title={s.title} limit={s.id==="findings"?5:undefined}/>:<p>{t("reports.noData")}</p>)}</section>)}
   <p className={styles.footnote}>{t("reports.appendixRef")}</p>
   {selection.scope==="summary"&&footer}
  </section>
  {selection.scope==="full"&&<div className={styles.appendix} data-report-appendix>
   <div className={styles.appendixHeading}><p className={styles.eyebrow}>{t("common.siteName")}</p><h2>{t("reports.appendix")}</h2><p>{t("reports.detailNotice")}</p><p>{scopeText}</p></div>
   <section className={styles.detailSection}><h3>{t("reports.assumptions")}</h3><ul>{r.limits.map((limit,i)=><li key={i}>{limit}</li>)}</ul></section>
   {r.details?.map((s,i)=><section className={styles.detailSection} key={`${s.id}-${i}`}><h3>{s.title}</h3>{s.paragraphs.map((p,j)=><p key={j}>{p}</p>)}{s.table&&<Table table={s.table} title={s.title}/>}</section>)}
   {r.appendix.map(s=><section className={styles.detailSection} key={s.id}><h3>{s.title}</h3>{s.blocks.map((b,i)=>{
    if(b.kind==="code")return <pre key={i}><code>{b.text}</code></pre>;
    if(b.kind==="time")return <p key={i}>{b.label} · <LocalTime value={b.value} format="datetime"/><code className={styles.timestamp}>{b.value}</code></p>;
    if(b.kind==="source")return <p key={i}><a href={b.href} target="_blank" rel="noopener noreferrer">{b.label}<span className={styles.srOnly}> {t("assessment.ui.newTab")}</span></a><span className={styles.printSource}> {b.href}</span></p>;
    return <p key={i}>{b.text}</p>;
   })}</section>)}
   {footer}
  </div>}
 </article></I18nProvider>;
}
