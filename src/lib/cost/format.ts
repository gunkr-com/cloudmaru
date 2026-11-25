import type { Locale, LocalizedText } from "@/types/i18n";
import type { CostLine } from "@/types/cost";
import { createTranslator, pickText } from "@/i18n/translate";
const integerFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

export function formatBudgetRatio(ratio: number): string {
  // 반올림은 Math.round로 먼저 하고, 금액처럼 천 단위 쉼표만 붙인다.
  return `${integerFormatter.format(Math.round(ratio * 100))}%`;
}

// 모델이 고른 소수 수량(0.25 등)도 자르지 않고 그대로 보여 준다.
const quantityFormatter = new Intl.NumberFormat("ko-KR", { maximumSignificantDigits: 21 });

export function formatQuantityNumber(quantity: number): string {
  return quantityFormatter.format(quantity);
}

// 구성 서비스 카드와 비용 내역이 같은 표기를 쓴다. 단위는 "1대", "10만 건", "100GB"처럼 붙인다.
// 숫자로 시작하는 단위(예전 결과의 "10회")는 붙이면 다른 숫자로 읽히므로 곱셈 기호로 나누고,
// "상시 실행 vCPU"처럼 설명이 앞에 오는 단위는 띄어 쓴다. "만 건", "백만 RU"는 단위로 보고 붙인다.
export function formatQuantity(quantity: number, unit: LocalizedText, locale: Locale): string {
  const unitLabel = pickText(unit, locale);
  const number = formatQuantityNumber(quantity);
  if (/^\d/.test(unitLabel)) return `${number} × ${unitLabel}`;
  if (locale === "en") return `${number} ${unitLabel}`;
  if (/\s/.test(unitLabel) && !/^[십백천만억]+\s/.test(unitLabel)) return `${number} ${unitLabel}`;
  return `${number}${unitLabel}`;
}

export function formatCostNote(line: CostLine, locale: Locale): string {
  const t = createTranslator(locale);
  if (line.assumptionLabel) return t("analysis.costAssumption", { value: pickText(line.assumptionLabel, locale).replaceAll("{quantity}", formatQuantityNumber(line.quantity)) });
  if (line.hourly) return `${formatQuantity(line.quantity, line.unitLabel, locale)} · ${t("analysis.costHours")}`;
  if (line.amount === 0) return t("analysis.costFree");
  return formatQuantity(line.quantity, line.unitLabel, locale);
}
