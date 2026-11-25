"use client";

import { useI18n } from "@/i18n/provider";
import { useState, type JSX, type ReactNode } from "react";
import { MobileTopBar } from "./mobile-top-bar";
import { Sidebar } from "./sidebar";
import type { ShellData } from "@/types/shell";

export type DashboardShellProps = ShellData & { children: ReactNode };

export function DashboardShell({ children, ...data }: DashboardShellProps): JSX.Element {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div data-sidebar-collapsed={collapsed} className={`min-h-screen lg:grid ${collapsed ? "lg:grid-cols-[56px_minmax(0,1fr)]" : "lg:grid-cols-[220px_minmax(0,1fr)]"}`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-canvas">{t("shell.skipToContent")}</a>
      <Sidebar {...data} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} />
      <div className="min-w-0">
        <MobileTopBar {...data} />
        <main id="main" className="mx-auto w-full max-w-[1680px] px-4 py-7 sm:px-6 lg:px-10 lg:pb-12">{children}</main>
      </div>
    </div>
  );
}
