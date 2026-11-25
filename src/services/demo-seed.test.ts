// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { seedDemo } from './demo-seed';
import { createAnalysesDb } from './db/analyses';
import { createAssessmentsDb } from './db/assessments';
import { createAssessmentRoadmapsDb } from './db/assessment-roadmaps';
import { createExtensionsDb } from './db/extensions';
import { createNetworkDiagnosticsDb } from './db/network-diagnostics';
import { createAssessmentReportService } from './assessment-roadmap-report';
import { createScansDb } from './db/scans';

const cleanup: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true });
});

it.each([['--target', '/company'], ['--new', '/company'], ['--new', '--new'], ['--overwrite']])('rejects targets and unsupported arguments: %j', async (...args) => {
  await expect(seedDemo(args)).rejects.toThrow('demo-seed-new-only');
});

it('refuses an inherited data directory without touching it or leaking its path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'demo-sentinel-')); cleanup.push(directory);
  await writeFile(join(directory, 'sentinel'), 'preserve');
  vi.stubEnv('CLOUDSIGHT_DATA_DIR', directory);
  await expect(seedDemo([])).rejects.toThrow('demo-seed-existing-environment');
  expect(await readFile(join(directory, 'sentinel'), 'utf8')).toBe('preserve');
});

it('seeds real saved examples in a fresh DB with no compiler, credentials, network or fabricated billing', async () => {
  vi.stubEnv('CLOUDSIGHT_DATA_DIR', '');
  vi.stubEnv('CLOUDSIGHT_BICEP_PATH', '/missing/compiler');
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('network forbidden'));
  const manifest = await seedDemo([]); cleanup.push(manifest.directory);
  expect(manifest.synthetic).toBe(true);
  expect(manifest.demoVersion).toBe('cloudsight-offline-demo-v1');
  expect(manifest.dataDirectory).toBe(join(manifest.directory, 'data'));
  expect(JSON.parse(await readFile(join(manifest.directory, 'manifest.json'), 'utf8'))).toEqual(manifest);
  const second = await seedDemo(['--new']); cleanup.push(second.directory);
  expect(second.directory).not.toBe(manifest.directory);
  expect(second.ids.workspace).not.toBe(manifest.ids.workspace);
  expect(JSON.parse(await readFile(join(manifest.directory, 'manifest.json'), 'utf8'))).toEqual(manifest);
  const db = new PGlite(manifest.dataDirectory), deps = { db: async () => db };
  try {
    const build = await createAnalysesDb(deps).getAnalysis(manifest.ids.build);
    expect(build?.status).toBe('succeeded');
    expect(build?.result?.requestTitle.en).toContain('Synthetic');
    expect(build?.result?.plans).toHaveLength(3);
    expect((await db.query<{ usage: unknown }>('select usage from analyses where id=$1', [manifest.ids.build])).rows[0].usage).toBeNull();
    const assessment = (await createAssessmentsDb(deps).getAssessment(manifest.ids.assessment))!;
    expect(assessment.status).toBe('succeeded');
    expect(assessment.result!.sourceScan.source).toBe('import');
    const source = await createScansDb(deps).getScanInventory(manifest.ids.sourceScan);
    expect(source?.relations.some(edge => edge.sourceId.endsWith('/demo-storage-endpoint') && edge.targetId.endsWith('/demostorage'))).toBe(true);
    const { defaultSelection } = await import('@/lib/report/selection');
    const presentation = await createAssessmentReportService(deps).presentation(assessment.id, defaultSelection('en'));
    expect(presentation?.details?.[0].table?.rows).toContainEqual(['demo-storage-endpoint', 'connects to', 'demostorage']);

    expect(new Set(assessment.result!.local.findings.map(f => f.verdict))).toEqual(new Set(['pass', 'violation', 'unknown']));
    expect(assessment.result!.actualCost.monthToDate).toEqual({ state: 'unavailable', reason: 'not-supported' });
    expect(assessment.result!.advisor).toEqual({ state: 'unavailable', reason: 'not-supported' });
    expect(assessment.result!.diff.state).toBe('available');
    expect((await createAssessmentRoadmapsDb(deps).getAssessmentRoadmap(assessment.id))!.roadmap.status).toBe('succeeded');
    for (const locale of ['en', 'ko'] as const) expect(await createAssessmentReportService(deps).get(assessment.id, locale)).toBeTruthy();
    const extension = (await createExtensionsDb(deps).getExtension(manifest.ids.extension))!;
    expect(extension.status).toBe('succeeded');
    expect(extension.result!.plans).toHaveLength(3);
    expect(extension.result!.plans.every(p => p.checks.some(c => c.kind === 'capacity' && c.verdict === 'unknown'))).toBe(true);
    for (const verdict of ['allowed', 'blocked', 'unknown'] as const) {
      expect((await createNetworkDiagnosticsDb(deps).getNetworkDiagnostic(manifest.ids.network[verdict]))!.result!.engine.verdict).toBe(verdict);
    }
    expect((await createScansDb(deps).listScans(manifest.ids.workspace)).every(s => s.source === 'import')).toBe(true);
    for (const table of ['artifacts', 'extension_artifacts', 'llm_calls']) expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
    const workspaces = (await db.query<{ name: string; claude_api_key_env: string | null; azure_connection: unknown }>('select name, claude_api_key_env, azure_connection from workspaces')).rows;
    expect(workspaces.every(w => w.name.includes('Synthetic') && w.claude_api_key_env === null && w.azure_connection === null)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  } finally { await db.close(); }
}, 60000);

it('records App Service plan links and makes the assessed scan the latest saved environment', async () => {
  vi.stubEnv('CLOUDSIGHT_DATA_DIR', '');
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('network forbidden'));
  const manifest = await seedDemo([]); cleanup.push(manifest.directory);
  const db = new PGlite(manifest.dataDirectory), deps = { db: async () => db };
  try {
    const scans = createScansDb(deps);
    expect((await scans.getLatestSucceededScan(manifest.ids.workspace))?.id).toBe(manifest.ids.sourceScan);
    const source = (await scans.getScanInventory(manifest.ids.sourceScan))!;
    const hosted = source.relations.filter(edge => edge.type === 'hosts');
    expect(hosted).toHaveLength(9);
    expect(hosted.every(edge => edge.sourceId.endsWith('/demo-plan') && /\/demo-app-\d$/.test(edge.targetId))).toBe(true);
    const assessment = (await createAssessmentsDb(deps).getAssessment(manifest.ids.assessment))!;
    expect(assessment.result!.local.coverage.reasons).toContainEqual({ code: 'no-applicable-rule', count: expect.any(Number) });
  } finally { await db.close(); }
}, 60000);
