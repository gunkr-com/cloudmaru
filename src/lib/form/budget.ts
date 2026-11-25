/** 숫자와 쉼표로만 된 입력은 천 단위 쉼표로 정리한다. */
export function formatBudgetInput(raw: string): string {
  if (raw === "" || !/^[\d,]+$/.test(raw)) return raw;
  const value = Number(raw.replaceAll(",", ""));
  if (!Number.isFinite(value)) return raw;
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(value);
}

/** 쉼표와 앞뒤 공백만 제거해 숫자로 변환한다. 빈 문자열은 NaN이다. */
export function parseBudgetInput(raw: string): number {
  const cleaned = raw.replaceAll(",", "").trim();
  return cleaned === "" ? Number.NaN : Number(cleaned);
}

/** 쉼표를 다시 정리한 뒤에도 커서 왼쪽의 숫자 개수가 같도록 커서 위치를 계산한다. 앞자리 0은 정리하면서 사라지므로 세지 않는다. */
export function getFormattedBudgetCaret(raw: string, caret: number): number {
  const formatted = formatBudgetInput(raw);
  if (formatted === raw) return caret;
  const digits = raw.replaceAll(",", "");
  const leadingZeros = digits.length - digits.replace(/^0+(?=\d)/, "").length;
  let remaining = Math.max(0, raw.slice(0, caret).replaceAll(",", "").length - leadingZeros);
  if (remaining === 0) return 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (formatted[index] !== "," && --remaining === 0) return index + 1;
  }
  return formatted.length;
}
