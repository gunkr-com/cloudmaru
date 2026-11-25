import { getI18n } from "@/i18n/server";
export default async function LoadingExtensions() {
  const { t } = await getI18n();
  return <p role="status">{t("extension.ui.loading")}</p>;
}
