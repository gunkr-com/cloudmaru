import Link from "next/link";
import { getI18n } from "@/i18n/server";
import { withSiteName } from "@/lib/dashboard/page-titles";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: withSiteName(t("inventory.titles.scanNotFound")) };
}

export default async function ScanNotFound() {
  const { t } = await getI18n();
  return <div className="space-y-5">
    <h1 className="text-[32px] font-bold leading-[1.18] tracking-[-0.8px] text-ink">{t("inventory.notFound.title")}</h1>
    <p className="text-sm leading-[1.7] text-body">{t("inventory.notFound.description")}</p>
    <Link href="/inventory" className="inline-flex min-h-10 items-center rounded-lg bg-ink px-[18px] text-sm font-semibold text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("inventory.connection.form.goToInventory")}</Link>
  </div>;
}
