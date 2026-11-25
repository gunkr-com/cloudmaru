// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each([
  [['--port', '3000'], {}, 'demo-args-invalid'],
  [['--host', '0.0.0.0'], {}, 'demo-args-invalid'],
  [[], { CLOUDSIGHT_DATA_DIR: '/private-company/sentinel' }, 'demo-existing-environment'],
] as const)('CLI refuses %j before seeding or starting a server, without echoing inherited paths', (args, env, code) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--conditions=react-server', 'scripts/demo.ts', ...args], {
    cwd: process.cwd(), env: { ...process.env, CLOUDSIGHT_DATA_DIR: '', ...env }, encoding: 'utf8', timeout: 20000,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr.trim()).toBe(code);
});
