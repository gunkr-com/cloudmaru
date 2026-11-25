import { z } from "zod";
const uuid = z.uuid();
/** A cursor is valid only in its original workspace. Exact ordering stays in the DB. */
export function extensionHistoryCursor(workspaceId: string, id: string): string { return `${workspaceId}.${id}`; }
export function parseExtensionHistoryCursor(value: string | string[] | undefined, workspaceId: string): { valid: boolean; beforeId?: string } {
  if (value === undefined) return { valid: true };
  if (typeof value !== "string" || value.length !== 73) return { valid: false };
  const [owner, id] = value.split(".");
  if (owner !== workspaceId || !uuid.safeParse(owner).success || !uuid.safeParse(id).success) return { valid: false };
  return { valid: true, beforeId: id };
}
