// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';

it.each([['--target', '/private-company'], ['--new']])('CLI rejects unsafe invocation without exposing inherited paths: %j', (...args) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--conditions=react-server', 'scripts/demo-seed.ts', ...args], {
    cwd: process.cwd(), env: { ...process.env, CLOUDSIGHT_DATA_DIR: '/private-company/sentinel' }, encoding: 'utf8', timeout: 15000,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr.trim()).toBe(args[0] === '--new' ? 'demo-seed-existing-environment' : 'demo-seed-new-only');
});

it('runs without a compiler or network and ignores dotenv even in a configured working directory', async () => {
  const root = process.cwd(), directory = await mkdtemp(join(tmpdir(), 'demo-cli-'));
  let demoDirectory: string | undefined;
  try {
    const dotenv = 'CLOUDSIGHT_DATA_DIR=/private-company/never-open\nANTHROPIC_API_KEY=synthetic-not-a-key\n';
    await writeFile(join(directory, '.env.local'), dotenv);
    await writeFile(join(directory, 'offline.cjs'), `
      globalThis.fetch = () => { throw Error('network-forbidden'); };
      for (const name of ['node:http', 'node:https']) {
        const mod = require(name);
        mod.request = mod.get = () => { throw Error('network-forbidden'); };
      }
      const child = require('node:child_process');
      for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
        child[key] = () => { throw Error('compiler-forbidden'); };
      }
    `);
    const result = spawnSync(process.execPath, ['--require', join(directory, 'offline.cjs'),
      '--import', join(root, 'node_modules/tsx/dist/loader.mjs'), '--conditions=react-server', join(root, 'scripts/demo-seed.ts')], {
      cwd: directory, env: { ...process.env, CLOUDSIGHT_DATA_DIR: '', CLOUDSIGHT_BICEP_PATH: '/missing/compiler',
        TSX_TSCONFIG_PATH: join(root, 'tsconfig.json') }, encoding: 'utf8', timeout: 30000,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const manifest = JSON.parse(result.stdout); demoDirectory = manifest.directory;
    expect(manifest.synthetic).toBe(true);
    expect(manifest.dataDirectory).toBe(join(demoDirectory!, 'data'));
    expect(manifest.artifacts.bicep).toBe('not-generated');
    expect(await readFile(join(directory, '.env.local'), 'utf8')).toBe(dotenv);
  } finally {
    if (demoDirectory) await rm(demoDirectory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 40000);
