import { getI18n } from "@/i18n/server";
import type { JSX } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { withSiteName } from "@/lib/dashboard/page-titles";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: withSiteName(t("shell.titles.notFound")) };
}

// 맞는 경로가 없는 주소와, 자기 not-found가 없는 세그먼트의 notFound()가 여기로 온다.
// 루트 레이아웃 안에서만 그려지므로(앱 레이아웃 없이) 랜드마크와 화면 높이를 직접 잡는다.
export default async function NotFound(): Promise<JSX.Element> {
  const { t } = await getI18n();
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6 py-12">
      <section className="space-y-3">
        <h1 className="text-[32px] leading-[1.18] font-bold tracking-[-0.8px] text-ink text-pretty">{t("common.pageNotFound")}</h1>
        <p className="text-sm leading-[1.7] text-body">{t("common.pageNotFoundHelp")}</p>
      </section>
      <div className="flex flex-wrap items-center gap-5">
        <Link href="/analyses/new" className="inline-flex min-h-10 items-center rounded-lg bg-ink px-[18px] text-sm font-semibold text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("common.newAnalysis")}</Link>
      </div>
    </main>
  );
}
