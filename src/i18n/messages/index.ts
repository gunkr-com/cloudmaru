import type { Locale } from "@/types/i18n";
import type { Messages } from "./types";
import { en } from "./en";
import { ko } from "./ko";
export const MESSAGES: Record<Locale, Messages> = { en, ko };
