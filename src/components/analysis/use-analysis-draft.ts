"use client";

import { useCallback } from "react";
import { DRAFT_STORAGE_PREFIX, parseDraft, serializeDraft, type AnalysisDraft } from "@/lib/form/draft";

export function useAnalysisDraft(draftKey: string | undefined): {
  read: () => AnalysisDraft | null;
  write: (draft: AnalysisDraft) => void;
  clear: () => void;
} {
  const read = useCallback(() => {
    if (!draftKey || typeof window === "undefined") return null;
    try { return parseDraft(window.sessionStorage.getItem(DRAFT_STORAGE_PREFIX + draftKey)); } catch { return null; }
  }, [draftKey]);
  const write = useCallback((draft: AnalysisDraft) => {
    if (!draftKey || typeof window === "undefined") return;
    try { window.sessionStorage.setItem(DRAFT_STORAGE_PREFIX + draftKey, serializeDraft(draft)); } catch { /* 저장 없이도 폼은 동작한다. */ }
  }, [draftKey]);
  const clear = useCallback(() => {
    if (!draftKey || typeof window === "undefined") return;
    try { window.sessionStorage.removeItem(DRAFT_STORAGE_PREFIX + draftKey); } catch { /* 저장소 접근 실패는 무시한다. */ }
  }, [draftKey]);
  return { read, write, clear };
}
