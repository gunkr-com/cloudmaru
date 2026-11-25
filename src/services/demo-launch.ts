/** Offline demo launcher I/O. CLI-only (scripts/demo.ts), never imported by a product route. */
import 'server-only';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DEMO_HOST, demoServerEnv, demoStartUrl, isNextReadyLine, nextLocalPort, parseDemoArgs } from '@/lib/demo/launch';
import { seedDemo } from './demo-seed';

const READY_TIMEOUT_MS = 120_000;
const DOTENV_NAMES_TIMEOUT_MS = 30_000;

// `next build`·`next start`와 같은 설치된 @next/env loader로 프로덕션 dotenv를 읽고 키 이름만 출력한다. 값은 내보내지 않는다.
const DOTENV_NAMES_HELPER = `
const { loadEnvConfig } = require(process.argv[2]);
let failed = false;
const log = { info() {}, error() { failed = true; } };
const names = new Set();
for (const file of loadEnvConfig(process.argv[1], false, log, true).loadedEnvFiles) for (const name of Object.keys(file.env)) names.add(name);
if (failed) process.exit(2);
process.stdout.write(JSON.stringify([...names]));`;

/**
 * Next.js가 이 폴더에서 읽을 dotenv 변수 이름. 문법은 따로 구현하지 않고 설치된 Next.js loader를 그대로 쓴다.
 * loader는 물려받은 값 없는 빈 환경의 자식 프로세스에서 돌리고(NODE_ENV도 없어 프로덕션 파일만 읽는다), 실패하면 데모를 멈춘다.
 */
export async function readDotenvNames(directory: string, appDirectory: string = process.cwd()): Promise<string[]> {
  const loader = createRequire(join(appDirectory, 'node_modules', 'next', 'package.json')).resolve('@next/env');
  const output = await new Promise<string>((resolve, reject) => {
    execFile(process.execPath, ['-e', DOTENV_NAMES_HELPER, directory, loader], { env: {} as NodeJS.ProcessEnv, encoding: 'utf8', timeout: DOTENV_NAMES_TIMEOUT_MS },
      (error, stdout) => error ? reject(Error('demo-dotenv-unreadable')) : resolve(stdout));
  });
  let names: unknown;
  try { names = JSON.parse(output); } catch { throw Error('demo-dotenv-unreadable'); }
  if (!Array.isArray(names) || !names.every(name => typeof name === 'string')) throw Error('demo-dotenv-unreadable');
  return names;
}

function run(command: string, args: string[], env: Record<string, string>, cwd: string, output: 'inherit' | 'pipe'): ChildProcess {
  return spawn(command, args, { cwd, env: env as NodeJS.ProcessEnv, stdio: ['ignore', output, output] });
}

function alive(child: ChildProcess) {
  return child.exitCode === null && child.signalCode === null;
}

function exitCode(child: ChildProcess): Promise<number> {
  return new Promise(resolve => {
    child.once('error', () => resolve(1));
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/**
 * 이 자식 프로세스가 직접 출력한 Local 주소와 Ready 줄을 모두 본 뒤에만 준비 완료로 본다.
 * 포트는 OS가 바인딩 시점에 고르므로(-p 0) 다른 프로세스의 주소를 출력할 수 없다.
 * 실행 실패·조기 종료·시간 초과면 자식을 정리하고 고정 오류 코드로 끝낸다.
 */
function waitForReady(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port: number | null = null;
    let ready = false;
    let buffer = '';
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      if (!error) return resolve(port!);
      if (alive(child)) child.kill('SIGTERM');
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        port ??= nextLocalPort(line);
        ready ||= isNextReadyLine(line);
      }
      if (port !== null && ready) finish();
    };
    const onError = () => finish(Error('demo-server-spawn-failed'));
    const onExit = () => finish(Error('demo-server-exited'));
    const timer = setTimeout(() => finish(Error('demo-server-timeout')), timeoutMs);
    child.stdout?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

/** 새 합성 데이터 폴더를 만들고, 그 폴더만 여는 프로덕션 서버를 127.0.0.1에서 OS가 고른 포트로 띄운다. */
export async function launchDemo(args: readonly string[], options: { cwd: string; log: (line: string) => void }) {
  parseDemoArgs(args);
  // 데이터 폴더를 물려받았으면 시드 전에 거절한다. 실제 폴더를 열거나 경로를 출력하지 않는다.
  demoServerEnv(process.env, { dataDirectory: '', secretsDirectory: '', dotenvNames: await readDotenvNames(options.cwd, options.cwd) });
  const manifest = await seedDemo([]);
  const secretsDirectory = join(manifest.directory, 'secrets');
  await mkdir(secretsDirectory, { mode: 0o700 });
  // 빌드가 길어질 수 있으므로 자식을 띄우기 직전에 dotenv 이름을 다시 읽는다.
  const serverEnv = async () => demoServerEnv(process.env, {
    dataDirectory: manifest.dataDirectory, secretsDirectory, dotenvNames: await readDotenvNames(options.cwd, options.cwd),
  });
  const next = join(options.cwd, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!await stat(join(options.cwd, '.next', 'BUILD_ID')).then(() => true, () => false)) {
    options.log('Building CloudMaru once before starting the demo...');
    if (await exitCode(run(process.execPath, [next, 'build'], await serverEnv(), options.cwd, 'inherit')) !== 0) throw Error('demo-build-failed');
  }
  const server = run(process.execPath, [next, 'start', '-H', DEMO_HOST, '-p', '0'], await serverEnv(), options.cwd, 'pipe');
  server.stdout?.pipe(process.stdout);
  server.stderr?.pipe(process.stderr);
  const exit = exitCode(server);
  const stop = () => { if (alive(server)) server.kill('SIGTERM'); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const url = demoStartUrl(await waitForReady(server, READY_TIMEOUT_MS));
  options.log('');
  options.log('CloudMaru synthetic offline demo is ready.');
  options.log(`Open: ${url}`);
  options.log(`Demo data folder (synthetic only): ${manifest.directory}`);
  options.log('No Azure, Claude or billing data is used. Press Ctrl+C to stop.');
  return { url, manifest, exit };
}
