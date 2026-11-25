"use client";
import { useActionState, useId, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocalTime } from "@/components/ui/local-time";
import type { MessageKey } from "@/i18n/messages/types";
import type { ClaudeOverview, ClaudeTestStatus, SetupFormState } from "@/types/setup";
const testMessages = {
 verified: "setup.verified", unauthorized: "setup.unauthorized", modelUnavailable: "setup.modelUnavailable", modelMissing: "setup.modelMissing",
 rateLimited: "setup.rateLimited", unreachable: "setup.unreachable", disabled: "setup.disabled",
} as const satisfies Record<ClaudeTestStatus, MessageKey>;
type Action = (previous: SetupFormState, data: FormData) => Promise<SetupFormState>;
export function SetupClaudeForm({workspaceId, overview, action, testAction}: {workspaceId:string;overview:ClaudeOverview;action:Action;testAction:Action}) {
 const {t} = useI18n(), id = useId();
 const [key, setKey] = useState("");
 const [testEpoch, setTestEpoch] = useState(0);
 const [state, submit, pending] = useActionState(async (previous: SetupFormState, data: FormData) => {
  try { return await action(previous, data); } finally { setKey(""); }
 }, {});
 const [source, setSource] = useState<ClaudeOverview["source"]>(overview.needsSetup ? "key" : overview.source);
 const [edited, setEdited] = useState(false);
 return <div className="space-y-6">
  <p className="text-sm text-muted">{t(overview.available ? "setup.available" : "setup.unavailable")}</p>
  <form action={submit} aria-busy={pending} onChange={()=>setEdited(true)} onSubmit={()=>{setEdited(false);setTestEpoch(value=>value+1);}} className="space-y-5 rounded-xl border border-hairline bg-surface-1 p-6 text-sm text-body">
   <input type="hidden" name="workspaceId" value={workspaceId}/>
   <div className="space-y-2"><Label htmlFor={`${id}-source`}>{t("setup.source")}</Label>
    <select id={`${id}-source`} name="source" value={source} onChange={event=>{setSource(event.target.value as typeof source);setKey("");}} className="min-h-10 w-full rounded-md border border-control bg-surface-1 px-3 text-ink">
     <option value="key">{t("setup.keySource")}</option><option value="env">{t("setup.envSource")}</option><option value="disabled">{t("setup.disabledSource")}</option>
    </select>
   </div>
   {source === "key" && <div className="space-y-2"><Label htmlFor={`${id}-key`}>{t("setup.apiKey")}</Label>
    <Input id={`${id}-key`} name="apiKey" type="password" disabled={pending} value={key} onChange={event=>setKey(event.target.value)} autoComplete="new-password" spellCheck={false} maxLength={4096} aria-describedby={`${id}-key-help`}/>
    <p id={`${id}-key-help`} className="text-xs text-muted">{t("setup.keyHelp")}</p>
   </div>}
   {source === "env" && <div className="space-y-2"><Label htmlFor={`${id}-env`}>{t("setup.envLabel")}</Label>
    <Input id={`${id}-env`} name="apiKeyEnv" defaultValue={overview.apiKeyEnv ?? ""} autoComplete="off" spellCheck={false} aria-describedby={`${id}-env-help`}/>
    <p id={`${id}-env-help`} className="text-xs text-muted">{t("setup.envHelp")}</p>
   </div>}
   {source !== "disabled" && <div className="space-y-2"><Label htmlFor={`${id}-model`}>{t("setup.model")}</Label>
    <Input id={`${id}-model`} name="model" defaultValue={overview.model || "claude-opus-5-5"} autoComplete="off" spellCheck={false} aria-describedby={`${id}-model-help`}/>
    <p id={`${id}-model-help`} className="text-xs text-muted">{t("setup.modelHelp")}</p>
   </div>}
   <div className="flex flex-wrap gap-3"><Button className="max-w-full whitespace-normal text-left" disabled={pending} type="submit">{t("setup.save")}</Button><Button className="max-w-full whitespace-normal text-left" disabled={pending} name="intent" value="disable" type="submit" variant="secondary">{t("setup.disable")}</Button></div>
   <p className="text-xs leading-relaxed text-muted">{t("setup.disableHelp")}</p>
   {!edited && state.error && <p role="alert" className="text-warning">{t(state.error)}</p>}
   {!edited && state.saved && <p role="status">{t("setup.saved")}</p>}
  </form>
  <ClaudeCredentialTest key={testEpoch} workspaceId={workspaceId} action={testAction} disabled={pending}/>
 </div>;
}

function ClaudeCredentialTest({workspaceId,action,disabled}:{workspaceId:string;action:Action;disabled:boolean}) {
 const {t} = useI18n();
 const [testState,test,testing] = useActionState(action, {});
 return (
  <form action={test} aria-busy={testing} className="space-y-3 text-sm text-body">
   <input type="hidden" name="workspaceId" value={workspaceId}/>
   <p className="text-xs leading-relaxed text-muted">{t("setup.testHelp")}</p>
   <Button className="max-w-full whitespace-normal text-left" disabled={testing || disabled} variant="secondary" type="submit">{t("setup.test")}</Button>
   <p role={testState.test || testState.error ? "status" : undefined}>{t(testing ? "setup.testing" : testState.error ?? (testState.test ? testMessages[testState.test] : "setup.notTested"))}</p>
   {testState.checkedAt && <p className="text-xs text-muted">{t("setup.checkedAt")}: <LocalTime value={testState.checkedAt} format="datetime"/></p>}
  </form>
 );
}
