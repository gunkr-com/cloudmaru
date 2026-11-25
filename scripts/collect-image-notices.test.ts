// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectImageNotices, main } from "./collect-image-notices";

type LockEntry = { version: string; license?: string; dev?: boolean; optional?: boolean; devOptional?: boolean };

let root: string;

function write(path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function installPackage(lockPath: string, name: string, version: string, files: Record<string, string> = {}) {
  write(`${lockPath}/package.json`, JSON.stringify({ name, version }));
  for (const [file, content] of Object.entries(files)) write(`${lockPath}/${file}`, content);
}

function writeLock(packages: Record<string, LockEntry>) {
  write("package-lock.json", JSON.stringify({
    name: "synthetic-app",
    lockfileVersion: 3,
    packages: { "": { name: "synthetic-app", version: "0.0.0" }, ...packages },
  }));
}

function trace(lockPath: string, name: string, version: string) {
  write(`.next/standalone/${lockPath}/package.json`, JSON.stringify({ name, version }));
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

const OFL = "SIL OPEN FONT LICENSE Version 1.1 (synthetic fixture)";

function baseline() {
  writeLock({
    "node_modules/alpha": { version: "1.0.0", license: "MIT" },
    "node_modules/alpha/node_modules/beta": { version: "0.1.0", license: "ISC" },
    "node_modules/@scope/font": { version: "2.0.0", license: "OFL-1.1" },
    "node_modules/devtool": { version: "3.0.0", license: "MIT", dev: true },
    "node_modules/traceddev": { version: "1.1.0", license: "BSD-3-Clause", dev: true },
    "node_modules/nolicense": { version: "0.0.1", license: "MIT" },
    "node_modules/notinstalled": { version: "9.9.9", license: "MIT", optional: true },
  });
  installPackage("node_modules/alpha", "alpha", "1.0.0", {
    LICENSE: "alpha MIT text",
    "NOTICE.md": "alpha notice",
    "lib/notice.js": "export const notice = 1;",
    "lib/license.d.ts": "export {};",
  });
  installPackage("node_modules/alpha/node_modules/beta", "beta", "0.1.0", { "LICENSE.txt": "beta ISC text" });
  installPackage("node_modules/@scope/font", "@scope/font", "2.0.0", { "dist/LICENSE.txt": OFL });
  installPackage("node_modules/devtool", "devtool", "3.0.0", { LICENSE: "devtool text" });
  installPackage("node_modules/traceddev", "traceddev", "1.1.0", { COPYING: "traceddev text" });
  installPackage("node_modules/nolicense", "nolicense", "0.0.1");
  trace("node_modules/alpha", "alpha", "1.0.0");
  trace("node_modules/traceddev", "traceddev", "1.1.0");
}

function run() {
  return collectImageNotices({
    root,
    standaloneRoot: join(root, ".next/standalone"),
    outDir: join(root, "out"),
  });
}

function readManifest() {
  return JSON.parse(readFileSync(join(root, "out/manifest.json"), "utf8"));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cloudsight-notices-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("collectImageNotices", () => {
  it("copies exact-version license texts for the production closure, including bundled font OFL text", () => {
    baseline();
    run();
    expect(readFileSync(join(root, "out/alpha@1.0.0/LICENSE"), "utf8")).toBe("alpha MIT text");
    expect(readFileSync(join(root, "out/alpha@1.0.0/NOTICE.md"), "utf8")).toBe("alpha notice");
    expect(readFileSync(join(root, "out/beta@0.1.0/LICENSE.txt"), "utf8")).toBe("beta ISC text");
    expect(readFileSync(join(root, "out/@scope/font@2.0.0/dist/LICENSE.txt"), "utf8")).toBe(OFL);
  });

  it("does not treat source files named like notices as license texts or descend into nested packages", () => {
    baseline();
    run();
    expect(existsSync(join(root, "out/alpha@1.0.0/lib"))).toBe(false);
    expect(existsSync(join(root, "out/alpha@1.0.0/node_modules"))).toBe(false);
  });

  it("includes dev-marked packages only when Next traced them into the standalone server", () => {
    baseline();
    run();
    expect(existsSync(join(root, "out/devtool@3.0.0"))).toBe(false);
    expect(readFileSync(join(root, "out/traceddev@1.1.0/COPYING"), "utf8")).toBe("traceddev text");
  });

  it("writes a manifest with locked versions, declared licenses, hashes, and packages lacking texts", () => {
    baseline();
    run();
    const manifest = readManifest();
    const alpha = manifest.packages.find((p: { name: string }) => p.name === "alpha");
    expect(alpha).toEqual({
      name: "alpha",
      version: "1.0.0",
      license: "MIT",
      lockPaths: ["node_modules/alpha"],
      traced: true,
      files: [
        { path: "alpha@1.0.0/LICENSE", sha256: sha256("alpha MIT text") },
        { path: "alpha@1.0.0/NOTICE.md", sha256: sha256("alpha notice") },
      ],
    });
    expect(manifest.packages.map((p: { name: string }) => p.name)).toEqual(
      ["@scope/font", "alpha", "beta", "nolicense", "traceddev"],
    );
    expect(manifest.withoutLicenseText).toEqual(["nolicense@0.0.1"]);
    expect(manifest.source).toBe("package-lock.json");
  });

  it("keeps the top-level README as attribution when a package ships no license file", () => {
    baseline();
    write("node_modules/nolicense/README.md", "## Licensing\nbundled libraries: LGPLv3");
    write("node_modules/nolicense/docs/README.md", "nested docs");
    run();
    expect(readFileSync(join(root, "out/nolicense@0.0.1/README.md"), "utf8")).toContain("LGPLv3");
    expect(existsSync(join(root, "out/nolicense@0.0.1/docs"))).toBe(false);
    expect(existsSync(join(root, "out/alpha@1.0.0/README.md"))).toBe(false);
    const nolicense = readManifest().packages.find((p: { name: string }) => p.name === "nolicense");
    expect(nolicense.attributionFallback).toBe("readme");
    expect(readManifest().withoutLicenseText).toEqual(["nolicense@0.0.1"]);
  });

  it("merges identical texts of one exact version installed at several paths", () => {
    baseline();
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    lock.packages["node_modules/devtool/node_modules/beta"] = { version: "0.1.0", license: "ISC" };
    lock.packages["node_modules/devtool"].dev = false;
    write("package-lock.json", JSON.stringify(lock));
    installPackage("node_modules/devtool/node_modules/beta", "beta", "0.1.0", { "LICENSE.txt": "beta ISC text" });
    run();
    const beta = readManifest().packages.find((p: { name: string }) => p.name === "beta");
    expect(beta.lockPaths).toEqual(["node_modules/alpha/node_modules/beta", "node_modules/devtool/node_modules/beta"]);
  });

  it("refuses conflicting texts for the same exact version", () => {
    baseline();
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    lock.packages["node_modules/devtool/node_modules/beta"] = { version: "0.1.0", license: "ISC" };
    lock.packages["node_modules/devtool"].dev = false;
    write("package-lock.json", JSON.stringify(lock));
    installPackage("node_modules/devtool/node_modules/beta", "beta", "0.1.0", { "LICENSE.txt": "different" });
    expect(run).toThrow(/conflicting license text: beta@0.1.0/);
  });

  it("refuses an installed version that differs from the lockfile", () => {
    baseline();
    installPackage("node_modules/alpha", "alpha", "1.0.1");
    expect(run).toThrow(/installed version differs from lock: node_modules\/alpha/);
  });

  it("refuses a traced package that the lockfile does not pin", () => {
    baseline();
    trace("node_modules/unknown", "unknown", "1.0.0");
    expect(run).toThrow(/traced package is not in the lockfile: node_modules\/unknown/);
  });

  it("refuses a traced package whose version differs from the lockfile", () => {
    baseline();
    trace("node_modules/traceddev", "traceddev", "1.2.0");
    expect(run).toThrow(/traced version differs from lock: node_modules\/traceddev/);
  });

  it("refuses symlinked license files instead of following them", () => {
    baseline();
    write("outside.txt", "not a package license");
    symlinkSync(join(root, "outside.txt"), join(root, "node_modules/alpha/COPYRIGHT"));
    expect(run).toThrow(/symlinked license file: node_modules\/alpha\/COPYRIGHT/);
  });

  it("refuses to write into an existing output directory", () => {
    baseline();
    mkdirSync(join(root, "out"));
    expect(run).toThrow(/output directory already exists/);
  });
});

describe("main", () => {
  it("runs from command-line paths and reports a failure without a stack trace", () => {
    baseline();
    const ok = main(["--root", root, "--standalone", join(root, ".next/standalone"), "--out", join(root, "out")]);
    expect(ok).toBe(0);
    expect(readManifest().packages).toHaveLength(5);
    const again = main(["--root", root, "--standalone", join(root, ".next/standalone"), "--out", join(root, "out")]);
    expect(again).toBe(1);
  });

  it("rejects missing arguments", () => {
    expect(main(["--root", root])).toBe(2);
  });
});
