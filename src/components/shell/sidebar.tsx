"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, type JSX } from "react";
import { selectWorkspace } from "@/app/(app)/workspace-actions";
import { formatMoney } from "@/i18n/format";
import { useI18n } from "@/i18n/provider";
import { LocaleToggle } from "./locale-toggle";
import type { ShellData } from "@/types/shell";
import { ASSESSMENTS_HREF, NETWORK_HREF, EXTENSIONS_HREF, getActiveNavKey, HISTORY_HREF, INVENTORY_HREF, NEW_ANALYSIS_HREF, OVERVIEW_HREF } from "./nav";

export type SidebarProps = ShellData & { currentPath?: string };
type ContentsProps = SidebarProps & { currentPath: string; onNavigate?: () => void };
const focusClass = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function SidebarContents({ workspace, workspaces, monthlyCost, currentPath, onNavigate }: ContentsProps): JSX.Element {
  const { locale, t } = useI18n();
  const active = getActiveNavKey(currentPath);
  const groupId = useId();
  const groups = [
    { key: "build", title: t("shell.groups.build"), items: [
      { key: "new", label: t("shell.nav.newAnalysis"), href: NEW_ANALYSIS_HREF },
      { key: "history", label: t("shell.nav.history"), href: HISTORY_HREF },
    ] },
    { key: "assess", title: t("shell.groups.assess"), items: [
      { key: "inventory", label: t("shell.nav.inventory"), href: INVENTORY_HREF },
      { key: "assessments", label: t("shell.nav.assessments"), href: ASSESSMENTS_HREF },
      { key: "network", label: t("shell.nav.network"), href: NETWORK_HREF },
    ] },
    { key: "extend", title: t("shell.groups.extend"), items: [
      { key: "extensions", label: t("shell.nav.extensions"), href: EXTENSIONS_HREF },
    ] },
  ] as const;
  return (
    <>
      <details className="min-w-0">
        <summary className={`min-h-9 cursor-pointer rounded-lg border border-control px-2.5 py-2 ${focusClass}`}>
          <span className="block text-xs font-semibold text-subtle">{t("shell.workspace")}</span>
          <span className="block break-words text-[15px] font-semibold text-ink">{workspace.name}</span>
          {workspace.companyName && <span className="block break-words text-sm text-muted">{workspace.companyName}</span>}
        </summary>
        <div className="mt-2 flex flex-col gap-1">
          {workspaces.map(item => (
            <form key={item.id} action={selectWorkspace}>
              <input type="hidden" name="workspaceId" value={item.id} />
              <button type="submit" aria-current={workspace.id === item.id ? "true" : undefined} className={`min-h-9 w-full rounded-lg px-2.5 py-2 text-left text-sm text-body ${focusClass}`}>
                <span className="block break-words">{item.name}</span>
                {item.companyName && <span className="block break-words text-xs text-muted">{item.companyName}</span>}
              </button>
            </form>
          ))}
          <Link href="/workspaces" onClick={onNavigate} className={`min-h-6 px-2.5 py-2 text-sm text-ink underline underline-offset-4 ${focusClass}`}>{t("shell.manageWorkspaces")}</Link>
        </div>
      </details>
      <nav aria-label={t("shell.navigation")} className="flex flex-col gap-4">
        <Link href={OVERVIEW_HREF} onClick={onNavigate} aria-current={active === "overview" ? "page" : undefined} className={`min-h-9 rounded-lg px-2.5 py-2 text-sm ${focusClass} ${active === "overview" ? "bg-sidebar-active font-medium text-ink" : "text-muted"}`}>{t("shell.nav.overview")}</Link>
        {groups.map(group => (
          <div key={group.key} role="group" aria-labelledby={`${groupId}-${group.key}`} className="flex flex-col gap-0.5">
            <p id={`${groupId}-${group.key}`} className="px-2.5 text-xs font-semibold text-subtle">{group.title}</p>
            {group.items.map(item => (
              <Link key={item.key} href={item.href} onClick={onNavigate} aria-current={active === item.key ? "page" : undefined} className={`min-h-9 rounded-lg px-2.5 py-2 text-sm ${focusClass} ${active === item.key ? "bg-sidebar-active font-medium text-ink" : "text-muted"}`}>{item.label}</Link>
            ))}
          </div>
        ))}
        <Link href="/workspaces" onClick={onNavigate} aria-current={active === "workspaces" ? "page" : undefined} className={`min-h-9 rounded-lg px-2.5 py-2 text-sm ${focusClass} ${active === "workspaces" ? "bg-sidebar-active font-medium text-ink" : "text-muted"}`}>{t("shell.nav.workspaces")}</Link>
      </nav>
      <div className="mt-auto rounded-xl border border-hairline bg-surface-1 p-4">
        <p className="text-xs font-semibold text-subtle">{t("shell.cost.title")}</p>
        <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{formatMoney(monthlyCost.totalUsd, "USD", locale)}</p>
        <p className="mt-1 text-xs text-subtle">{t("shell.cost.estimate")}</p>
        {monthlyCost.uncountedCalls > 0 && <p className="mt-2 text-xs text-muted">{t("shell.cost.uncounted", { count: monthlyCost.uncountedCalls })}</p>}
      </div>
    </>
  );
}

export function Sidebar({ collapsed = false, onToggle, ...props }: SidebarProps & {
  collapsed?: boolean;
  onToggle?: () => void;
}): JSX.Element {
  const pathname = usePathname();
  const { t } = useI18n();
  const sidebarId = useId();
  const label = t(collapsed ? "shell.expandSidebar" : "shell.collapseSidebar");
  return (
    <aside className="sticky top-0 hidden h-dvh min-w-0 flex-col overflow-y-auto border-r border-hairline lg:flex">
      {onToggle && <button type="button" onClick={onToggle}
        aria-expanded={!collapsed} aria-controls={sidebarId} aria-label={label} title={label}
        className={`m-2 flex min-h-10 min-w-10 items-center gap-2 rounded-md px-2 text-sm text-muted hover:bg-surface-2 hover:text-ink ${focusClass}`}>
        <span aria-hidden="true" className="text-xl leading-none">{collapsed ? "»" : "«"}</span>
        {!collapsed && <span>{label}</span>}
      </button>}
      <div id={sidebarId} hidden={collapsed} className="flex min-h-0 grow flex-col gap-6 px-4 pb-5 pt-2">
        {!collapsed && <>
          <SidebarContents {...props} currentPath={props.currentPath ?? pathname ?? "/"} />
          <LocaleToggle />
        </>}
      </div>
    </aside>
  );
}
