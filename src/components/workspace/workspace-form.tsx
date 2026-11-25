"use client";

import { useI18n } from "@/i18n/provider";
import { isMessageKey } from "@/i18n/translate";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_REGION, isSupportedRegion, SUPPORTED_REGIONS } from "@/lib/workspace/regions";
import type { Workspace, WorkspaceFormState } from "@/types/workspace";

type Props = {
  action: (prev: WorkspaceFormState, formData: FormData) => Promise<WorkspaceFormState>;
  workspace?: Pick<Workspace, "id" | "name" | "companyName" | "defaultRegion">;
};
const fields = ["name", "companyName", "defaultRegion"] as const;

export function WorkspaceForm({ action, workspace }: Props) {
  const { t } = useI18n();
  const translateError = (value: string) => t(isMessageKey(value) ? value : "workspace.errors.save");
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({
    name: workspace?.name ?? "",
    companyName: workspace?.companyName ?? "",
    // 지원 목록에서 빠진 지역(예: M1의 canadaeast)은 빈 선택이 되지 않게 기본 지역으로 바꿔 보인다.
    defaultRegion: workspace?.defaultRegion && isSupportedRegion(workspace.defaultRegion) ? workspace.defaultRegion : DEFAULT_REGION,
  });
  const [state, formAction, pending] = useActionState(action, {});
  useEffect(() => {
    const first = fields.find(field => state.errors?.[field]?.length);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }, [state]);

  function fieldProps(field: typeof fields[number]) {
    return {
      id: `${id}-${field}`,
      name: field,
      value: values[field],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues(previous => ({ ...previous, [field]: event.target.value })),
      disabled: pending,
      "aria-invalid": !!state.errors?.[field]?.length,
      "aria-describedby": state.errors?.[field]?.length ? `${id}-${field}-error` : undefined,
    };
  }
  function error(field: typeof fields[number]) {
    return state.errors?.[field]?.length ? <p id={`${id}-${field}-error`} className="text-[13px] text-warning">{translateError(state.errors[field]![0])}</p> : null;
  }
  return (
    <form ref={formRef} action={formAction} noValidate aria-busy={pending} className="space-y-5 rounded-xl border border-hairline bg-surface-1 p-6 text-sm text-body">
      {workspace && <input type="hidden" name="workspaceId" value={workspace.id} />}
      {state.message && <p role="alert" className="text-warning">{translateError(state.message)}</p>}
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`}>{t("workspace.requiredName")}</Label>
        <Input {...fieldProps("name")} required />
        {error("name")}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-companyName`}>{t("workspace.companyName")}</Label>
        <Input {...fieldProps("companyName")} />
        {error("companyName")}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-defaultRegion`}>{t("workspace.defaultRegion")}</Label>
        <select {...fieldProps("defaultRegion")} className="w-full min-w-0 rounded-md border border-border-control bg-canvas p-3.5 text-sm text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-invalid:border-warning">
          {SUPPORTED_REGIONS.map(region => <option key={region.id} value={region.id}>{region.label}</option>)}
        </select>
        {error("defaultRegion")}
      </div>
      <Button type="submit" variant={workspace ? "secondary" : "default"} disabled={pending}>{workspace ? t("workspace.save") : t("workspace.create")}</Button>
      <p role="status" className={pending ? "text-[13px] text-muted" : "sr-only"}>{pending ? t("workspace.saving") : ""}</p>
    </form>
  );
}
