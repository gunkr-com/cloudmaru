"use client";

import { useI18n } from "@/i18n/provider";
import { LocaleToggle } from "./locale-toggle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type JSX } from "react";
import type { ShellData } from "@/types/shell";
import { SidebarContents } from "./sidebar";

export type MobileTopBarProps = ShellData & { currentPath?: string };

export function MobileTopBar(props: MobileTopBarProps): JSX.Element {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 메뉴가 숨으면 안의 포커스가 body로 빠지므로 메뉴 버튼으로 돌린다.
      if (menuRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="border-b border-hairline px-4 py-3 lg:hidden">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
        <Link href="/" className="w-fit rounded text-base font-semibold tracking-tight text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("common.siteName")}</Link>
        <button ref={triggerRef} type="button" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)} className="min-h-9 justify-self-end rounded-lg bg-surface-2 px-3 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("shell.menu")}</button>
        <span className="min-w-0 break-words text-sm leading-snug text-muted [overflow-wrap:anywhere]">{props.workspace.name}</span>
        <LocaleToggle />
      </div>
      <div ref={menuRef} id={menuId} hidden={!open} className="mt-4 flex flex-col gap-5"><SidebarContents {...props} currentPath={props.currentPath ?? pathname ?? "/"} onNavigate={() => setOpen(false)} /></div>
    </header>
  );
}
