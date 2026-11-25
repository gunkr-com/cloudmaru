import Link from "next/link";
import { getI18n } from "@/i18n/server";

// 앱 틀(<main id="main">) 안에서 그려지므로 루트 not-found와 달리 랜드마크를 따로 두지 않는다.
export default async function ConnectionNotFound() {
  const { t } = await getI18n();
  return <div className="space-y-5">
    <h1 className="text-[32px] font-bold leading-[1.18] tracking-[-0.8px] text-ink">{t("common.pageNotFound")}</h1>
    <p className="text-sm leading-[1.7] text-body">{t("common.pageNotFoundHelp")}</p>
    <Link href="/workspaces" className="inline-flex min-h-10 items-center rounded-lg bg-ink px-[18px] text-sm font-semibold text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{t("inventory.connection.form.backToWorkspaces")}</Link>
  </div>;
}
