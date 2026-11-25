export type Workspace = {
  id: string;
  name: string;
  companyName: string | null;
  defaultRegion: string;
  currency: "CAD";
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceInput = {
  name: string;
  companyName: string | null;
  defaultRegion: string;
};

export type WorkspaceFormState = {
  values?: { name: string; companyName: string; defaultRegion: string };
  errors?: Partial<Record<keyof WorkspaceInput, string[]>>;
  message?: string;
};
