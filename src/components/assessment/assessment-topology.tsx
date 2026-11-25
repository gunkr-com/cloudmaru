"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { TextWithLocalTime } from "@/components/ui/local-time";
import { useI18n } from "@/i18n/provider";
import { formatNumber } from "@/i18n/format";
import type { FirstIssuesSummary } from "@/lib/assessment/first-summary";
import {
  searchTopology, topologyNeighborhood, topologyRoles, topologySeverityOrder,
  type Topology, type TopologyCheck, type TopologyIssue, type TopologyNode,
} from "@/lib/assessment/topology";
import type { ResourceFamily } from "@/lib/inventory/classify";

const nodeWidth = 172;
const nodeHeight = 80;
const columnStep = 224;
const rowStep = 108;
const padding = 18;
const limit = 18;
const resultLimit = 12;
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

function nodePosition(layer: number, row: number, layerSize: number, maxRows: number) {
  return { x: padding + layer * columnStep, y: padding + (row + (maxRows - layerSize) / 2) * rowStep };
}

const typeLabels = {
  "microsoft.storage/storageaccounts": "storage",
  "microsoft.network/privateendpoints": "privateEndpoint",
  "microsoft.network/virtualnetworks": "network",
  "microsoft.network/virtualnetworks/subnets": "subnet",
  "microsoft.network/networkinterfaces": "networkAdapter",
  "microsoft.network/networksecuritygroups": "networkRules",
  "microsoft.network/routetables": "routeTable",
  "microsoft.network/publicipaddresses": "publicIp",
  "microsoft.compute/virtualmachines": "virtualMachine",
  "microsoft.keyvault/vaults": "vault",
  "microsoft.web/sites": "webApp",
} as const;

/** 저장된 점검의 리소스 구성. 판정·연결·근거는 저장 결과에서만 오며 이 컴포넌트는 표시만 한다. */
export function AssessmentTopology({ topology, issues, checks, summary, demo = false }: {
  topology: Topology;
  /** 위반만 담은 예전 입력. checks가 있으면 checks를 쓴다. */
  issues?: TopologyIssue[];
  checks?: TopologyCheck[];
  summary?: FirstIssuesSummary;
  demo?: boolean;
}) {
  const { t, locale } = useI18n();
  const markerId = useId();
  const headingId = useId();
  const detailsId = useId();
  const searchId = useId();
  const summaryId = useId();
  const prioritiesId = useId();
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const diagram = useRef<HTMLDivElement>(null);
  const scrollToSelection = useRef(false);
  const [rootId, setRootId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [expandedIssue, setExpandedIssue] = useState<string>();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<ResourceFamily | null>(null);
  const nodes = new Map(topology.nodes.map(node => [node.id, node]));
  const allChecks: TopologyCheck[] = (checks ?? (issues ?? []).map(issue => ({
    ...issue, verdict: "violation" as const, ruleId: "", reasonCode: null, evidence: [],
  }))).filter(check => nodes.has(check.resourceId));
  const checksByResource = new Map<string, TopologyCheck[]>();
  for (const check of allChecks) checksByResource.set(check.resourceId, [...checksByResource.get(check.resourceId) ?? [], check]);
  const issuesByResource = new Map<string, TopologyCheck[]>();
  const orderedIssues = allChecks.filter(check => check.verdict === "violation").toSorted(
    (a, b) => topologySeverityOrder[a.severity] - topologySeverityOrder[b.severity] || a.title.localeCompare(b.title),
  );
  for (const issue of orderedIssues) {
    const group = issuesByResource.get(issue.resourceId) ?? [];
    group.push(issue);
    issuesByResource.set(issue.resourceId, group);
  }
  const degree = new Map<string, number>();
  for (const edge of topology.edges) {
    for (const id of [edge.sourceId, edge.targetId]) degree.set(id, (degree.get(id) ?? 0) + 1);
  }
  const home = nodes.get(rootId ?? "") ??
    topology.nodes.reduce<(typeof topology.nodes)[number] | undefined>((best, node) =>
      !best || (degree.get(node.id) ?? 0) > (degree.get(best.id) ?? 0) ? node : best, undefined);
  const selected = nodes.get(selectedId ?? "") ?? home;
  const { layers, hidden } = topologyNeighborhood(topology, home?.id ?? "", limit);
  const maxRows = Math.max(1, ...layers.map(layer => layer.length));
  const positions = new Map(layers.flatMap((layer, column) =>
    layer.map((id, row) => [id, nodePosition(column, row, layer.length, maxRows)] as const)));
  const width = 2 * padding + nodeWidth + (layers.length - 1) * columnStep;
  const height = 2 * padding + nodeHeight + (maxRows - 1) * rowStep;
  const selectedEdges = topology.edges.filter(edge => edge.sourceId === selected?.id || edge.targetId === selected?.id);
  const selectedIssues = issuesByResource.get(selected?.id ?? "") ?? [];
  const selectedChecks = checksByResource.get(selected?.id ?? "") ?? [];
  const selectedUnknown = selectedChecks.filter(check => check.verdict === "unknown");
  const selectedPassed = selectedChecks.filter(check => check.verdict === "pass").length;
  const roles = topologyRoles(topology);
  const searching = query.trim().length > 0 || roleFilter !== null;
  const results = searching ? searchTopology(topology, query, roleFilter, roleLabel) : [];

  function pickFromList(id: string, issueId?: string, focusDetail = Boolean(issueId)) {
    scrollToSelection.current = true;
    setRootId(id);
    setSelectedId(id);
    setExpandedIssue(issueId);
    if (focusDetail) detailHeading.current?.focus();
  }

  // 목록·검색으로 고른 리소스와 바로 이웃이 다이어그램 안에서 보이도록 컨테이너만 스크롤한다. 포커스는 옮기지 않는다.
  useEffect(() => {
    if (!scrollToSelection.current) return;
    scrollToSelection.current = false;
    const container = diagram.current;
    const own = positions.get(selected?.id ?? "");
    if (!container || !own) return;
    const neighbour = selectedEdges.map(edge => positions.get(edge.sourceId === selected?.id ? edge.targetId : edge.sourceId)).find(Boolean);
    const box = [own, ...neighbour ? [neighbour] : []];
    const minX = Math.min(...box.map(p => p.x));
    const minY = Math.min(...box.map(p => p.y));
    const maxY = Math.max(...box.map(p => p.y)) + nodeHeight;
    container.scrollTo?.({ top: Math.max(0, (minY + maxY) / 2 - container.clientHeight / 2), left: Math.max(0, minX - padding) });
  });

  function roleLabel(family: ResourceFamily) {
    return t(`inventory.families.${family}`);
  }

  function typeName(type: string, family?: ResourceFamily) {
    const key = typeLabels[type as keyof typeof typeLabels];
    if (key) return t(`assessment.topology.types.${key}`);
    return family && family !== "other" ? roleLabel(family) : type;
  }

  function nodeType(node: TopologyNode) {
    return typeName(node.type, node.family);
  }

  function actualCostText(cost: FirstIssuesSummary["actualCost"]) {
    if (cost.state === "available" || cost.state === "partial") return t("assessment.topology.summary.actualAvailable");
    if (demo) return t("assessment.topology.summary.actualDemo");
    return t("assessment.topology.summary.actualMissing", {
      reason: cost.reason ? t(`assessment.reasons.${cost.reason}`) : t(`assessment.componentStatus.${cost.state}`),
    });
  }

  return <section id="topology" aria-labelledby={headingId} className="min-w-0 scroll-mt-6 space-y-5 rounded-xl border border-hairline bg-surface-1 p-4 text-body sm:p-6">
    <div className="space-y-2">
      <h2 id={headingId} className="text-xl font-semibold text-ink">{t("assessment.topology.title")}</h2>
      <p className="text-sm text-muted">{t("assessment.topology.scope")}</p>
    </div>
    {!selected ? <p>{t("assessment.topology.unavailable")}</p> : <>
      <p className="text-sm">{t("assessment.topology.totals", {
        resources: formatNumber(topology.nodes.length, locale),
        connections: formatNumber(topology.edges.length, locale),
      })}</p>
      {summary && <section aria-labelledby={summaryId} className="min-w-0 space-y-3 rounded-lg border border-hairline bg-canvas p-4">
        <h3 id={summaryId} className="font-semibold text-ink">{t("assessment.topology.summary.title")}</h3>
        <p className="text-sm text-muted"><TextWithLocalTime format="datetime" value={summary.collectedAt}
          text={t("assessment.topology.summary.scanTime", { source: t(summary.source === "live" ? "inventory.source.live" : "inventory.source.import") })} /></p>
        <p className="text-sm text-muted"><TextWithLocalTime format="datetime" value={summary.evaluatedAt} text={t("assessment.topology.summary.evaluated")} /></p>
        <p className="text-sm">{t("assessment.topology.summary.checks", {
          checks: formatNumber(summary.automaticChecks, locale), checked: formatNumber(summary.resources.checked, locale), total: formatNumber(summary.resources.total, locale),
        })}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {([["violation", summary.verdicts.violation, "assessment.topology.summary.violationHelp"],
            ["unknown", summary.verdicts.unknown, "assessment.topology.summary.unknownHelp"],
            ["noRule", summary.resources.noApplicableRule, "assessment.topology.summary.noRuleHelp"]] as const).map(([state, value, help]) =>
            <dl key={state} className="min-w-0 rounded-lg border border-hairline p-3 text-sm">
              <dt className="font-medium text-ink">{t(`assessment.topology.state.${state}`)}</dt>
              <dd className="text-2xl font-semibold tabular-nums text-ink">{formatNumber(value, locale)}</dd>
              <dd className="text-muted">{t(help)}</dd>
            </dl>)}
        </div>
        <h4 className="text-sm font-semibold text-ink">{t("assessment.topology.summary.costs")}</h4>
        <ul className="space-y-1 text-sm">
          <li>{actualCostText(summary.actualCost)}</li>
          <li>{t("assessment.topology.summary.estimate")}</li>
        </ul>
      </section>}
      {(orderedIssues.length > 0 || summary) && <section aria-labelledby={prioritiesId} className="min-w-0 space-y-2">
        <h3 id={prioritiesId} className="text-sm font-semibold text-ink">{t("assessment.topology.priorities")}</h3>
        {orderedIssues.length > 0 ? <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {orderedIssues.slice(0, 5).map(issue => {
            const name = nodes.get(issue.resourceId)?.name ?? "";
            return <li key={issue.id} className="min-w-0 space-y-2 rounded-lg border border-hairline p-3 text-sm">
              <p className="break-words"><strong className="text-warning">{t(`assessment.severity.${issue.severity}`)}</strong> · {name} · {issue.title}</p>
              {(issue.summary || issue.nextCheck) && <dl className="space-y-1">
                {issue.summary && <><dt className="font-medium text-ink">{t("assessment.topology.impact")}</dt><dd>{issue.summary}</dd></>}
                {issue.nextCheck && <><dt className="font-medium text-ink">{t("assessment.topology.nextCheck")}</dt><dd>{issue.nextCheck}</dd></>}
              </dl>}
              <button type="button" onClick={() => pickFromList(issue.resourceId, issue.id)}
                className={`min-h-10 rounded-lg border border-control px-3 py-2 text-left font-medium ${focus}`}>
                {t("assessment.topology.openResource", { name })}
              </button>
            </li>;
          })}
        </ul> : <p className="text-sm text-muted">{t("assessment.topology.summary.noViolations")}</p>}
      </section>}
      <div className="space-y-2">
        <ul aria-label={t("assessment.topology.roleOverview")} className="flex flex-wrap gap-2">
          <li><button type="button" aria-pressed={roleFilter === null} onClick={() => setRoleFilter(null)}
            className={`min-h-10 rounded-lg border px-3 py-2 text-sm ${roleFilter === null ? "border-ink font-semibold text-ink" : "border-control"} ${focus}`}>
            {t("assessment.topology.allRoles", { count: formatNumber(topology.nodes.length, locale) })}
          </button></li>
          {roles.map(({ family, count }) => <li key={family}><button type="button" aria-pressed={roleFilter === family}
            onClick={() => setRoleFilter(roleFilter === family ? null : family)}
            className={`min-h-10 rounded-lg border px-3 py-2 text-sm ${roleFilter === family ? "border-ink font-semibold text-ink" : "border-control"} ${focus}`}>
            {t("assessment.topology.roleCount", { role: roleLabel(family), count: formatNumber(count, locale) })}
          </button></li>)}
        </ul>
      </div>
      <div className="max-w-xl space-y-1 text-sm">
        <label htmlFor={searchId} className="block font-medium text-ink">{t("assessment.topology.search")}</label>
        <input id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)} aria-describedby={`${searchId}-help`}
          className={`block min-h-10 w-full rounded-lg border border-control bg-canvas px-2 text-ink ${focus}`} />
        <p id={`${searchId}-help`} className="text-muted">{t("assessment.topology.searchHelp")}</p>
        {searching && (results.length > 0 ? <>
          <ul aria-label={t("assessment.topology.results")} className="space-y-1">
            {results.slice(0, resultLimit).map(node => <li key={node.id}>
              <button type="button" aria-pressed={selected?.id === node.id} onClick={() => pickFromList(node.id, undefined, true)}
                className={`min-h-10 w-full break-words rounded-lg border border-control px-3 py-2 text-left ${focus}`}>
                {t("assessment.topology.resultLine", { name: node.name, role: roleLabel(node.family ?? "other") })}
              </button>
            </li>)}
          </ul>
          {results.length > resultLimit && <p className="text-muted">{t("assessment.topology.moreResults", { count: formatNumber(results.length - resultLimit, locale) })}</p>}
        </> : <p role="status" className="text-muted">{t("assessment.topology.noResults")}</p>)}
      </div>
      <label className="block max-w-md space-y-1 text-sm">
        <span className="font-medium text-ink">{t("assessment.topology.choose")}</span>
        <select value={home?.id} onChange={event => pickFromList(event.target.value)}
          className={`block min-h-10 w-full rounded-lg border border-control bg-canvas px-2 text-ink ${focus}`}>
          {topology.nodes.map(node => <option key={node.id} value={node.id}>{node.name} · {nodeType(node)} · {node.group}</option>)}
        </select>
      </label>
      <p className="text-sm text-muted">{t("assessment.topology.diagramHelp")}</p>
      {hidden > 0 && <p className="text-sm text-muted">{t("assessment.topology.hidden", { count: formatNumber(hidden, locale) })}</p>}
      <div ref={diagram} role="region" aria-label={t("assessment.topology.diagram")} tabIndex={0}
        className={`max-h-[410px] overflow-auto rounded-lg border border-hairline bg-canvas ${focus}`}>
        <div className="relative mx-auto" style={{ width, height }}>
          <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 text-muted" width={width} height={height}>
            <defs><marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto" viewBox="0 0 7 6"><path d="M0 0L7 3L0 6Z" fill="currentColor" /></marker></defs>
            {topology.edges.map(edge => {
              const from = positions.get(edge.sourceId);
              const to = positions.get(edge.targetId);
              if (!from || !to) return null;
              const sameColumn = from.x === to.x;
              const forward = from.x < to.x;
              const startX = from.x + (sameColumn ? nodeWidth / 2 : forward ? nodeWidth : 0);
              const endX = to.x + (sameColumn ? nodeWidth / 2 : forward ? 0 : nodeWidth);
              const startY = from.y + (sameColumn ? from.y < to.y ? nodeHeight : 0 : nodeHeight / 2);
              const endY = to.y + (sameColumn ? from.y < to.y ? 0 : nodeHeight : nodeHeight / 2);
              return <line key={JSON.stringify(edge)} x1={startX} y1={startY} x2={endX} y2={endY} stroke="currentColor"
                strokeWidth={edge.sourceId === selected.id || edge.targetId === selected.id ? 2 : 1}
                strokeDasharray={edge.type === "connects_to" ? undefined : "5 3"} markerEnd={`url(#${markerId})`} />;
            })}
          </svg>
          {[...positions].map(([id, position]) => {
            const node = nodes.get(id)!;
            const topIssue = issuesByResource.get(id)?.[0];
            const style: CSSProperties = { left: position.x, top: position.y, width: nodeWidth, height: nodeHeight };
            return <button type="button" key={id} aria-pressed={selected.id === id} aria-controls={detailsId}
              onClick={() => { setSelectedId(id); setExpandedIssue(topIssue?.id); detailHeading.current?.focus(); }} style={style}
              className={`absolute overflow-hidden rounded-lg border bg-surface-1 px-2 text-left text-sm ${selected.id === id ? "border-ink" : "border-control"} ${focus}`}>
              <span className="block truncate font-semibold text-ink">{node.name}</span>
              <span className="block truncate text-xs text-muted">{nodeType(node)}</span>
              {topIssue && <span className="block truncate text-xs font-semibold text-warning">
                {t("assessment.topology.issueBadge", { severity: t(`assessment.severity.${topIssue.severity}`), count: formatNumber(issuesByResource.get(id)?.length ?? 0, locale) })}
              </span>}
            </button>;
          })}
        </div>
      </div>
      <section id={detailsId} aria-labelledby={`${detailsId}-heading`} className="space-y-3 rounded-lg border border-hairline bg-canvas p-4">
        <h3 id={`${detailsId}-heading`} ref={detailHeading} tabIndex={-1} className={`break-words font-semibold text-ink ${focus}`}>{selected.name}</h3>
        <p className="break-words text-sm text-muted">{nodeType(selected)} · {t("explorer.group")} {selected.group}</p>
        <h4 className="text-sm font-semibold">{t("assessment.topology.whatItDoes")}</h4>
        <p className="text-sm">{t("assessment.topology.roleLine", {
          role: roleLabel(selected.family ?? "other"), description: t(`assessment.topology.roles.${selected.family ?? "other"}`),
        })}</p>
        <h4 className="text-sm font-semibold">{t("assessment.topology.connections")}</h4>
        {selectedEdges.length > 0 ? <ul className="space-y-1 text-sm">
          {selectedEdges.map(edge => {
            const other = edge.sourceId === selected.id ? edge.targetId : edge.sourceId;
            const relation = t(`assessment.topology.relations.${edge.type}`);
            return <li key={JSON.stringify(edge)} className="break-words">
              {t("assessment.topology.connectionLine", { source: nodes.get(edge.sourceId)?.name ?? "", relation, target: nodes.get(edge.targetId)?.name ?? "" })}
              {" · "}<button type="button" className={`min-h-6 underline ${focus}`} onClick={() => {
                pickFromList(other);
                detailHeading.current?.focus();
              }}>{t("assessment.topology.viewResource", { name: nodes.get(other)?.name ?? "" })}</button>
            </li>;
          })}
        </ul> : <p className="text-sm text-muted">{t("assessment.topology.noConnections")}</p>}
        <h4 className="text-sm font-semibold">{t("assessment.topology.issues")}</h4>
        {selectedIssues.map((issue, index) => {
          const expanded = expandedIssue === issue.id;
          const issueId = `${detailsId}-issue-${index}`;
          return <div key={issue.id} className="rounded-lg border border-hairline px-3 text-sm">
            <button type="button" aria-expanded={expanded} aria-controls={issueId}
              onClick={() => setExpandedIssue(expanded ? undefined : issue.id)}
              aria-label={`${t(`assessment.severity.${issue.severity}`)} · ${issue.title}`}
              className={`min-h-10 w-full text-left font-medium ${focus}`}>
              <span className="text-warning">{t(`assessment.severity.${issue.severity}`)}</span>{" · "}<span>{issue.title}</span>
            </button>
            <div id={issueId} hidden={!expanded} className="space-y-2 pb-3">
              {issue.summary && <p>{issue.summary}</p>}
              {issue.nextCheck && <p><strong>{t("assessment.topology.nextCheck")}</strong> · {issue.nextCheck}</p>}
              <details open={!issue.summary || undefined} className="space-y-2">
                <summary className={`cursor-pointer text-muted ${focus}`}>{t("assessment.topology.technicalDetails")}</summary>
                <p>{issue.description}</p>
                <p><strong>{t("assessment.ui.remediation")}</strong> · {issue.remediation}</p>
              </details>
            </div>
          </div>;
        })}
        {selectedUnknown.map(check => <div key={check.id} className="space-y-1 rounded-lg border border-hairline px-3 py-2 text-sm">
          <p className="break-words"><strong>{t("assessment.topology.state.unknown")}</strong> · {check.title}
            {check.reasonCode && <> · {t(`assessment.reasons.${check.reasonCode}`)}</>}</p>
          <p className="text-muted">{t("assessment.topology.insufficientHelp")}</p>
        </div>)}
        {selectedPassed > 0 && <p className="text-sm">{t(selectedPassed === 1 ? "assessment.topology.passedCountOne" : "assessment.topology.passedCount", { count: formatNumber(selectedPassed, locale) })}</p>}
        {selectedChecks.length === 0 ? <p className="text-sm text-muted">{checks ? t("assessment.topology.noChecks") : t("assessment.topology.noIssues")}</p>
          : selectedIssues.length === 0 && <p className="text-sm text-muted">{t("assessment.topology.noIssues")}</p>}
        <details className="space-y-2 text-sm">
          <summary className={`min-h-6 cursor-pointer text-muted ${focus}`}>{t("assessment.topology.technicalDetails")}</summary>
          <dl className="space-y-1">
            <dt className="font-medium">{t("assessment.topology.azureId")}</dt>
            <dd className="break-all font-mono text-xs">{selected.azureId ?? selected.id}</dd>
            <dt className="font-medium">{t("assessment.topology.resourceType")}</dt>
            <dd className="break-all font-mono text-xs">{selected.type}</dd>
          </dl>
          {selectedChecks.some(check => check.ruleId) && <ul className="space-y-2">
            {selectedChecks.filter(check => check.ruleId).map(check => <li key={check.id} className="min-w-0 space-y-1">
              <p className="break-words">{t("assessment.topology.ruleLine", { rule: check.ruleId, verdict: t(`assessment.verdict.${check.verdict}`) })}</p>
              {check.evidence.map((item, index) => <p key={index} className="break-all text-xs text-muted">
                {t("assessment.topology.checkedSetting")} · <code>{item.propertyPath}</code> · {t(`assessment.ui.${item.state}`)}
              </p>)}
            </li>)}
          </ul>}
        </details>
      </section>
    </>}
  </section>;
}
