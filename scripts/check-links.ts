import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ALLOWED_SOURCE_HOSTS, referenceArchitectureSchema } from "../src/lib/catalog/schema";
import { parseAssessmentRules } from "../src/lib/assessment/rules/catalog";
import { parseAdvisorCatalog } from "../src/lib/assessment/advisor-catalog";
import { loadCatalog } from "../src/lib/catalog/load";
import { parseExtensionSupportCatalog } from "../src/lib/catalog/extension-support-schema";
import type { ReferenceArchitecture } from "../src/types/catalog";

export type LinkCheckResult = {
  url: string;
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  error?: string;
};

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_REQUESTS = 5;

export function collectSourceUrls(architectures: ReferenceArchitecture[]): string[] {
  return [...new Set(architectures.flatMap(({ sources }) => sources.map(({ url }) => url)))];
}

async function checkLink(url: string, fetchImpl: typeof fetch): Promise<LinkCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let status: number | null = null;
  let finalUrl: string | null = null;
  try {
    const response = await fetchImpl(url, {
      method: "GET", redirect: "follow", signal: controller.signal,
    });
    status = response.status;
    finalUrl = response.url;
    // 상태와 최종 주소만 필요하므로 본문 연결을 해제한다.
    await response.body?.cancel();
    if (status !== 200) throw new Error(`HTTP ${status}: 최종 응답은 200이어야 합니다.`);
    const host = new URL(finalUrl).hostname;
    if (!ALLOWED_SOURCE_HOSTS.some((allowed) => allowed === host)) {
      throw new Error(`허용되지 않은 최종 주소 호스트: ${host}`);
    }
    return { url, ok: true, status, finalUrl };
  } catch (error) {
    return {
      url, ok: false, status, finalUrl,
      error: controller.signal.aborted
        ? `요청 시간 초과 (${REQUEST_TIMEOUT_MS / 1000}초)`
        : error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkLinks(urls: string[], fetchImpl: typeof fetch): Promise<LinkCheckResult[]> {
  const results: LinkCheckResult[] = [];
  // 배치 크기로 동시 요청 수를 제한하고 입력 순서대로 결과를 모은다.
  for (let index = 0; index < urls.length; index += MAX_CONCURRENT_REQUESTS) {
    results.push(...await Promise.all(
      urls.slice(index, index + MAX_CONCURRENT_REQUESTS).map((url) => checkLink(url, fetchImpl)),
    ));
  }
  return results;
}

async function main() {
  const architectures = z.array(referenceArchitectureSchema).parse(
    JSON.parse(await readFile(new URL("../src/catalog/reference-architectures.json", import.meta.url), "utf8")),
    { error: z.locales.ko().localeError },
  );
  const readCatalog = async (file: string): Promise<unknown> => JSON.parse(
    await readFile(new URL(`../src/catalog/${file}`, import.meta.url), "utf8"),
  );
  // 모든 카탈로그를 검증한 뒤에만 요청을 시작한다. import 시 I/O는 없다.
  const rules = parseAssessmentRules(await readCatalog("assessment-rules.json"));
  const advisor = parseAdvisorCatalog(await readCatalog("advisor-recommendations.json"));
  const catalog = loadCatalog();
  const support = parseExtensionSupportCatalog(await readCatalog("extension-support.json"), catalog);
  const urls = [...new Set([
    ...collectSourceUrls(architectures),
    ...catalog.components.flatMap(component => component.bicepDeployment?.sourceUrls ?? []),
    ...catalog.components.flatMap(component => component.extensionDeployment?.sourceUrls ?? []),
    ...rules.rules.flatMap(rule => rule.sources),
    ...advisor.entries.flatMap(entry => entry.sources),
    ...support.components.flatMap(component => component.regions.flatMap(region => region.sources.map(source => source.url))),
    ...support.reusePolicies.flatMap(policy => policy.sources.map(source => source.url)),
  ])];
  if (urls.length === 0) {
    console.log("확인할 출처 링크가 없습니다.");
    return;
  }
  const results = await checkLinks(urls, fetch);
  const failures = results.filter(({ ok }) => !ok);
  if (failures.length > 0) {
    throw new Error(`출처 링크 확인 실패:\n${failures.map(({ url, error }) => `${url}: ${error}`).join("\n")}`);
  }
  console.log(`출처 링크 ${results.length}개가 모두 유효합니다.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
