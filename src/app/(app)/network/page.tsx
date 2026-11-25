import Link from "next/link";
import Form from "next/form";
import {getI18n} from "@/i18n/server";
import {getCurrentWorkspace} from "@/services/current-workspace";
import {listScans} from "@/services/db/scans";
import {getNetworkSourceScan,listNetworkDiagnostics} from "@/services/db/network-diagnostics";
import {networkResources} from "@/lib/network-diagnostics/validation";
import {NetworkForm} from "@/components/network-diagnostics/network-ui";
import {LocalTime} from "@/components/ui/local-time";
import {withSiteName} from "@/lib/dashboard/page-titles";

export async function generateMetadata(){const {t}=await getI18n();return {title:withSiteName(t("network.title"))};}
export default async function NetworkPage({searchParams}: {searchParams:Promise<{scan?:string}>}){
 const [{t},workspace,params]=await Promise.all([getI18n(),getCurrentWorkspace(),searchParams]);
 // Saved scan links remain usable even after newer failed scans fill the recent list.
 const [scans,history]=await Promise.all([listScans(workspace.id,{limit:Number.MAX_SAFE_INTEGER}),listNetworkDiagnostics(workspace.id)]);
 const usable=scans.filter(scan=>scan.status === "succeeded");
 const selected=params.scan === undefined ? usable[0] : usable.find(scan=>scan.id === params.scan);
 const saved=selected ? await getNetworkSourceScan(selected.id) : null;
 let resources: ReturnType<typeof networkResources> = []; let invalid=false;
 try {if(saved?.inventory && saved.scan.workspaceId === workspace.id && saved.scan.status === "succeeded") resources=networkResources(saved.inventory.resources);else if(selected) invalid=true;}catch{invalid=true;}
 const linkClass="inline-flex min-h-8 items-center rounded text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
 return <div className="min-w-0 space-y-8 text-body">
  <header className="space-y-3"><h1 className="text-[32px] font-bold text-ink">{t("network.title")}</h1><p>{t("network.readOnly")}</p></header>
  {usable.length > 0 ? <Form action="/network" className="space-y-3"><label htmlFor="baseline" className="block">{t("network.baseline")}</label>
    <select id="baseline" name="scan" defaultValue={selected?.id ?? ""} className="w-full min-w-0 rounded-lg border border-control bg-canvas p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
      {!selected && <option value="">{t("network.baseline")}</option>}
      {usable.map(scan=><option key={scan.id} value={scan.id}>{scan.id}</option>)}
    </select><button className={linkClass} type="submit">{t("network.loadBaseline")}</button>
  </Form> : <p>{t("network.noScans")}</p>}
  {params.scan !== undefined && !selected && <p role="alert">{t("network.errors.scan-missing")}</p>}
  {invalid && <p role="alert">{t("network.errors.invalid-query")}</p>}
  {saved && selected && !invalid && <section className="space-y-4 rounded-xl border border-hairline bg-surface-1 p-5 sm:p-8">
    <p>{t("network.sourceScan",{id:selected.id})}</p>
    {saved.scan.collectedAt && <p>{t("network.scanTime")} · <LocalTime value={saved.scan.collectedAt} format="datetime"/> · {t(saved.scan.source === "live" ? "inventory.source.live" : "inventory.source.import")}</p>}
    <p className="text-sm text-muted">{t("network.limitations")}</p>
    <NetworkForm key={selected.id} workspaceId={workspace.id} sourceScanId={selected.id} resources={resources.map(({id,name,type})=>({id,name,type}))}/>
  </section>}
  <Link href="/inventory" className={linkClass}>{t("network.inventory")}</Link>
  <section className="space-y-4"><h2 className="text-xl font-semibold text-ink">{t("network.history")}</h2>
    {!history.length ? <p>{t("network.noHistory")}</p> : <ol className="divide-y divide-hairline">{history.map(row=><li key={row.id}>
      <Link className={`${linkClass} flex-wrap gap-2 py-3`} href={`/network/${row.id}`}><LocalTime value={row.createdAt} format="datetime"/> · {t(`network.status.${row.status}`)}{row.result && <> · {t(`network.verdict.${row.result.engine.verdict}`)}</>}</Link>
    </li>)}</ol>}
  </section>
 </div>;
}
