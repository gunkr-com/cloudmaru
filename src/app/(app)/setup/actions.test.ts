// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ saveWorkspaceClaudeSetup: vi.fn(), testWorkspaceClaude: vi.fn(), testAzureWorkspace: vi.fn(), getWorkspace: vi.fn(), revalidatePath: vi.fn(), redirect:vi.fn((path:string):never=>{throw Error(path);}) }));
vi.mock("@/services/workspace-setup", () => m);
vi.mock("@/services/workspace-azure-diagnostics", () => m);
vi.mock("@/services/db/workspaces", () => m);
vi.mock("next/cache", () => m);
vi.mock("next/navigation", () => m);
import { saveSetupAction, testClaudeAction, testAzureAction, continueLocalAction } from "./actions";
const id = "00000000-0000-0000-0000-000000000011";
function form(values: Record<string,string> = {}) { const data = new FormData(); for (const [key,value] of Object.entries({workspaceId:id, source:"key",apiKey:"synthetic-private",model:"claude-opus-5-5",...values})) data.set(key,value); return data; }
beforeEach(() => { vi.resetAllMocks(); m.getWorkspace.mockResolvedValue({id}); m.testWorkspaceClaude.mockResolvedValue("verified"); m.testAzureWorkspace.mockResolvedValue({status:"verified",subscriptionCount:1}); });
it("saves a scoped key without returning or testing it and can disable without a key", async () => {
  expect(await saveSetupAction({}, form())).toEqual({saved:true});
  expect(m.saveWorkspaceClaudeSetup).toHaveBeenCalledWith(id,{source:"key",apiKey:"synthetic-private",model:"claude-opus-5-5"});
  expect(m.testWorkspaceClaude).not.toHaveBeenCalled();
  await saveSetupAction({},form({intent:"disable"}));
  expect(m.saveWorkspaceClaudeSetup).toHaveBeenLastCalledWith(id,{source:"disabled"});
});
it("local-only continuation explicitly disables AI and opens import without testing credentials",async()=>{
 await expect(continueLocalAction(form())).rejects.toThrow("/inventory");
 expect(m.saveWorkspaceClaudeSetup).toHaveBeenCalledWith(id,{source:"disabled"});
 expect(m.testWorkspaceClaude).not.toHaveBeenCalled(); expect(m.testAzureWorkspace).not.toHaveBeenCalled();
});
it("rejects malformed configuration and sanitizes storage failures", async () => {
  expect(await saveSetupAction({},form({apiKey:""}))).toEqual({error:"setup.invalid"});
  m.saveWorkspaceClaudeSetup.mockRejectedValue(Error("synthetic-private"));
  expect(await saveSetupAction({},form())).toEqual({error:"setup.storage"});
  expect(m.revalidatePath).not.toHaveBeenCalled();
});
it("tests only saved settings for an existing URL workspace and returns metadata only", async () => {
  expect(await testClaudeAction({},form())).toMatchObject({test:"verified"});
  expect(m.testWorkspaceClaude).toHaveBeenCalledExactlyOnceWith(id);
  expect(await testAzureAction({},form())).toMatchObject({result:{status:"verified"}});
  m.getWorkspace.mockResolvedValue(null);
  expect(await testClaudeAction({},form())).toMatchObject({error:"setup.invalid"});
  expect(m.testWorkspaceClaude).toHaveBeenCalledTimes(1);
});
