import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@/types/i18n";
import { I18nProvider } from "@/i18n/provider";
export function renderWithI18n(ui: ReactElement, { locale = "ko" }: { locale?: Locale } = {}) {
  return render(ui, { wrapper: ({ children }: { children: ReactNode }) => <I18nProvider locale={locale}>{children}</I18nProvider> });
}
