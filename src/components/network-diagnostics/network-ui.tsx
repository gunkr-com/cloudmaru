"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { networkInputSchema } from "@/lib/network-diagnostics/validation";
import type { NetworkQuery, NetworkDiagnostic } from "@/types/network-diagnostics";
import { sanitizeNetworkDiagnostic } from "@/lib/network-diagnostics/presentation";
import { NetworkExplorer } from "@/components/results-explorer/saved-explorers";
import { LocalTime } from "@/components/ui/local-time";

type ResourceOption = { id: string; name: string; type: string };
const control = "block w-full min-w-0 rounded-lg border border-control bg-canvas p-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
export function NetworkForm({ workspaceId, sourceScanId, resources, initialQuery }: {
  workspaceId: string; sourceScanId: string; resources: ResourceOption[]; initialQuery?: NetworkQuery;
}) {
  const { t } = useI18n(); const router = useRouter();
  const [source, setSource] = useState(initialQuery?.sourceResourceId ?? "");
  const [destination, setDestination] = useState(initialQuery?.destinationResourceId ?? "");
  const [protocol, setProtocol] = useState<NetworkQuery["protocol"]>(initialQuery?.protocol ?? "tcp");
  const [sourcePort, setSourcePort] = useState(initialQuery?.sourcePort?.toString() ?? "");
  const [destinationPort, setDestinationPort] = useState(initialQuery?.destinationPort?.toString() ?? "");
  const [sourceFilter, setSourceFilter] = useState(""); const [destinationFilter, setDestinationFilter] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<keyof typeof import("@/i18n/messages/en/network").network.errors | null>(null);
  const [busy, setBusy] = useState(false); const form = useRef<HTMLFormElement>(null); const alert = useRef<HTMLParagraphElement>(null);
  const hasPorts = protocol === "tcp" || protocol === "udp";
  function edit() { setError(null); setInvalid(null); }
  async function submit() {
    if (busy) return;
    const input = {schemaVersion: 1, workspaceId, sourceScanId, query: {sourceScanId, sourceResourceId: source, destinationResourceId: destination, protocol,
      sourcePort: hasPorts && sourcePort !== "" ? Number(sourcePort) : null, destinationPort: hasPorts && destinationPort !== "" ? Number(destinationPort) : null}};
    const parsed = networkInputSchema.safeParse(input);
    if (!parsed.success) {
      const field = !source ? "source" : !destination ? "destination" : hasPorts && (destinationPort === "" || !Number.isInteger(Number(destinationPort)) || Number(destinationPort) < 0 || Number(destinationPort) > 65535) ? "destinationPort" : "sourcePort";
      setInvalid(field); setError("invalid-query"); form.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus(); return;
    }
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/network-diagnostics", {method: "POST", headers: {"Content-Type":"application/json"}, body:JSON.stringify(parsed.data)});
      const data = await response.json();
      if (!response.ok || typeof data.id !== "string" || !/^[0-9a-f-]{36}$/i.test(data.id)) {
        const code = data.code;
        setError(["invalid-query","inventory-too-large","scan-missing","scan-not-succeeded","resource-missing","workspace-changed","timeout","interrupted"].includes(code) ? code : "internal");
        setBusy(false); requestAnimationFrame(()=>alert.current?.focus()); return;
      }
      router.push(`/network/${data.id}`);
    } catch { setError("internal"); setBusy(false); requestAnimationFrame(()=>alert.current?.focus()); }
  }
  if (!resources.length) return <p>{t("network.emptyInventory")}</p>;
  return <form ref={form} noValidate className="space-y-5" onSubmit={event=>{event.preventDefault(); void submit();}}
    onKeyDown={event=>{if(event.key === "Enter" && (event.ctrlKey || event.metaKey)){event.preventDefault(); void submit();}}}>
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        {(["source", "destination"] as const).map(side=>{
          const filter = side === "source" ? sourceFilter : destinationFilter; const selected = side === "source" ? source : destination;
          return <div key={side} className="min-w-0 space-y-2">
            <label className="block text-sm" htmlFor={`${side}-filter`}>{t(side === "source" ? "network.filterSource" : "network.filterDestination")}</label>
            <input id={`${side}-filter`} type="search" className={control} value={filter} onChange={event=>{edit(); (side === "source" ? setSourceFilter : setDestinationFilter)(event.target.value);}}/>
            <label className="block text-sm" htmlFor={side}>{t(`network.${side}`)}</label>
            <select id={side} name={side} className={control} value={selected} aria-invalid={invalid === side} aria-describedby={invalid === side ? "network-error" : undefined}
              onChange={event=>{edit(); (side === "source" ? setSource : setDestination)(event.target.value);}}>
              <option value="">{t("network.choose")}</option>
              {resources.filter(resource=>resource.id === selected || `${resource.name} ${resource.id} ${resource.type}`.toLowerCase().includes(filter.toLowerCase())).map(resource=><option key={resource.id} value={resource.id}>{resource.name} · {resource.id}</option>)}
            </select>
          </div>;
        })}
      </div>
      <label className="block space-y-2"><span>{t("network.protocol")}</span><select className={control} value={protocol} onChange={event=>{edit();setProtocol(event.target.value as NetworkQuery["protocol"]);}}>
        {(["tcp","udp","icmp","any"] as const).map(value=><option key={value} value={value}>{t(`network.protocols.${value}`)}</option>)}
      </select></label>
      {hasPorts ? <div className="grid gap-5 sm:grid-cols-2">{(["sourcePort","destinationPort"] as const).map(field=><label key={field} className="block space-y-2"><span>{t(`network.${field}`)}</span>
        <input className={control} name={field} type="number" min={0} max={65535} step={1} value={field === "sourcePort" ? sourcePort : destinationPort} aria-invalid={invalid === field} aria-describedby={invalid === field ? "network-error" : undefined} onChange={event=>{edit();(field === "sourcePort" ? setSourcePort : setDestinationPort)(event.target.value);}}/>
      </label>)}</div> : <p>{t("network.noPorts")}</p>}
    </fieldset>
    {error && <p id="network-error" ref={alert} tabIndex={-1} role="alert" className="text-warning">{t(`network.errors.${error}`)}</p>}
    {busy && <p role="status">{t("network.status.pending")}</p>}
    <Button disabled={busy} type="submit" aria-keyshortcuts="Meta+Enter Control+Enter">{t("network.run")}</Button>
  </form>;
}
export function NetworkPending() {
  const {t}=useI18n(); const router=useRouter();
  useEffect(()=>{const timer=setInterval(()=>router.refresh(),3000);return()=>clearInterval(timer);},[router]);
  return <p role="status">{t("network.status.pending")}</p>;
}
export function NetworkResult({diagnostic}: {diagnostic:NetworkDiagnostic}) {
  const {t}=useI18n(); const {engine,query,sourceScan}=sanitizeNetworkDiagnostic(diagnostic);
  function reasons(codes: typeof engine.reasonCodes) {return <ul className="space-y-1">{codes.map(code=><li key={code}>{t(`network.reasons.${code}`)}</li>)}</ul>;}
  return <section className="min-w-0 space-y-5 text-sm text-body">
    <h2 className="text-3xl font-bold text-ink">{t(`network.verdict.${engine.verdict}`)}</h2>
    <p>{t("network.limitations")}</p>
    {engine.verdict === "unknown" && <p>{t("network.unknownHelp")}</p>}
    {sourceScan.completeness.state !== "complete" && <div><p>{t("network.partial")}</p>{reasons(sourceScan.completeness.reasons)}</div>}
    <dl className="space-y-2 break-all">
      <dt>{t("network.sourceScan",{id:diagnostic.sourceScanId})}</dt>
      <dt>{t("network.scanTime")}</dt><dd><LocalTime value={sourceScan.collectedAt} format="datetime"/> · {t(sourceScan.source === "live" ? "inventory.source.live" : "inventory.source.import")}</dd>
      <dt>{t("network.source")}</dt><dd className="font-mono">{query.sourceResourceId}</dd>
      <dt>{t("network.destination")}</dt><dd className="font-mono">{query.destinationResourceId}</dd>
      <dt>{t("network.protocol")}</dt><dd>{t(`network.protocols.${query.protocol}`)}</dd>
      <dt>{t("network.sourcePort")}</dt><dd>{query.sourcePort ?? "—"}</dd>
      <dt>{t("network.destinationPort")}</dt><dd>{query.destinationPort ?? "—"}</dd>
    </dl>
    {reasons(engine.reasonCodes)}
    <NetworkExplorer paths={engine.paths}/>
    <h2 className="text-xl font-semibold text-ink">{t("network.hops")}</h2>
    {engine.paths.map((path,index)=><section key={index} className="space-y-4 rounded-xl border border-hairline bg-surface-1 p-5">
      <h3>{t("network.path",{number:index+1})} · {t(`network.verdict.${path.verdict}`)}</h3>{reasons(path.reasonCodes)}
      <ol className="space-y-4">{path.hops.map((hop,hopIndex)=><li key={hopIndex} className="space-y-2 break-words">
        <p>{hopIndex+1}. {t(`network.hopTypes.${hop.hopType}`)} · {t(`network.verdict.${hop.verdict}`)}</p><p className="break-all font-mono">{hop.resourceId}</p>{reasons(hop.reasonCodes)}
        {hop.evidence.length > 0 && <details><summary className="min-h-8 cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("network.evidence")}</summary>
          <ul className="space-y-3">{hop.evidence.map((evidence,i)=><li key={i} className="break-all"><p className="font-mono">{evidence.resourceId} · {evidence.propertyPath}</p>
            <p>{t(evidence.observation.state === "missing" ? "network.missing" : evidence.observation.state === "invalid" ? "network.invalid" : "network.observed")}</p>
            {evidence.observation.state === "present" && <pre className="whitespace-pre-wrap break-all">{JSON.stringify(evidence.observation.value,null,2)}</pre>}
          </li>)}</ul></details>}
      </li>)}</ol>
    </section>)}
  </section>;
}
