import { networkEngineResultSchema, networkReasonCodeSchema } from "@/lib/completion/schema";
import { createTranslator } from "@/i18n/translate";
import type { NetworkDiagnostic } from "@/types/network-diagnostics";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { ids, resourceIds, networkDiagnostic } from "@/lib/completion/fixtures.test-data";
import { NetworkForm, NetworkResult, NetworkPending } from "./network-ui";
const { push, refresh } = vi.hoisted(() => ({push: vi.fn(), refresh: vi.fn()}));
vi.mock("next/navigation", () => ({useRouter: () => ({push, refresh})}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const resources = [{id: resourceIds.vm, name: "Fixture VM", type: "microsoft.compute/virtualmachines"}, {id: resourceIds.storage, name: "Fixture Storage", type: "microsoft.storage/storageaccounts"}];
const props = {workspaceId: ids.workspace, sourceScanId: ids.scan, resources};
function setup(locale: "en" | "ko" = "en") { return render(<I18nProvider locale={locale}><NetworkForm {...props}/></I18nProvider>); }
it.each(["en", "ko"] as const)("explains the inventory limit in %s without blaming the path input", async locale => {
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,json:async()=>({code:"inventory-too-large"})}));
 render(<I18nProvider locale={locale}><NetworkForm {...props} initialQuery={networkDiagnostic.query}/></I18nProvider>);
 await userEvent.click(screen.getByRole("button",{name:locale === "en" ? "Check path" : "경로 확인"}));
 await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("2,000"));
});
it("validates first field, clears on edit, filters a native keyboard select and posts the explicit saved scan without keys", async () => {
 const fetcher = vi.fn().mockResolvedValue({ok:true, json:async()=>({id:ids.network})}); vi.stubGlobal("fetch",fetcher);
 setup(); const user = userEvent.setup();
 await user.click(screen.getByRole("button",{name:"Check path"}));
 expect(screen.getByLabelText("Source resource")).toHaveFocus();
 expect(fetcher).not.toHaveBeenCalled();
 await user.selectOptions(screen.getByLabelText("Source resource"),resources[0].id);
 expect(screen.getByLabelText("Source resource")).not.toHaveAttribute("aria-invalid","true");
 await user.type(screen.getByLabelText("Filter destination resources"),"Storage");
 expect(screen.getByLabelText("Destination resource").querySelectorAll("option")).toHaveLength(2);
 await user.selectOptions(screen.getByLabelText("Destination resource"),resources[1].id);
 await user.type(screen.getByLabelText("Destination port"),"443");
 fireEvent.keyDown(screen.getByLabelText("Destination port"),{key:"Enter",ctrlKey:true});
 await waitFor(()=>expect(push).toHaveBeenCalledWith(`/network/${ids.network}`));
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({schemaVersion:1, workspaceId:ids.workspace, sourceScanId:ids.scan,query:{sourceScanId:ids.scan,sourceResourceId:resources[0].id,destinationResourceId:resources[1].id,protocol:"tcp",sourcePort:null,destinationPort:443}});
});
it("preserves input and focuses coded changed-cookie errors, then clears on edit",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,json:async()=>({code:"workspace-changed"})})); setup();
 fireEvent.change(screen.getByLabelText("Source resource"),{target:{value:resources[0].id}});
 fireEvent.change(screen.getByLabelText("Destination resource"),{target:{value:resources[1].id}});
 fireEvent.change(screen.getByLabelText("Protocol"),{target:{value:"icmp"}});
 await userEvent.click(screen.getByRole("button",{name:"Check path"}));
 await waitFor(()=>expect(screen.getByRole("alert")).toHaveFocus());
 expect(screen.getByRole("alert")).toHaveTextContent("workspace changed");
 expect(screen.getByLabelText("Source resource")).toHaveValue(resources[0].id);
 fireEvent.change(screen.getByLabelText("Protocol"),{target:{value:"any"}});
 expect(screen.queryByRole("alert")).toBeNull();
});
it("renders Korean native fields and empty inventory",()=>{
 const view=setup("ko"); expect(screen.getByLabelText("출발 리소스").tagName).toBe("SELECT"); view.unmount();
 render(<I18nProvider locale="en"><NetworkForm {...props} resources={[]}/></I18nProvider>);
 expect(screen.getByText(/no resources/i)).toBeInTheDocument(); expect(screen.queryByRole("button")).toBeNull();
});
it("renders saved unknown reasons without raw engine prose in either language",()=>{
 const view=render(<I18nProvider locale="en"><NetworkResult diagnostic={networkDiagnostic}/></I18nProvider>);
 expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0); expect(screen.queryByText("unsupported-path")).toBeNull(); view.unmount();
 render(<I18nProvider locale="ko"><NetworkResult diagnostic={networkDiagnostic}/></I18nProvider>);
 expect(screen.getAllByText("알 수 없음").length).toBeGreaterThan(0);
});
it("polls pending locally and cleans up",()=>{
 vi.useFakeTimers(); const view=render(<I18nProvider locale="en"><NetworkPending/></I18nProvider>);
 expect(screen.getByRole("status")).toHaveTextContent("Checking path");
 vi.advanceTimersByTime(3000); expect(refresh).toHaveBeenCalledTimes(1); view.unmount(); vi.advanceTimersByTime(3000); expect(refresh).toHaveBeenCalledTimes(1); vi.useRealTimers();
});
it("keeps ordered hop evidence localized and masks secret evidence defensively",()=>{
 const diagnostic: NetworkDiagnostic=structuredClone(networkDiagnostic);
 diagnostic.engine.paths=[{verdict:"unknown",reasonCodes:["route-next-hop-virtual-appliance"],hops:[{resourceId:resourceIds.nsg,hopType:"nsg",verdict:"unknown",reasonCodes:["nsg-rules-not-collected"],evidence:[{resourceId:resourceIds.nsg,propertyPath:"/properties/password",observation:{state:"present",value:"fixture-secret-value"}},{resourceId:resourceIds.nsg,propertyPath:"/properties/securityRules",observation:{state:"missing"}}]}]}];
 const {container}=render(<I18nProvider locale="ko"><NetworkResult diagnostic={diagnostic}/></I18nProvider>);
 expect(screen.getByText(/NSG 규칙이 수집되지/)).toBeInTheDocument();
 expect(screen.getByText("수집되지 않음")).toBeInTheDocument();
 expect(container.textContent).not.toContain("fixture-secret-value");
 expect(container.textContent).not.toContain("route-next-hop-virtual-appliance");
});
it("native controls remain in keyboard order and protocol changes omit ports",async()=>{
 setup(); const user=userEvent.setup();
 await user.tab();expect(screen.getByLabelText("Filter source resources")).toHaveFocus();
 await user.tab();expect(screen.getByLabelText("Source resource")).toHaveFocus();
 await user.selectOptions(screen.getByLabelText("Protocol"),"icmp");
 expect(screen.queryByLabelText("Destination port")).toBeNull();
});
it.each(["en", "ko"] as const)("renders decisive hop evidence and reasons through the %s dictionary", locale => {
 const diagnostic: NetworkDiagnostic = structuredClone(networkDiagnostic);
 diagnostic.engine.verdict = "allowed";
 diagnostic.engine.reasonCodes = ["single-candidate"];
 diagnostic.engine.paths = [{verdict:"allowed",reasonCodes:[],hops:[{
  resourceId:resourceIds.nsg,hopType:"nsg",verdict:"allowed",reasonCodes:["nsg-rule-decisive-allow"],
  evidence:[{resourceId:resourceIds.nsg,propertyPath:"/properties/securityRules/0/properties/access",observation:{state:"present",value:"Allow"}}],
 }]}];
 const {container} = render(<I18nProvider locale={locale}><NetworkResult diagnostic={diagnostic}/></I18nProvider>);
 expect(screen.getAllByText(locale === "en" ? "Allowed" : "허용").length).toBeGreaterThan(0);
 expect(screen.getByText(locale === "en" ? "Evidence" : "근거")).toBeInTheDocument();
 expect(container.textContent).toContain("/properties/securityRules/0/properties/access");
 expect(container.textContent).toContain('"Allow"');
 expect(container.textContent).not.toMatch(/network\.(reasons|verdict|hopTypes)\./);
 expect(container.textContent).not.toContain("nsg-rule-decisive-allow");
});

it.each(["en", "ko"] as const)("renders the validated reason and hop-type domains in %s", locale => {
 const diagnostic: NetworkDiagnostic = structuredClone(networkDiagnostic);
 diagnostic.engine.reasonCodes = [...networkReasonCodeSchema.options];
 diagnostic.engine.paths = [{verdict:"unknown",reasonCodes:["missing-data"],hops:
  networkEngineResultSchema.shape.paths.element.shape.hops.element.shape.hopType.options.map(hopType => ({
   resourceId:resourceIds.nsg,hopType,verdict:"unknown" as const,reasonCodes:["missing-data" as const],evidence:[],
  }))}];
 const {container}=render(<I18nProvider locale={locale}><NetworkResult diagnostic={diagnostic}/></I18nProvider>);
 const t=createTranslator(locale);
 for(const code of networkReasonCodeSchema.options)expect(container.textContent).toContain(t(`network.reasons.${code}`));
 for(const hop of diagnostic.engine.paths[0].hops)expect(container.textContent).toContain(t(`network.hopTypes.${hop.hopType}`));
 expect(container.textContent).not.toMatch(/network\.(reasons|hopTypes|verdict)\./);
});

it("adds saved-hop exploration without removing the ordered original path evidence",()=>{
 window.history.replaceState(null,"","/");
 render(<I18nProvider locale="en"><NetworkResult diagnostic={networkDiagnostic}/></I18nProvider>);
 expect(screen.getByRole("table",{name:"Explore path observations"})).toBeInTheDocument();
 expect(screen.getByText(/Saved static observations only/)).toBeInTheDocument();
 expect(screen.getByRole("heading",{name:"Path hops"})).toBeInTheDocument();
});
