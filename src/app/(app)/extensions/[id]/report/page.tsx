import { notFound } from "next/navigation";
import { getLocale } from "@/i18n/server";
import { createTranslator } from "@/i18n/translate";
import { withSiteName } from "@/lib/dashboard/page-titles";
import { parseSelection } from "@/lib/report/selection";
import { ReportView } from "@/components/report/report-view";
import { extendDocument } from "@/lib/report/document";
import { extensionResults } from "@/services/extension-job-result";
import { getWorkspace } from "@/services/db/workspaces";
import { reportOwner } from "@/lib/report/owner";
export async function generateMetadata({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const fallback=await getLocale();let locale=fallback;
 try{locale=parseSelection(await searchParams,fallback,"extend").locale;}catch{/* Page validates and renders the invalid-query state. */}
 return {title:withSiteName(createTranslator(locale)("reports.extend"))};
}
export default async function ReportPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const {id}=await params;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))notFound();
 let selection;
 try{selection=parseSelection(await searchParams,await getLocale(),"extend");}catch{notFound();}
 const t=createTranslator(selection.locale);
 let report=null;
 try {
   const display=await extensionResults.getDisplay(id);
   // Labels come from the pinned result's saved owner row only, never the current-workspace cookie.
   if(display)report=extendDocument(display,selection,reportOwner(display.result.workspaceId,await getWorkspace(display.result.workspaceId)));
 }catch{return <div role="alert"><h1>{t("reports.extend")}</h1><p>{t("reports.unavailable")}</p></div>;}
 if(!report)notFound();return <ReportView report={report}/>;
}
