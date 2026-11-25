import Link from "next/link";
import { getI18n } from "@/i18n/server";
export default async function ExtensionNotFound() {
  const { t } = await getI18n();
  return <section className="space-y-5"><h1 className="text-2xl font-semibold text-ink">{t("extension.ui.notFound")}</h1><Link href="/extensions" className="inline-block min-h-6 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("extension.ui.history")}</Link></section>;
}
