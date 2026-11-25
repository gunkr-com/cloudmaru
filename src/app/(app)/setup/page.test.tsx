import { expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render-with-i18n";
vi.mock("@/services/current-workspace",()=>({getCurrentWorkspace:async()=>({id:"workspace",name:"Synthetic Company"})}));
vi.mock("@/services/workspace-setup",()=>({getWorkspaceClaudeOverview:async()=>({source:"disabled",apiKeyEnv:null,model:"",available:false,needsSetup:true})}));
vi.mock("@/services/workspace-azure-diagnostics",()=>({getAzureLocalDiagnostic:async()=>({status:"missing",subscriptionCount:0})}));
vi.mock("./actions",()=>({continueLocalAction:vi.fn(),testAzureAction:vi.fn()}));
vi.mock("@/i18n/server",async()=>{const {createTranslator}=await import("@/i18n/translate");return {getI18n:async()=>({t:createTranslator("en")})};});
import Page from "./page";
it("offers scoped setup, optional AI, Azure and a usable local import path", async()=>{
 renderWithI18n(await Page({searchParams:Promise.resolve({})}),{locale:"en"});
 expect(screen.getByRole("heading",{name:"Set up CloudMaru"})).toBeInTheDocument();
 expect(screen.getByRole("link",{name:"Configure Claude"})).toHaveAttribute("href","/workspaces/workspace/claude");
 expect(screen.getByRole("link",{name:"Continue to local inventory / import"})).toHaveAttribute("href","/inventory");
 expect(screen.getByRole("button",{name:"Disable AI / local only"})).toBeInTheDocument();
});
