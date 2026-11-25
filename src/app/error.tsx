"use client";

import { useI18n } from "@/i18n/provider";
import Link from "next/link";
import type { JSX } from "react";

// 세그먼트의 error.tsx는 같은 세그먼트의 layout.tsx를 감싸지 못한다. (app) 레이아웃의 비용 조회 실패 같은 오류는 여기서 받는다.
export default function AppError({ retry }: { error: Error & { digest?: string }; retry: () => void }): JSX.Element {
  const { t } = useI18n();
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6 py-12">
      <section role="alert" className="space-y-3">
        <h1 className="text-2xl font-semibold text-ink">{t("common.loadError")}</h1>
        <p className="text-sm leading-relaxed text-muted">{t("common.loadErrorHelp")}</p>
      </section>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={retry} className="min-h-10 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("common.retry")}</button>
        <Link href="/analyses/new" className="text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("common.newAnalysis")}</Link>
      </div>
    </main>
  );
}
