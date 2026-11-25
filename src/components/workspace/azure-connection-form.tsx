"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/provider";
import { connectionFieldErrorKey } from "@/lib/scans/error-messages";
import type { AzureConnectionField, AzureConnectionFormState, WorkspaceAzureSettings } from "@/types/scan";

type Props = {
  workspaceId: string;
  settings?: WorkspaceAzureSettings | null;
  action: (prev: AzureConnectionFormState, formData: FormData) => Promise<AzureConnectionFormState>;
};
const fields = [
  { name: "tenantId", label: "tenantId" },
  { name: "clientId", label: "clientId" },
  { name: "certificatePath", label: "certificatePath", help: "certificatePathHelp" },
  { name: "certificatePasswordEnv", label: "passwordEnv", help: "passwordEnvHelp" },
  { name: "subscriptionIds", label: "subscriptionIds", help: "subscriptionIdsHelp" },
] as const;

export function AzureConnectionForm({ workspaceId, settings, action }: Props) {
  const { t } = useI18n();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Record<AzureConnectionField, string>>({
    tenantId: settings?.connection?.tenantId ?? "", clientId: settings?.connection?.clientId ?? "",
    certificatePath: settings?.connection?.certificatePath ?? "", certificatePasswordEnv: settings?.connection?.certificatePasswordEnv ?? "",
    subscriptionIds: settings?.subscriptionIds.join("\n") ?? "",
  });
  const [state, formAction, pending] = useActionState(action, {});
  useEffect(() => {
    const first = fields.find(field => state.errors?.[field.name]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first.name}"]`)?.focus();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} noValidate aria-busy={pending} className="min-w-0 space-y-5 rounded-xl border border-hairline bg-surface-1 p-6 text-sm text-body">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      {state.message && <p role="alert" className="text-warning">{t("inventory.connection.form.errors.save")}</p>}
      {fields.map(field => {
        const error = state.errors?.[field.name];
        const help = "help" in field ? field.help : undefined;
        const props = {
          id: `${id}-${field.name}`, name: field.name, value: values[field.name], disabled: pending,
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues(previous => ({ ...previous, [field.name]: event.target.value })),
          "aria-invalid": !!error,
          "aria-describedby": [help && `${id}-${field.name}-help`, error && `${id}-${field.name}-error`].filter(Boolean).join(" ") || undefined,
          autoComplete: "off", spellCheck: false, className: "font-mono",
          required: field.name !== "certificatePasswordEnv",
        };
        return <div key={field.name} className="space-y-2">
          <Label htmlFor={props.id}>{t(`inventory.connection.form.${field.label}`)}</Label>
          {help && <p id={`${id}-${field.name}-help`} className="text-[13px] leading-[1.7] text-subtle">{t(`inventory.connection.form.${help}`)}</p>}
          {field.name === "subscriptionIds" ? <Textarea {...props} rows={5} /> : <Input {...props} />}
          {error && <p id={`${id}-${field.name}-error`} className="text-[13px] text-warning">{t(connectionFieldErrorKey(error))}</p>}
        </div>;
      })}
      <Button type="submit" disabled={pending}>{t("inventory.connection.form.save")}</Button>
      <p role="status" className={pending ? "text-[13px] text-muted" : "sr-only"}>{pending ? t("inventory.connection.form.saving") : ""}</p>
    </form>
  );
}
