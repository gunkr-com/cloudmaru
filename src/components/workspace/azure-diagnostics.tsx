"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/messages/types";
import type { AzureDiagnostic, AzureDiagnosticStatus, AzureTestFormState } from "@/types/setup";
const messages = {
 missing:"setup.azureMissing", subscriptionsMissing:"setup.subscriptionsMissing",ready:"setup.azureReady",expiring:"setup.expiring",verified:"setup.azureVerified",
 forbidden:"setup.forbidden",subscriptionMissing:"setup.subscriptionMissing",unreachable:"setup.unreachable",
 "certificate-not-found":"setup.certificateMissing","certificate-invalid":"setup.certificateInvalid","certificate-expired":"setup.certificateExpired",
 "certificate-password-missing":"setup.passwordMissing","auth-failed":"setup.authFailed",
} as const satisfies Record<AzureDiagnosticStatus, MessageKey>;
export function AzureDiagnostics({workspaceId,initial,action}:{workspaceId:string;initial:AzureDiagnostic;action:(state:AzureTestFormState,data:FormData)=>Promise<AzureTestFormState>}) {
 const {t} = useI18n(); const [state,submit,pending] = useActionState(action, {});
 return <section className="space-y-3 rounded-xl border border-hairline bg-surface-1 p-6 text-sm text-body">
  <p>{t(messages[initial.status])}</p>
  {initial.validTo && <p className="text-xs text-muted"><LocalTime value={initial.validTo} format="date"/></p>}
  <p className="text-xs leading-relaxed text-muted">{t("setup.azureTestHelp")}</p>
  <form action={submit} aria-busy={pending}><input type="hidden" name="workspaceId" value={workspaceId}/><Button className="max-w-full whitespace-normal text-left" disabled={pending} variant="secondary" type="submit">{t("setup.azureTest")}</Button></form>
  {pending && <p role="status">{t("setup.testing")}</p>}
  {state.result && !pending && <p role="status">{t(messages[state.result.status])}</p>}
  {state.checkedAt && <p className="text-xs text-muted">{t("setup.checkedAt")}: <LocalTime value={state.checkedAt} format="datetime"/></p>}
 </section>;
}
