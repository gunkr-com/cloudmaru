import "server-only";
import { roadmapErrorMessageKey } from "@/lib/assessment/roadmap/error-message";
import { assessmentResultSchema } from "@/lib/completion/schema";
import { parseAssessmentRules } from "@/lib/assessment/rules/catalog";
import { parseAdvisorCatalog } from "@/lib/assessment/advisor-catalog";
import { redactInventoryDisplay } from "@/lib/inventory/diff";
import { normalizeCostTotalForDisplay } from "@/lib/assessment/app/cost-display";
import { buildRoadmapRenderData } from "@/lib/assessment/roadmap/render";
import { createTranslator } from "@/i18n/translate";
import type { AssessmentCatalogData, AssessmentRecord, ActualCost } from "@/types/assessment";
import type { ComponentResult, Coverage, Observation, SourceScan } from "@/types/completion";
import type { Locale } from "@/types/i18n";

export type ReportBlock = {kind:"text";text:string} | {kind:"code";text:string} | {kind:"source";label:string;href:string} | {kind:"time";label:string;value:string};
export type ReportSection = {id:string;title:string;level:2|3;blocks:ReportBlock[]};
export type AssessmentReport = {id:string;locale:Locale;title:string;sections:ReportSection[]};

// 호출자는 proof/저장 근거를 검증한 reader를 사용한다. 현재 판정 엔진·모델을 호출하지 않는다.
export function buildAssessmentReport(record: AssessmentRecord, catalogData: AssessmentCatalogData, locale: Locale): AssessmentReport {
  try { return project(record,catalogData,locale); }
  catch { throw new Error("assessment-report-unavailable"); }
}
function project(record: AssessmentRecord, catalogData: AssessmentCatalogData, locale: Locale): AssessmentReport {
  if (record.status !== "succeeded" || !record.result || !record.completedAt || !["en","ko"].includes(locale)) throw new Error();
  const result = assessmentResultSchema.parse(record.result);
  const rules = parseAssessmentRules(catalogData.rules), advisor = parseAdvisorCatalog(catalogData.advisor);
  if (record.id !== result.id || record.workspaceId !== result.workspaceId || record.sourceScanId !== result.sourceScanId
    || rules.version !== result.local.rulesVersion || result.roadmap.state !== "not-requested") throw new Error();
  const t = createTranslator(locale), sections: ReportSection[] = [];
  const section = (id:string,title:string,level:2|3=2) => {const s:ReportSection={id,title,level,blocks:[]};sections.push(s);return s.blocks;};
  const displayText = (value:string) => String(redactInventoryDisplay(value).value);
  const text = (blocks:ReportBlock[],value:string) => blocks.push({kind:"text",text:displayText(value)});
  const code = (blocks:ReportBlock[],value:string) => blocks.push({kind:"code",text:displayText(value)});
  const field = (blocks:ReportBlock[],label:string,value:string|number) => {text(blocks,label);code(blocks,String(value));};
  const time = (blocks:ReportBlock[],label:string,value:string) => blocks.push({kind:"time",label,value});
  const sources = (blocks:ReportBlock[],urls:string[]) => urls.forEach((href,i)=>blocks.push({kind:"source",href,label:`${t("assessment.ui.source")} ${i+1}`}));
  const state = (blocks:ReportBlock[],component:ComponentResult<unknown>) => {
    text(blocks,t(`assessment.componentStatus.${component.state}`));
    if(component.state === "partial") component.reasons.forEach(r=>text(blocks,t(`assessment.reasons.${r}`)));
    if(component.state === "unavailable" || component.state === "failed") text(blocks,t(`assessment.reasons.${component.reason}`));
  };
  const coverage = (blocks:ReportBlock[],value:Coverage) => {
    text(blocks,t("assessment.ui.coverage",{total:value.total,included:value.included,excluded:value.excluded}));
    value.reasons.forEach(r=>text(blocks,`${t(`assessment.reasons.${r.code}`)} · ${r.count}`));
  };
  const scan = (blocks:ReportBlock[],value:SourceScan) => {
    field(blocks,t("assessment.ui.selectSource"),value.id);
    time(blocks,t("assessment.ui.collected"),value.collectedAt);
    text(blocks,t(value.source === "import" ? "assessment.ui.scanFile" : "assessment.ui.scanLive"));
    text(blocks,`${t("assessment.ui.completeness")} · ${t(`assessment.ui.${value.completeness.state}`)}`);
    value.completeness.reasons.forEach(r=>text(blocks,t(`assessment.reasons.${r}`)));
    field(blocks,t("assessment.ui.scope"),value.subscriptionIds.join("\n"));
  };
  const observation = (blocks:ReportBlock[],value:Observation,path:string,resourceId:string) => {
    // 원본 Pointer/type을 함께 넘겨 이름별 비밀과 고립된 value leaf도 가린다.
    const parts=resourceId.split("/");
    let provider=5;
    for(let i=9;i<parts.length;i+=2) if(parts[i] === "providers") provider=i;
    const type=[parts[provider+1],...parts.slice(provider+2).filter((_,i)=>i%2 === 0)].join("/");
    const safe=redactInventoryDisplay(value.state === "present" ? value.value : null,path,type);
    code(blocks,safe.path);
    text(blocks,t(`assessment.ui.${value.state}`));
    if(value.state === "present") code(blocks,JSON.stringify(safe.value,null,2));
    if(value.state === "invalid") text(blocks,t(`assessment.reasons.${value.reason}`));
  };
  const identity = section("identity",t("assessmentRoadmap.report.identity"));
  text(identity,t("assessmentRoadmap.report.notice"));text(identity,t("assessmentRoadmap.report.safeNotice"));
  code(identity,record.id);field(identity,t("shell.workspace"),record.workspaceId);
  time(identity,t("assessmentRoadmap.report.assessmentCreated"),record.createdAt);
  time(identity,t("assessmentRoadmap.report.assessmentCompleted"),record.completedAt);
  scan(identity,result.sourceScan);
  const local=section("local",t("assessment.localTitle"));
  text(local,t("assessment.localNotice"));field(local,t("assessmentRoadmap.report.rulePack"),rules.version);
  time(local,t("assessment.ui.evaluated"),result.local.evaluatedAt);coverage(local,result.local.coverage);
  text(local,t("assessment.coverage.unknown"));
  if(!result.local.findings.length) text(local,t("assessment.ui.noLocalFindings"));
  const severity = ["critical","high","medium","low","informational"];
  const findings = [...result.local.findings].sort((a,b)=>["violation","unknown","pass"].indexOf(a.verdict)-["violation","unknown","pass"].indexOf(b.verdict)
    || severity.indexOf(a.severity)-severity.indexOf(b.severity) || a.id.localeCompare(b.id));
  for(const [index,f] of findings.entries()) {
    const rule=rules.rules.find(r=>r.id === f.ruleId);
    if(!rule || rule.version !== f.ruleVersion || rule.pillar !== f.pillar || rule.severity !== f.severity) throw new Error();
    const blocks=section(`finding-${f.id}`,`${t("assessmentRoadmap.report.finding")} ${index+1}`,3);
    text(blocks,rule.title[locale]);text(blocks,rule.description[locale]);
    field(blocks,t("assessmentRoadmap.report.findingId"),f.id);field(blocks,t("assessmentRoadmap.report.ruleId"),`${f.ruleId} · ${f.ruleVersion}`);
    field(blocks,t("assessmentRoadmap.report.resource"),f.resourceId);
    text(blocks,`${t(`assessment.verdict.${f.verdict}`)} · ${t(`assessment.severity.${f.severity}`)} · ${t(`assessment.pillars.${f.pillar}`)}`);
    if(f.reasonCode) text(blocks,t(`assessment.reasons.${f.reasonCode}`));
    text(blocks,t("assessment.ui.evidence"));
    for(const e of f.evidence){code(blocks,e.resourceId);observation(blocks,e.observation,e.propertyPath,e.resourceId);}
    text(blocks,t("assessment.ui.remediation"));text(blocks,rule.remediation[locale]);sources(blocks,rule.sources);
  }
  const roadmap=section("roadmap",t("assessmentRoadmap.title"));
  text(roadmap,t("assessmentRoadmap.notice"));text(roadmap,t("assessmentRoadmap.localPreserved"));
  text(roadmap,t(`assessmentRoadmap.status.${record.roadmap.status}`));
  if(record.roadmap.error) text(roadmap,t(roadmapErrorMessageKey(record.roadmap.error.code)));
  const excluded=result.local.findings.filter(f=>f.verdict === "pass").length;
  text(roadmap,t("assessmentRoadmap.report.roadmapCoverage",{total:result.local.findings.length,included:result.local.findings.length-excluded,excluded}));
  if(record.roadmap.status === "succeeded") {
    if(!record.roadmap.content || !record.roadmap.createdAt || !record.roadmap.completedAt) throw new Error();
    const rendered=buildRoadmapRenderData(record.roadmap.content,{assessment:result,catalogData,createdAt:record.roadmap.createdAt,completedAt:record.roadmap.completedAt});
    time(roadmap,t("assessmentRoadmap.ui.generatedAt"),rendered.generatedAt);text(roadmap,rendered.summary[locale]);
    for(const phase of rendered.phases){
      text(roadmap,phase.title[locale]);
      for(const f of phase.findings) code(roadmap,`${f.id}\n${f.ruleId}\n${f.resourceId}`);
      for(const action of phase.actions){text(roadmap,action.text[locale]);sources(roadmap,action.sources);}
    }
  } else if(record.roadmap.content !== null) throw new Error();
  const advice=section("advisor",t("assessment.sections.advisor"));state(advice,result.advisor);
  text(advice,t("assessment.ui.advisorNotice"));field(advice,t("assessmentRoadmap.report.mappingVersion"),advisor.version);
  if("data" in result.advisor){
    const data=result.advisor.data;
    if(data.mappingVersion !== advisor.version) throw new Error();
    time(advice,t("assessment.ui.retrieved"),data.retrievedAt);coverage(advice,data.coverage);
    if(!data.recommendations.length) text(advice,t("assessment.ui.noAdvisor"));
    for(const rec of data.recommendations){
      const entry=advisor.entries.find(e=>e.recommendationTypeId === rec.recommendationTypeId && e.ruleId === rec.ruleId && e.actionId === rec.actionId);
      if(!entry) throw new Error();
      text(advice,entry.title[locale]);text(advice,entry.description[locale]);code(advice,rec.resourceId);
      field(advice,t("assessmentRoadmap.report.ruleAction"),`${entry.ruleId}\n${entry.actionId}\n${rec.recommendationTypeId}`);sources(advice,entry.sources);
    }
  }
  const costs=section("cost",t("assessment.sections.actualCost"));text(costs,t("assessment.ui.provisional"));text(costs,t("assessmentRoadmap.report.credits"));
  text(costs,t("assessment.ui.noSavings"));text(costs,t("assessment.cost.zeroNotice"));
  const costWindow=(key:"monthToDate"|"trailing30Days",component:ComponentResult<ActualCost>)=>{
    const blocks=section(`cost-${key}`,t(`assessment.cost.${key}`),3);state(blocks,component);
    if(!("data" in component)) return;
    const data=component.data;
    time(blocks,t("assessmentRoadmap.report.periodFrom"),data.period.from);time(blocks,t("assessmentRoadmap.report.periodTo"),data.period.to);
    text(blocks,t("assessment.ui.period"));code(blocks,data.period.preset);time(blocks,t("assessment.ui.retrieved"),data.retrievedAt);
    text(blocks,t("assessment.ui.costScope",{available:data.scope.availableSubscriptionIds.length,requested:data.scope.requestedSubscriptionIds.length}));
    text(blocks,t(data.scope.paginationComplete ? "assessment.ui.paginationComplete" : "assessment.ui.paginationPartial"));
    field(blocks,t("assessment.ui.scope"),data.scope.requestedSubscriptionIds.join("\n"));
    for(const id of data.scope.availableSubscriptionIds) code(blocks,`${id} · ${t("assessment.componentStatus.available")}`);
    for(const total of data.totals) {field(blocks,t("assessmentRoadmap.report.total"),`${total.currency} ${normalizeCostTotalForDisplay(total.amount,data.rows.filter(r=>r.currency === total.currency))}`);code(blocks,total.subscriptionIds.join("\n"));}
    for(const row of data.rows){
      field(blocks,t("assessmentRoadmap.report.amount"),`${row.currency} ${row.amount}`);
      field(blocks,t("assessmentRoadmap.report.subscription"),row.subscriptionId);
      text(blocks,t("assessmentRoadmap.report.attribution"));
      if(row.attribution.kind === "unattributed"){text(blocks,t("assessment.ui.unattributed"));text(blocks,t(`assessment.ui.${row.attribution.reason}`));}
      else text(blocks,t("assessmentRoadmap.report.resource"));
      if(row.attribution.resourceId) code(blocks,row.attribution.resourceId);
    }
  };
  costWindow("monthToDate",result.actualCost.monthToDate);costWindow("trailing30Days",result.actualCost.trailing30Days);
  const diff=section("diff",t("assessment.sections.diff"));state(diff,result.diff);text(diff,t("assessment.ui.diffNotice"));
  if("data" in result.diff){
    const data=result.diff.data;
    if(record.previousScanId !== data.baselineScan.id || result.sourceScanId !== data.comparisonScan.id) throw new Error();
    text(diff,t("assessment.ui.baseline"));scan(diff,data.baselineScan);text(diff,t("assessment.ui.comparison"));scan(diff,data.comparisonScan);
    time(diff,t("assessment.ui.compared"),data.comparedAt);coverage(diff,data.coverage);text(diff,t("assessmentRoadmap.report.counts",data.counts));
    if(!data.changes.length) text(diff,t("assessment.ui.noChanges"));
    for(const change of data.changes){
      text(diff,t(change.kind === "unknown" ? "assessment.ui.diffUnknown" : `assessment.ui.${change.kind}`));code(diff,change.resourceId);
      if(change.kind === "unknown") change.reasons.forEach(r=>text(diff,t(`assessment.reasons.${r}`)));
      if(change.kind === "changed") for(const p of change.properties){text(diff,t("assessment.ui.before"));observation(diff,p.before,p.path,change.resourceId);text(diff,t("assessment.ui.after"));observation(diff,p.after,p.path,change.resourceId);}
    }
  }
  return {id:record.id,locale,title:t("assessmentRoadmap.report.title"),sections};
}
