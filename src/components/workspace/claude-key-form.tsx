"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/provider";
import type { ClaudeKeyFormState } from "@/types/workspace-claude";

type Props = {
  workspaceId: string;
  apiKeyEnv: string | null;
  action: (prev: ClaudeKeyFormState, data: FormData) => Promise<ClaudeKeyFormState>;
};
export function ClaudeKeyForm({ workspaceId, apiKeyEnv, action }: Props) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(apiKeyEnv ?? "");
  const [state, formAction, pending] = useActionState(action, {});
  const [dismissedSuccess, setDismissedSuccess] = useState<ClaudeKeyFormState>();
  const [showError, setShowError] = useState(true);
  const error = showError ? state.error : undefined;
  useEffect(() => { if (state.error) input.current?.focus(); }, [state]);
  return (
    <form action={formAction} onSubmit={() => { setShowError(true); setDismissedSuccess(state); }} noValidate aria-busy={pending} className="space-y-5 rounded-xl border border-hairline bg-surface-1 p-6 text-sm text-body">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="space-y-2">
        <Label htmlFor={id}>{t("workspace.claude.label")}</Label>
        <Input id={id} ref={input} name="apiKeyEnv" autoComplete="off" spellCheck={false} value={value}
          onChange={event => { setValue(event.target.value); setShowError(false); setDismissedSuccess(state); }}
          aria-invalid={Boolean(error)} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} />
        <p id={`${id}-help`} className="text-xs leading-relaxed text-muted">{t("workspace.claude.help")}</p>
        {error && <p id={`${id}-error`} role="alert" className="text-sm text-warning">{t(error)}</p>}
      </div>
      <Button type="submit" disabled={pending}>{t("workspace.save")}</Button>
      {state.saved && state !== dismissedSuccess && !state.error && !pending && <p role="status" className="text-sm text-body">{t("workspace.claude.saved")}</p>}
      {pending && <p role="status" className="text-xs text-muted">{t("workspace.saving")}</p>}
    </form>
  );
}
