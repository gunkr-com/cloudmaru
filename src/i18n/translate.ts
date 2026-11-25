import type { Locale, LocalizedText } from "@/types/i18n";
import { MESSAGES } from "./messages";
import type { MessageKey } from "./messages/types";
export type TranslateParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: TranslateParams) => string;
function lookup(root: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) =>
    typeof value === "object" && value !== null && Object.hasOwn(value, part)
      ? (value as Record<string, unknown>)[part] : undefined, root);
}
export function createTranslator(locale: Locale): Translate {
  return (key, params = {}) => {
    const message = lookup(MESSAGES[locale], key);
    if (typeof message !== "string") throw new Error(`Unknown message key: ${key}`);
    return message.replace(/\{([^{}]+)\}/g, (placeholder, name: string) => Object.hasOwn(params, name) ? String(params[name]) : placeholder);
  };
}
export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === "string" && typeof lookup(MESSAGES.en, value) === "string";
}
export function pickText(text: LocalizedText, locale: Locale): string { return text[locale]; }
/** 영어는 수가 1일 때 단수 문장이 따로 필요하다. 한국어 사전의 단수 키는 기본 키와 같은 문장이다. 호출하는 곳에 두 키를 모두 적어 미사용 키 검사가 찾게 한다. */
export function pluralKey<K extends MessageKey>(count: number, one: K, other: K): K { return count === 1 ? one : other; }
