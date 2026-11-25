// Collects exact-version license and notice texts for the container image.
// Runs in the Docker build stage with Node 24 type stripping, so it uses only
// erasable TypeScript syntax and Node built-ins.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type LockEntry = { version?: string; license?: string; dev?: boolean; link?: boolean };

type CollectOptions = { root: string; standaloneRoot: string; outDir: string };

type CollectedPackage = {
  name: string;
  version: string;
  license: string | null;
  lockPaths: string[];
  traced: boolean;
  texts: Map<string, Buffer>;
  attributionFallback?: "readme";
};

const NOTICE_FILE = /^(licen[sc]e|copying|notice|copyright)(?:[._-].*)?$/i;
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|map|json)$/i;
const README_FILE = /^readme(?:\.(?:md|markdown|txt))?$/i;

class NoticeError extends Error {}

function lockPathOf(path: string) {
  const normalized = posix.normalize(path);
  if (isAbsolute(path) || normalized !== path || path.split("/").includes("..") || !path.startsWith("node_modules/")) {
    throw new NoticeError(`unsupported lockfile package path: ${path}`);
  }
  return path;
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function noticeTexts(root: string, lockPath: string) {
  const texts = new Map<string, Buffer>();
  const visit = (relative: string) => {
    const folder = join(root, lockPath, relative);
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // Nested dependencies have their own exact lock entries.
        if (entry.name !== "node_modules") visit(child);
        continue;
      }
      if (!NOTICE_FILE.test(entry.name) || SOURCE_FILE.test(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new NoticeError(`symlinked license file: ${lockPath}/${child}`);
      if (entry.isFile()) texts.set(child, readFileSync(join(folder, entry.name)));
    }
  };
  visit("");
  return texts;
}

// Some packages (for example prebuilt native libraries) state their licensing only in the README.
function readmeTexts(root: string, lockPath: string) {
  const texts = new Map<string, Buffer>();
  for (const entry of readdirSync(join(root, lockPath), { withFileTypes: true })) {
    if (!README_FILE.test(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new NoticeError(`symlinked license file: ${lockPath}/${entry.name}`);
    if (entry.isFile()) texts.set(entry.name, readFileSync(join(root, lockPath, entry.name)));
  }
  return texts;
}

function tracedPackages(standaloneRoot: string) {
  const found = new Map<string, string>();
  const visitModules = (relative: string) => {
    const folder = join(standaloneRoot, relative);
    if (!existsSync(folder) || lstatSync(folder).isSymbolicLink()) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (entry.name.startsWith("@")) {
        for (const scoped of readdirSync(join(folder, entry.name), { withFileTypes: true })) {
          if (scoped.isDirectory()) visitPackage(`${relative}/${entry.name}/${scoped.name}`);
        }
      } else {
        visitPackage(`${relative}/${entry.name}`);
      }
    }
  };
  const visitPackage = (relative: string) => {
    const manifest = join(standaloneRoot, relative, "package.json");
    if (existsSync(manifest)) found.set(relative, String(readJson(manifest).version));
    visitModules(`${relative}/node_modules`);
  };
  visitModules("node_modules");
  return found;
}

function sha256(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

export function collectImageNotices({ root, standaloneRoot, outDir }: CollectOptions) {
  if (existsSync(outDir)) throw new NoticeError("output directory already exists");
  const lock = readJson(join(root, "package-lock.json"));
  const entries = Object.entries((lock.packages ?? {}) as Record<string, LockEntry>).filter(([path, entry]) => path && !entry.link);
  const locked = new Map(entries.map(([path, entry]) => [lockPathOf(path), entry]));

  const traced = tracedPackages(standaloneRoot);
  for (const [path, version] of traced) {
    const entry = locked.get(path);
    if (!entry) throw new NoticeError(`traced package is not in the lockfile: ${path}`);
    if (entry.version !== version) throw new NoticeError(`traced version differs from lock: ${path}`);
  }

  const packages = new Map<string, CollectedPackage>();
  for (const [lockPath, entry] of [...locked].sort(([a], [b]) => a.localeCompare(b))) {
    if (entry.dev && !traced.has(lockPath)) continue;
    const manifestPath = join(root, lockPath, "package.json");
    if (!existsSync(manifestPath)) continue; // optional package for another platform
    const installed = readJson(manifestPath);
    if (installed.version !== entry.version) throw new NoticeError(`installed version differs from lock: ${lockPath}`);
    const name = String(installed.name ?? lockPath.split("node_modules/").pop());
    const key = `${name}@${entry.version}`;
    const declared = entry.license ?? (typeof installed.license === "string" ? installed.license : null);
    const current: CollectedPackage = packages.get(key) ?? {
      name, version: String(entry.version), license: declared, lockPaths: [], traced: false, texts: new Map(),
    };
    current.lockPaths.push(lockPath);
    current.traced ||= traced.has(lockPath);
    for (const [file, data] of noticeTexts(root, lockPath)) {
      const previous = current.texts.get(file);
      if (previous && !previous.equals(data)) throw new NoticeError(`conflicting license text: ${key}/${file}`);
      current.texts.set(file, data);
    }
    packages.set(key, current);
  }

  for (const item of packages.values()) {
    if (item.texts.size > 0) continue;
    item.texts = readmeTexts(root, item.lockPaths[0]);
    if (item.texts.size > 0) item.attributionFallback = "readme";
  }

  const ordered = [...packages.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  mkdirSync(outDir, { recursive: true });
  const manifest = {
    source: "package-lock.json",
    note: "Exact installed license and notice files for production and traced packages. Packages in withoutLicenseText ship no license file; their README is kept as attribution when present. Binary components may carry further notices.",
    packages: ordered.map(([key, item]) => {
      const files = [...item.texts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, data]) => {
        const output = `${key}/${file}`;
        mkdirSync(dirname(join(outDir, output)), { recursive: true });
        writeFileSync(join(outDir, output), data);
        return { path: output, sha256: sha256(data) };
      });
      const fallback = item.attributionFallback ? { attributionFallback: item.attributionFallback } : {};
      return { name: item.name, version: item.version, license: item.license, lockPaths: item.lockPaths, traced: item.traced, files, ...fallback };
    }),
    withoutLicenseText: ordered.filter(([, item]) => item.texts.size === 0 || item.attributionFallback).map(([key]) => key),
  };
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function main(argv: string[]) {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) options[argv[index]] = argv[index + 1];
  const root = options["--root"];
  const standaloneRoot = options["--standalone"];
  const outDir = options["--out"];
  if (!root || !standaloneRoot || !outDir) {
    console.error("usage: collect-image-notices --root <app> --standalone <.next/standalone> --out <dir>");
    return 2;
  }
  try {
    const manifest = collectImageNotices({ root: resolve(root), standaloneRoot: resolve(standaloneRoot), outDir: resolve(outDir) });
    console.log(`collect-image-notices: ${manifest.packages.length} packages, ${manifest.withoutLicenseText.length} without license text`);
    return 0;
  } catch (error) {
    if (!(error instanceof NoticeError) && !(error instanceof SyntaxError) && !(error instanceof Error && "code" in error)) throw error;
    console.error(`collect-image-notices: ${(error as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
