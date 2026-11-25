import { z } from "zod";
import { getLocale } from "@/i18n/server";
import { parseReportQuery, reportMarkdown } from "@/lib/assessment/report/markdown";
import { assessmentReports } from "@/services/assessment-roadmap-report";
const headers = {"Cache-Control":"no-store","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
export async function GET(request:Request,context:{params:Promise<{id:string}>}):Promise<Response> {
  const {id}=await context.params;
  if(!z.uuid().safeParse(id).success) return Response.json({code:"not-found"},{status:404,headers});
  let options;
  try { options=parseReportQuery(new URL(request.url).searchParams,await getLocale()); }
  catch {return Response.json({code:"invalid-query"},{status:400,headers});}
  try {
    const report=await assessmentReports.get(id,options.locale);
    if(!report) return Response.json({code:"not-found"},{status:404,headers});
    const filename=`cloudsight-assessment-${id.toLowerCase()}${options.locale === "ko" ? ".ko" : ""}.md`;
    return new Response(reportMarkdown(report),{headers:{...headers,"Content-Type":"text/markdown; charset=utf-8","Content-Disposition":`attachment; filename="${filename}"`}});
  } catch {return Response.json({code:"unavailable"},{status:500,headers});}
}
