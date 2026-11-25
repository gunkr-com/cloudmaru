// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { demoServerEnv } from "@/lib/demo/launch";
import { readDotenvNames } from "./demo-launch";

const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });

it("collects variable names from every dotenv file Next.js would load without returning values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "demo-dotenv-")); cleanup.push(directory);
  await writeFile(join(directory, ".env.local"), "ANTHROPIC_API_KEY=synthetic-value\nCLOUDSIGHT_DATA_DIR=/company\n");
  await writeFile(join(directory, ".env.production"), "CLOUDSIGHT_CERT_PASSWORD_ACME=synthetic-value\n");
  await writeFile(join(directory, ".env.example"), "IGNORED_EXAMPLE=1\n");
  const names = await readDotenvNames(directory);
  expect(names.toSorted()).toEqual(["ANTHROPIC_API_KEY", "CLOUDSIGHT_CERT_PASSWORD_ACME", "CLOUDSIGHT_DATA_DIR"]);
  expect(await readDotenvNames(join(directory, "missing"))).toEqual([]);
});

it("returns the names the installed Next.js loader reads for every supported assignment form, never values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "demo-dotenv-forms-")); cleanup.push(directory);
  await writeFile(join(directory, ".env.local"), [
    "# comment", "EQ=synthetic-value", "export EXPORTED='synthetic-value'", "  SPACED = synthetic-value", "COLON: synthetic-value",
    "COLON_TAB:\tsynthetic-value", "export EXPORT_COLON: synthetic-value", "DOTTED.KEY=synthetic-value", "DASHED-KEY=synthetic-value",
    "export", "EXPORT_NEXT_LINE=synthetic-value", "KEY_THEN_LINE", "=synthetic-value", "COLON_THEN_LINE:", "synthetic-value",
    "CR_A=1\rCR_B=synthetic-value", "\uFEFFBOM_KEY=synthetic-value", "not a pair", "# COMMENTED=synthetic-value",
  ].join("\n"));
  const names = await readDotenvNames(directory);
  expect(names.toSorted()).toEqual([
    "BOM_KEY", "COLON", "COLON_TAB", "COLON_THEN_LINE", "CR_A", "CR_B", "DASHED-KEY", "DOTTED.KEY", "EQ", "EXPORTED",
    "EXPORT_COLON", "EXPORT_NEXT_LINE", "KEY_THEN_LINE", "SPACED",
  ]);
  expect(JSON.stringify(names)).not.toContain("synthetic-value");
});

// Runs the installed Next.js env loader the way `next build` and `next start` do (production mode, plus a forced
// reload), in a child with exactly the given environment, and prints that child's resulting process.env.
const LOADER_PROBE = `
const { loadEnvConfig } = require(process.argv[2]);
const quiet = { info() {}, error() {} };
loadEnvConfig(process.argv[1], false, quiet);
loadEnvConfig(process.argv[1], false, quiet, true);
process.stdout.write(JSON.stringify(process.env));`;
const installedLoader = createRequire(join(process.cwd(), "node_modules", "next", "package.json")).resolve("@next/env");

function childEnvAfterNextLoad(directory: string, env: Record<string, string>): Record<string, string> {
  return JSON.parse(execFileSync(process.execPath, ["-e", LOADER_PROBE, directory, installedLoader], { env: env as NodeJS.ProcessEnv, encoding: "utf8" }));
}

it("blanks every key the installed Next.js loader reads, so no synthetic credential reaches the demo server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "demo-dotenv-loader-")); cleanup.push(directory);
  await writeFile(join(directory, ".env.local"), [
    "CLOUDSIGHT_CLAUDE_KEY_SYNTH: synthetic-credential-colon",
    "export CLOUDSIGHT_CERT_PASSWORD_SYNTH:\tsynthetic-credential-export-colon",
    "ANTHROPIC_API_KEY=synthetic-credential-equals",
    "DOTTED.KEY=synthetic-credential-dotted",
    "DASHED-KEY=synthetic-credential-dashed",
    "KEY_THEN_LINE", "=synthetic-credential-split-equals",
    "COLON_THEN_LINE:", "synthetic-credential-split-colon",
    "export", "EXPORT_NEXT_LINE=synthetic-credential-split-export",
    "CR_KEY=1\rCR_NEXT=synthetic-credential-cr",
    "﻿BOM_KEY=synthetic-credential-bom",
    "CLOUDSIGHT_DATA_DIR=/synthetic-credential/company-data",
    "CLOUDSIGHT_SECRETS_DIR: /synthetic-credential/company-secrets",
  ].join("\n"));
  await writeFile(join(directory, ".env.production"), "PROD_ONLY_KEY: synthetic-credential-production\n");
  await writeFile(join(directory, ".env"), "BASE_KEY=synthetic-credential-base\nEXPANDED=${ANTHROPIC_API_KEY}\n");

  // Control: with an empty environment the installed loader really reads every synthetic credential above.
  const unguarded = JSON.stringify(childEnvAfterNextLoad(directory, {}));
  for (const marker of ["colon", "export-colon", "equals", "dotted", "dashed", "split-equals", "split-colon", "split-export", "cr", "bom", "production", "base"]) {
    expect(unguarded).toContain(`synthetic-credential-${marker}"`);
  }

  const dotenvNames = await readDotenvNames(directory);
  const env = demoServerEnv({ PATH: process.env.PATH ?? "/usr/bin" }, {
    dataDirectory: "/synthetic/demo/data", secretsDirectory: "/synthetic/demo/secrets", dotenvNames,
  });
  const loaded = childEnvAfterNextLoad(directory, env);
  expect(JSON.stringify(loaded)).not.toContain("synthetic-credential");
  expect(loaded).toMatchObject({
    CLOUDSIGHT_DATA_DIR: "/synthetic/demo/data", CLOUDSIGHT_SECRETS_DIR: "/synthetic/demo/secrets", CLOUDSIGHT_DEMO: "1",
    ANTHROPIC_API_KEY: "", CLOUDSIGHT_CLAUDE_KEY_SYNTH: "", CLOUDSIGHT_CERT_PASSWORD_SYNTH: "",
  });
});
