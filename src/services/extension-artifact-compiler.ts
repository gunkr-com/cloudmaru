import 'server-only';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { BICEP_CLI_COMMIT, BICEP_CLI_VERSION, BICEP_COMPILER_POLICY, validateCompiledTemplate } from '@/lib/extend-artifacts/compiled-template';
import { createBicepContext, validateBicepArtifactSource, validateBoundBicep } from '@/lib/extend-artifacts/bicep-semantics';
import { validateTextArtifactSemantics } from '@/lib/extend-artifacts/guide-evaluation';
import type { BicepContext } from '@/lib/extend-artifacts/bicep-semantics';
import type { ArtifactStorageContext } from '@/lib/extend-artifacts/storage-validation';
import type { ExtensionArtifact } from '@/types/extension';
import type { AttemptValidationEvidence } from '@/types/completion-evidence';

type CompilerErrorCode = 'unsafe-source' | 'compiler-unavailable' | 'compiler-version' | 'compile-failed' | 'timeout' | 'output-limit' | 'template-mismatch' | 'configuration' | 'internal';
export class ExtensionArtifactCompilerError extends Error {
  constructor(public readonly code: CompilerErrorCode) { super(`extension-bicep:${code}`); this.name = 'ExtensionArtifactCompilerError'; }
}
const fail = (code: CompilerErrorCode): never => { throw new ExtensionArtifactCompilerError(code); };
type Options = { executable?: string; tempRoot?: string; timeoutMs?: number; maxOutputBytes?: number };
const validExecutable = (value: string) => value === 'bicep' || isAbsolute(value) && !/[\p{Cc}\p{Cf}]/u.test(value);

/** Bounded CLI only. No shell, az, restoration, deployments, model calls or inherited credentials. */
export function createExtensionArtifactCompiler(options: Options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000, maxOutputBytes = options.maxOutputBytes ?? 1048576;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
    || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 1048576
    || options.executable !== undefined && !validExecutable(options.executable)
    || options.tempRoot !== undefined && !isAbsolute(options.tempRoot)) fail('configuration');
  function executableAtCallTime() {
    const executable = options.executable ?? process.env.CLOUDSIGHT_BICEP_PATH ?? 'bicep';
    if (!validExecutable(executable)) return fail('configuration');
    return executable;
  }
  async function run(executable: string, cwd: string, deadline: number, args: string[], version = false): Promise<string> {
    const env = { NODE_ENV: 'production' as const, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', HOME: cwd, TMPDIR: cwd,
      XDG_CONFIG_HOME: cwd, XDG_CACHE_HOME: cwd, DOTNET_CLI_HOME: cwd, BICEP_CACHE_ROOT: cwd,
      DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };

    const remaining = deadline - performance.now(); if (remaining <= 0) return fail('timeout');
    return new Promise((resolve, reject) => {
      let stdoutBytes = 0, stderrBytes = 0, error: CompilerErrorCode | undefined;
      const stdout: Buffer[] = [];
      const child = spawn(/* turbopackIgnore: true */ executable, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const stop = (code: CompilerErrorCode) => { error ??= code; child.kill('SIGKILL'); };
      const timer = setTimeout(() => stop('timeout'), Math.ceil(remaining));
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > Math.min(maxOutputBytes, version ? 1024 : 1048576)) stop('output-limit');
        else if (!error) stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > Math.min(maxOutputBytes, 65536)) stop('output-limit');
      });
      child.once('error', () => { error ??= 'compiler-unavailable'; });
      // Wait for actual termination and closed output pipes before deleting the private directory.
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (error) reject(new ExtensionArtifactCompilerError(error));
        else if (code !== 0 || signal !== null) reject(new ExtensionArtifactCompilerError(version ? 'compiler-unavailable' : 'compile-failed'));
        else resolve(Buffer.concat(stdout).toString('utf8'));
      });
    });
  }
  async function checkVersion(executable: string, cwd: string, deadline: number) {
    const version = (await run(executable, cwd, deadline, ['--version'], true)).trim();
    if (version !== `Bicep CLI version ${BICEP_CLI_VERSION} (${BICEP_CLI_COMMIT})`) return fail('compiler-version');
  }
  async function checkAvailability(): Promise<void> {
    const executable = executableAtCallTime(), deadline = performance.now() + Math.min(timeoutMs, 5000);
    let directory: string | undefined;
    try {
      // Version-only, private empty home: no source/build or inherited user config/cache.
      directory = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'cloudsight-bicep-'));
      directory = await realpath(directory);
      await chmod(directory, 0o700);
      await checkVersion(executable, directory, deadline);
    } catch (error) {
      if (error instanceof ExtensionArtifactCompilerError) throw error;
      return fail('internal');
    } finally {
      if (directory !== undefined) {
        try { await rm(directory, { recursive: true, force: true }); }
        catch { fail('internal'); }
      }
    }
  }
  async function compile(source: string, context: BicepContext): Promise<AttemptValidationEvidence> {
    // Source parsing rejects every external-access construct BEFORE temp files or even --version.
    let program;
    try {
      if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 60000) fail('unsafe-source');
      program = validateBoundBicep(source, context);
    } catch { return fail('unsafe-source'); }
    const executable = executableAtCallTime();
    const deadline = performance.now() + timeoutMs;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'cloudsight-bicep-'));
      directory = await realpath(directory);
      await chmod(directory, 0o700);
      await writeFile(join(directory, 'main.bicep'), source, { mode: 0o600, flag: 'wx' });
      // Explicit --config avoids discovery in parent directories. Embedded types only; closed source has no modules/imports.
      await writeFile(join(directory, 'bicepconfig.json'), JSON.stringify({
        analyzers: { core: { enabled: false } }, experimentalFeaturesEnabled: { symbolicNameCodegen: false },
      }), { mode: 0o600, flag: 'wx' });
      const cwd = directory;
      await checkVersion(executable, cwd, deadline);
      const output = await run(executable, cwd, deadline, ['build', 'main.bicep', '--stdout', '--no-restore', '--config', 'bicepconfig.json']);
      try {
        const compiled = validateCompiledTemplate(JSON.parse(output), program);
        return { policyVersion: BICEP_COMPILER_POLICY,
          compilerVersion: `bicep-${BICEP_CLI_VERSION}-${BICEP_CLI_COMMIT}-arm-${compiled.generatorVersion}` };
      } catch { return fail('template-mismatch'); }
    } catch (error) {
      if (error instanceof ExtensionArtifactCompilerError) throw error;
      return fail('internal');
    } finally {
      if (directory !== undefined) {
        try { await rm(directory, { recursive: true, force: true }); }
        catch { fail('internal'); }
      }
    }
  }
  async function validateArtifact(artifact: ExtensionArtifact, basis: ArtifactStorageContext): Promise<AttemptValidationEvidence> {
    // Capture input before async compilation; later mutation cannot change the validated source/basis.
    const saved = structuredClone(basis), value = structuredClone(artifact);
    if (value.kind !== 'bicep') return validateTextArtifactSemantics(value, saved);
    const { id, extensionId, workspaceId, sourceScanId, tier, kind, createdAt } = value;
    const context = createBicepContext({ id, extensionId, workspaceId, sourceScanId, tier, kind, createdAt }, saved);
    validateBicepArtifactSource(value, context);
    return compile(value.content.code, context);
  }
  return { compile, validateArtifact, checkAvailability };
}
export const { validateArtifact: validateExtensionArtifact, checkAvailability: checkExtensionArtifactCompilerAvailability } = createExtensionArtifactCompiler();
export function isCompilerEnvironmentError(error: unknown): boolean {
  return error instanceof ExtensionArtifactCompilerError
    && ['configuration', 'compiler-unavailable', 'compiler-version', 'timeout', 'output-limit'].includes(error.code);
}
