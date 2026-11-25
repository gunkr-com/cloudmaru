"use client";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";
export default function ExtensionError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useI18n();
  return <section className="space-y-5"><h1 role="alert" className="text-2xl font-semibold text-ink">{t("extension.ui.loadError")}</h1><div className="flex flex-wrap gap-4"><button type="button" onClick={retry} className="min-h-10 rounded-lg bg-ink px-4 py-2 text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("common.retry")}</button><Link href="/extensions" className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("extension.ui.history")}</Link></div></section>;
}
