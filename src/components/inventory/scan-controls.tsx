"use client";
import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { isMessageKey } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/messages/types";
import { scanApiErrorMessageKey } from "@/lib/scans/error-messages";
import { SCAN_BODY_MAX_BYTES } from "@/lib/scans/read-json-body";
import type { ScanApiErrorCode } from "@/types/scan";

export function ScanControls({ workspaceId, canRunScan, showImport = true, runLabel = "inventory.actions.runScan" }: { workspaceId: string; canRunScan: boolean; showImport?: boolean; runLabel?: "inventory.actions.runScan" | "common.retry" }) {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState<"live" | "import" | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);

  // 화면 이동을 시작했으면 true. 스캔 화면이 열릴 때까지 버튼을 잠가 같은 파일을 두 번 가져오지 않게 한다.
  async function send(source: "live" | "import", data?: unknown): Promise<boolean> {
    const response = await fetch("/api/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(source === "live" ? { workspaceId, source } : { workspaceId, source, data }),
    });
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) throw new Error();
    if (response.status === (source === "live" ? 202 : 201)) {
      if (!("id" in payload) || typeof payload.id !== "string" || !payload.id.trim()) throw new Error();
      router.push("/inventory/scans/" + encodeURIComponent(payload.id));
      return true;
    } else {
      if (response.ok) throw new Error();
      const code = "code" in payload ? payload.code : null;
      setError(typeof code === "string" && isMessageKey("inventory.errors.api." + code)
        ? scanApiErrorMessageKey(code as ScanApiErrorCode)
        : scanApiErrorMessageKey("internal"));
      return false;
    }
  }

  async function runScan() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setPending("live");
    let navigating = false;
    try { navigating = await send("live"); }
    catch { setError(scanApiErrorMessageKey("internal")); }
    finally { if (!navigating) { busy.current = false; setPending(null); } }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const field = event.currentTarget;
    const file = field.files?.[0];
    if (!file || busy.current) return;
    busy.current = true;
    setError(null);
    setPending("import");
    let navigating = false;
    try {
      if (file.size > SCAN_BODY_MAX_BYTES - 1024) {
        setError(scanApiErrorMessageKey("import-too-large"));
        return;
      }
      const text = await file.text();
      let data: unknown;
      try { data = JSON.parse(text); }
      catch { setError(scanApiErrorMessageKey("import-invalid")); return; }
      navigating = await send("import", data);
    } catch { setError(scanApiErrorMessageKey("internal")); }
    finally {
      field.value = "";
      if (!navigating) { busy.current = false; setPending(null); }
    }
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3">
      {canRunScan && <Button type="button" disabled={pending !== null} onClick={runScan}>{t(runLabel)}</Button>}
      {showImport && <>
        <Button type="button" variant={canRunScan ? "secondary" : "default"} disabled={pending !== null} onClick={() => input.current?.click()}>{t("inventory.actions.importFile")}</Button>
        <input ref={input} type="file" accept=".json,application/json" hidden disabled={pending !== null} onChange={importFile} />
      </>}
    </div>
    {pending && <p role="status" className="text-sm text-body">{t(pending === "live" ? "inventory.actions.starting" : "inventory.actions.importing")}</p>}
    {error && <p role="alert" className="text-sm leading-[1.7] text-warning">{t(error)}</p>}
    {showImport && <p className="text-[13px] leading-[1.7] text-subtle">{t("inventory.importHelp")}</p>}
  </div>;
}
