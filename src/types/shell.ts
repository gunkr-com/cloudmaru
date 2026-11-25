export type ShellData = {
  workspace: { id: string; name: string; companyName: string | null };
  workspaces: { id: string; name: string; companyName: string | null }[];
  monthlyCost: { totalUsd: number; uncountedCalls: number };
};
