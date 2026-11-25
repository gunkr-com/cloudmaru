// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { logStoreError } from "./store-log";

afterEach(() => { vi.restoreAllMocks(); });

describe("logStoreError", () => {
  it("writes the error name and message to the server log", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logStoreError("analyses", new TypeError("relation \"analyses\" does not exist"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe("[cloudsight:db] analyses failed — TypeError: relation \"analyses\" does not exist");
  });
  it("handles non-Error values", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logStoreError("workspaces", "boom");
    expect(spy.mock.calls[0]![0]).toBe("[cloudsight:db] workspaces failed — boom");
  });
  it("includes the cause, which is where open and lock errors keep the folder detail", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logStoreError("artifacts", new Error("open failed", { cause: new Error("EACCES /data") }));
    expect(spy.mock.calls[0]![0]).toBe("[cloudsight:db] artifacts failed — Error: open failed (cause: Error: EACCES /data)");
  });
});
