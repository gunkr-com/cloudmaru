import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import { SCAN_BODY_MAX_BYTES } from "@/lib/scans/read-json-body";
import { ScanControls } from "./scan-controls";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); push.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
const setup = (canRunScan = true, locale: "en" | "ko" = "en") => {
  const view = render(<I18nProvider locale={locale}><ScanControls workspaceId="fake-workspace" canRunScan={canRunScan} /></I18nProvider>);
  return { ...view, input: view.container.querySelector('input[type="file"]') as HTMLInputElement, user: userEvent.setup() };
};
const response = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body });
const file = (text: string) => {
  const value = new File([text], "inventory.json", { type: "application/json" });
  Object.defineProperty(value, "text", { value: async () => text });
  return value;
};
it("supports a live-only retry action without import UI", async () => {
  fetchMock.mockResolvedValue(response(202, { id: "retry-id" }));
  render(<I18nProvider locale="en"><ScanControls workspaceId="owner" canRunScan showImport={false} runLabel="common.retry" /></I18nProvider>);
  expect(screen.queryByRole("button", { name: "Import file" })).not.toBeInTheDocument();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(screen.queryByText(/Use the JSON output/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/inventory/scans/retry-id"));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ workspaceId: "owner", source: "live" });
});
it("renders English, hides live scan without a connection and keeps exactly one primary button", async () => {
  const { input, user } = setup(false);
  expect(screen.queryByRole("button", { name: "Run scan" })).not.toBeInTheDocument();
  const button = screen.getByRole("button", { name: "Import file" });
  expect(button).toHaveAttribute("data-variant", "default");
  expect(input).toHaveAttribute("accept", ".json,application/json");
  const click = vi.spyOn(input, "click");
  await user.click(button);
  expect(click).toHaveBeenCalled();
  expect(screen.getByText(/Use the JSON output of az graph query/)).toBeInTheDocument();
});
it("posts live JSON and navigates on 202, including an existing scan", async () => {
  fetchMock.mockResolvedValue(response(202, { id: "scan-id", existing: true }));
  const { user } = setup();
  expect(screen.getByRole("button", { name: "Import file" })).toHaveAttribute("data-variant", "secondary");
  await user.click(screen.getByRole("button", { name: "Run scan" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/inventory/scans/scan-id"));
  expect(fetchMock).toHaveBeenCalledWith("/api/scans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: "fake-workspace", source: "live" }) });
});
it("imports JSON on 201 and stays busy while the scan page opens", async () => {
  fetchMock.mockResolvedValue(response(201, { id: "import-id" }));
  const { input, user } = setup();
  const data = { resources: [] };
  const chosen = file(JSON.stringify(data));
  await user.upload(input, chosen);
  await waitFor(() => expect(push).toHaveBeenCalledWith("/inventory/scans/import-id"));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ workspaceId: "fake-workspace", source: "import", data });
  expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  expect(input.value).toBe("");
  // 이동하는 동안 다시 고르면 같은 파일이 두 번 가져와진다.
  expect(screen.getByRole("button", { name: "Import file" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Run scan" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Importing the file.");
  await user.upload(input, chosen);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("lets the same file be chosen again after a rejected import", async () => {
  fetchMock.mockResolvedValue(response(400, { code: "import-invalid" }));
  const { input, user } = setup();
  const chosen = file(JSON.stringify({ resources: [] }));
  await user.upload(input, chosen);
  await screen.findByRole("alert");
  expect(input.value).toBe("");
  expect(screen.getByRole("button", { name: "Import file" })).toBeEnabled();
  await user.upload(input, chosen);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});
it("stays busy after starting a live scan", async () => {
  fetchMock.mockResolvedValue(response(202, { id: "scan-id" }));
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Run scan" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/inventory/scans/scan-id"));
  expect(screen.getByRole("button", { name: "Run scan" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Starting scan.");
});
it.each([
  [409, "connection-missing", /Set up the connection/],
  [413, "import-too-large", /larger than 64 MB/],
  [400, "import-invalid", /not a supported inventory format/],
] as const)("translates API %s %s", async (status, code, text) => {
  fetchMock.mockResolvedValue(response(status, { code }));
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Run scan" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(text);
  expect(push).not.toHaveBeenCalled();
});
it.each(["network", "json", "shape", "code", "wrong-status"])("handles %s errors with a localized internal message", async kind => {
  if (kind === "network") fetchMock.mockRejectedValue(new Error("secret"));
  else if (kind === "json") fetchMock.mockResolvedValue({ status: 202, json: async () => { throw new Error("bad JSON"); } });
  else fetchMock.mockResolvedValue(response(kind === "code" ? 400 : kind === "wrong-status" ? 201 : 202, kind === "code" ? { code: "unknown" } : kind === "wrong-status" ? { id: "scan-id" } : { id: 1 }));
  const { user } = setup(true, "ko");
  await user.click(screen.getByRole("button", { name: "스캔 실행" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("처리하지 못했습니다. 다시 시도하세요.");
  expect(push).not.toHaveBeenCalled();
});
it("rejects large and invalid JSON files before sending them and clears the input", async () => {
  const { input, user } = setup();
  const large = file("{}");
  Object.defineProperty(large, "size", { value: SCAN_BODY_MAX_BYTES - 1024 + 1 });
  await user.upload(input, large);
  expect(await screen.findByRole("alert")).toHaveTextContent(/larger than 64 MB/);
  expect(input.value).toBe("");
  await user.upload(input, file("not JSON"));
  expect(await screen.findByRole("alert")).toHaveTextContent(/not a supported inventory format/);
  expect(input.value).toBe("");
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["live", "import"] as const)("disables both buttons and reports %s progress until the request finishes", async source => {
  let resolve!: (value: unknown) => void;
  fetchMock.mockImplementation(() => new Promise(done => { resolve = done; }));
  const { input, user } = setup();
  if (source === "live") await user.click(screen.getByRole("button", { name: "Run scan" }));
  else await user.upload(input, file("{}"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(source === "live" ? "Starting scan." : "Importing the file."));
  for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  expect(input).toBeDisabled();
  fireEvent.change(input, { target: { files: [file("{}")] } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => resolve(response(400, { code: "invalid-body" })));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  for (const button of screen.getAllByRole("button")) expect(button).toBeEnabled();
});
