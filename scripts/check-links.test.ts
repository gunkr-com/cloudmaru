// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rulesData from "../src/catalog/assessment-rules.json";
import advisorData from "../src/catalog/advisor-recommendations.json";
import supportData from "../src/catalog/extension-support.json";
import componentsData from "../src/catalog/components.json";
import { createArchitecture } from "../src/lib/catalog/fixtures.test-data";
import { ALLOWED_SOURCE_HOSTS } from "../src/lib/catalog/schema";
import { checkLinks, collectSourceUrls } from "./check-links";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const sourceUrl = "https://learn.microsoft.com/azure/architecture/";

function response(url = sourceUrl, status = 200, redirected = false): Response {
  const result = new Response(null, { status });
  Object.defineProperties(result, {
    url: { value: url },
    redirected: { value: redirected },
  });
  return result;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("실제 네트워크 금지")));
  process.exitCode = 0;
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("collectSourceUrls", () => {
  it("모든 아키텍처의 출처 URL을 중복 없이 수집한다", () => {
    const first = createArchitecture();
    const second = createArchitecture();
    second.sources.push({ title: "AVM", url: "https://azure.github.io/Azure-Verified-Modules/" });
    first.sources.push(first.sources[0]);
    expect(collectSourceUrls([first, second])).toEqual([
      sourceUrl, "https://azure.github.io/Azure-Verified-Modules/",
    ]);
  });

  it("아키텍처가 없으면 빈 목록을 반환한다", () => {
    expect(collectSourceUrls([])).toEqual([]);
  });
});

describe("checkLinks", () => {
  it.each(ALLOWED_SOURCE_HOSTS)("허용된 호스트 %s의 200 응답은 통과한다", async (host) => {
    const url = `https://${host}/Azure/example`;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(url));
    await expect(checkLinks([url], fetchImpl)).resolves.toEqual([
      { url, ok: true, status: 200, finalUrl: url },
    ]);
  });

  it.each([201, 204, 301, 404, 500])("200 이외의 %i 응답은 실패한다", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(sourceUrl, status));
    await expect(checkLinks([sourceUrl], fetchImpl)).resolves.toEqual([{
      url: sourceUrl, ok: false, status, finalUrl: sourceUrl,
      error: expect.stringContaining(String(status)),
    }]);
  });

  it("리다이렉트를 따라간 최종 200 응답과 주소를 기록한다", async () => {
    const finalUrl = "https://learn.microsoft.com/en-us/azure/architecture/";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(finalUrl, 200, true));
    await expect(checkLinks([sourceUrl], fetchImpl)).resolves.toEqual([
      { url: sourceUrl, ok: true, status: 200, finalUrl },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(sourceUrl, expect.objectContaining({
      method: "GET", redirect: "follow", signal: expect.any(AbortSignal),
    }));
  });

  it.each(["https://example.com/doc", "https://learn.microsoft.com.example.com/doc"])(
    "200이어도 허용 목록 밖 최종 주소는 실패한다: %s",
    async (finalUrl) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(finalUrl, 200, true));
      await expect(checkLinks([sourceUrl], fetchImpl)).resolves.toEqual([{
        url: sourceUrl, ok: false, status: 200, finalUrl, error: expect.stringMatching(/허용.*호스트/),
      }]);
    },
  );

  it("요청 시간 초과는 해당 주소의 실패로 반환한다", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
      });
    });
    const pending = checkLinks([sourceUrl], fetchImpl);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signal?.aborted).toBe(true);
    await expect(pending).resolves.toEqual([{
      url: sourceUrl, ok: false, status: null, finalUrl: null,
      error: expect.stringMatching(/시간.*초과/),
    }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("네트워크 실패도 수집하며 다른 링크 검사를 계속한다", async () => {
    const second = "https://azure.github.io/Azure-Verified-Modules/";
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("연결 실패"))
      .mockResolvedValueOnce(response(second));
    await expect(checkLinks([sourceUrl, second], fetchImpl)).resolves.toEqual([
      { url: sourceUrl, ok: false, status: null, finalUrl: null, error: expect.stringContaining("연결 실패") },
      { url: second, ok: true, status: 200, finalUrl: second },
    ]);
  });

  it("동시 요청은 최대 5개이며 결과는 입력 순서를 유지한다", async () => {
    vi.useFakeTimers();
    const urls = Array.from({ length: 12 }, (_, index) => `${sourceUrl}${index}`);
    let active = 0;
    let maximum = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 120 - urls.indexOf(url) * 5));
      active -= 1;
      return response(url);
    });
    const pending = checkLinks(urls, fetchImpl);
    await vi.runAllTimersAsync();
    const results = await pending;
    expect(maximum).toBeLessThanOrEqual(5);
    expect(active).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(12);
    expect(results.map(({ url }) => url)).toEqual(urls);
    expect(results.every(({ ok }) => ok)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("링크가 없으면 네트워크 요청을 보내지 않는다", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(checkLinks([], fetchImpl)).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("출처 링크 확인 CLI", () => {
  async function runCli() {
    process.argv = [originalArgv[0], fileURLToPath(new URL("./check-links.ts", import.meta.url))];
    await import("./check-links");
  }

  function mockCatalogFiles(architectures = [createArchitecture()]) {
    const files: Record<string, unknown> = {
      "reference-architectures.json": architectures,
      "assessment-rules.json": rulesData,
      "advisor-recommendations.json": advisorData,
      "extension-support.json": supportData,
    };
    vi.mocked(readFile).mockImplementation(async input => {
      const name = String(input).split("/").at(-1)!;
      if (!(name in files)) throw new Error(`Unexpected catalog: ${name}`);
      return JSON.stringify(files[name]);
    });
  }

  it("import만 하면 파일·네트워크·종료 상태에 부작용이 없다", async () => {
    vi.resetModules();
    process.exitCode = 7;
    await import("./check-links");
    expect(readFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(7);
  });

  it("참조 아키텍처가 없어도 Assess·Advisor·지역·재사용 출처를 중복 없이 검사한다", async () => {
    vi.resetModules();
    mockCatalogFiles([]);
    vi.mocked(fetch).mockImplementation(async input => response(String(input)));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCli();
    const expected = [...new Set([
      ...componentsData.flatMap(component => 'bicepDeployment' in component ? component.bicepDeployment?.sourceUrls ?? [] : []),
      ...componentsData.flatMap(component => 'extensionDeployment' in component ? component.extensionDeployment.sourceUrls : []),
      ...rulesData.rules.flatMap(rule => rule.sources),
      ...advisorData.entries.flatMap(entry => entry.sources),
      ...supportData.components.flatMap(component => component.regions.flatMap(region => region.sources.map(source => source.url))),
      ...supportData.reusePolicies.flatMap(policy => policy.sources.map(source => source.url)),
    ])];
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(expected);
    expect(log.mock.calls.flat().join("\n")).toContain(String(expected.length));
    expect(process.exitCode).toBe(0);
  });

  it("PostgreSQL deployment-only sources are checked and failures fail the CLI", async () => {
    vi.resetModules();
    mockCatalogFiles([]);
    const deploymentOnly = componentsData.flatMap(component =>
      'bicepDeployment' in component ? component.bicepDeployment?.sourceUrls ?? [] : []);
    const target = deploymentOnly.find(url => ![
      ...rulesData.rules.flatMap(rule => rule.sources),
      ...advisorData.entries.flatMap(entry => entry.sources),
      ...supportData.components.flatMap(component => component.regions.flatMap(region => region.sources.map(source => source.url))),
      ...supportData.reusePolicies.flatMap(policy => policy.sources.map(source => source.url)),
    ].includes(url));
    expect(target).toBeDefined();
    vi.mocked(fetch).mockImplementation(async input => response(String(input), input === target ? 404 : 200));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli();
    expect(error.mock.calls.flat().join("\n")).toContain(target);
    expect(process.exitCode).toBe(1);
  });

  it("checks deployment role sources even with no reference architecture sources", async () => {
    vi.resetModules();
    mockCatalogFiles([]);
    vi.mocked(fetch).mockImplementation(async input => response(String(input)));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCli();
    const roles = [...new Set(componentsData.flatMap(component =>
      'extensionDeployment' in component ? component.extensionDeployment.sourceUrls : []))];
    expect(roles.length).toBeGreaterThan(0);
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(expect.arrayContaining(roles));
    expect(new Set(urls).size).toBe(urls.length);
    expect(process.exitCode).toBe(0);
  });

  it("잘못된 추가 카탈로그는 네트워크 요청 전에 실패한다", async () => {
    vi.resetModules();
    mockCatalogFiles();
    const original = vi.mocked(readFile).getMockImplementation()!;
    vi.mocked(readFile).mockImplementation(async (...args) =>
      String(args[0]).endsWith("assessment-rules.json") ? "{}" : original(...args));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli();
    expect(fetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("실패한 주소와 사유를 모두 출력하고 실패 코드로 끝낸다", async () => {
    vi.resetModules();
    const architecture = createArchitecture();
    const second = "https://azure.github.io/Azure-Verified-Modules/";
    architecture.sources.push({ title: "AVM", url: second });
    mockCatalogFiles([architecture]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(sourceUrl, 404))
      .mockRejectedValueOnce(new Error("연결 실패"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli();
    const output = error.mock.calls.flat().join("\n");
    expect(output).toContain(sourceUrl);
    expect(output).toContain("404");
    expect(output).toContain(second);
    expect(output).toContain("연결 실패");
    expect(process.exitCode).toBe(1);
  });
});
