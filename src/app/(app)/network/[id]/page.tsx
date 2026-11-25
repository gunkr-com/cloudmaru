import Link from "next/link";
import {notFound} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {getCurrentWorkspace} from "@/services/current-workspace";
import {getWorkspace} from "@/services/db/workspaces";
import {getNetworkDiagnostic,getNetworkSourceScan} from "@/services/db/network-diagnostics";
import {networkResources} from "@/lib/network-diagnostics/validation";
import {NetworkForm,NetworkPending,NetworkResult} from "@/components/network-diagnostics/network-ui";
import {withSiteName} from "@/lib/dashboard/page-titles";
import {sanitizeNetworkDiagnostic} from "@/lib/network-diagnostics/presentation";
import {LocalTime} from "@/components/ui/local-time";

export async function generateMetadata(){const {t}=await getI18n();return {title:withSiteName(t("network.title"))};}
export default async function NetworkDiagnosticPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 const [{t},current,row]=await Promise.all([getI18n(),getCurrentWorkspace(),getNetworkDiagnostic(id)]);
 if(!row) notFound();
 const owner=await getWorkspace(row.workspaceId); const mismatch=current.id !== row.workspaceId;
 const saved=row.status !== "succeeded" ? await getNetworkSourceScan(row.sourceScanId) : null;
 const linkClass="inline-flex min-h-8 items-center rounded text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
 const failureCode=row.error?.code === "timeout" ? "timeout" : row.error?.code === "interrupted" ? "interrupted" : "internal";
 return <div className="min-w-0 space-y-8 text-body">
  <header className="space-y-3"><h1 className="text-[32px] font-bold text-ink">{t("network.title")}</h1><p>{t("network.readOnly")}</p></header>
  {mismatch && <p className="rounded-lg border border-hairline p-4">{t("network.otherWorkspace",{name:owner?.name ?? row.workspaceId})}</p>}
  {row.status === "pending" && <NetworkPending/>}
  {row.status === "succeeded" && row.result && <NetworkResult diagnostic={sanitizeNetworkDiagnostic(row.result)}/>}
  {row.status !== "succeeded" && <section className="space-y-3 break-all">{saved?.scan.collectedAt && <p>{t("network.scanTime")} · <LocalTime value={saved.scan.collectedAt} format="datetime"/> · {t(saved.scan.source === "live" ? "inventory.source.live" : "inventory.source.import")}</p>}<p>{t("network.sourceScan",{id:row.sourceScanId})}</p><p>{t("network.source")} · {row.input.query.sourceResourceId}</p><p>{t("network.destination")} · {row.input.query.destinationResourceId}</p><p>{t("network.protocol")} · {t(`network.protocols.${row.input.query.protocol}`)}</p><p>{t("network.sourcePort")} · {row.input.query.sourcePort ?? "—"}</p><p>{t("network.destinationPort")} · {row.input.query.destinationPort ?? "—"}</p></section>}
  {row.status === "failed" && <section className="space-y-5">
    <p role="alert" className="text-warning">{t(`network.errors.${failureCode}`)}</p>
    {mismatch ? <p>{t("network.switchNotice")}</p> : saved?.inventory && <details open><summary className={linkClass}>{t("network.retry")}</summary>
      <p>{t("network.sourceScan",{id:row.sourceScanId})}</p>
      <NetworkForm workspaceId={row.workspaceId} sourceScanId={row.sourceScanId} initialQuery={row.input.query} resources={networkResources(saved.inventory.resources).map(({id,name,type})=>({id,name,type}))}/>
    </details>}
  </section>}
  <Link href="/network" className={linkClass}>{t("network.newQuery")}</Link>
 </div>;
}
