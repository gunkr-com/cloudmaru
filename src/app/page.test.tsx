import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getCurrentWorkspace: vi.fn(), getWorkspaceClaudeOverview: vi.fn(), redirect: vi.fn((path:string):never=>{throw Error(path);}) }));
vi.mock("@/services/current-workspace", () => m);
vi.mock("@/services/workspace-setup", () => m);
vi.mock("next/navigation", () => m);
import Page from "./page";
beforeEach(()=> { vi.clearAllMocks(); m.getCurrentWorkspace.mockResolvedValue({id:"current"}); });
it("routes first launch to setup, preserves configured entries and explicit local mode", async ()=>{
 m.getWorkspaceClaudeOverview.mockResolvedValue({needsSetup:true}); await expect(Page()).rejects.toThrow("/setup");
 m.getWorkspaceClaudeOverview.mockResolvedValue({needsSetup:false}); await expect(Page()).rejects.toThrow("/analyses/new");
});
