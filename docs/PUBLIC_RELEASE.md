# Preparing a public source snapshot

CloudMaru's working repository contains private operational history. Prepare a
new source directory for review; keep the original repository private. This
command creates no Git repository, sends no network requests and changes no
repository visibility. It does not establish ownership clearance or authorize
publication.

Install the exact locked dependencies first with `npm ci`. Stage the reviewed
source changes and the exporter/tests so Git identifies them as tracked files.
Stage new public documentation and packaging files as well. They must be on the explicit allowlist.
Then run from the preparing checkout:

```sh
python3 scripts/prepare_public_release.py --destination /absolute/path/to/new-cloudmaru-source
```

The destination must be a new absolute directory outside the source checkout,
with an existing parent. Existing files/directories are never overwritten. The
directory is created with owner-only permissions. Validation happens before
creation; an interrupted filesystem write can leave an incomplete directory.
Review or remove that directory manually and choose another new destination.
Never publish an incomplete export.

## Export boundary

Only files returned by `git ls-files --cached` and admitted by the source
allowlist are copied. The bytes come from the current working files, including
reviewed unstaged modifications; they do not come from a historical commit.
Every copied source file has a SHA-256 in the readiness report. Stop concurrent
edits before preparing the final candidate, then review those exact bytes.
Symlink files and source path components are rejected.

The source allowlist includes:

- `src/**`, including tests and fixture data, and SQL migrations.
- Package/lock files, TypeScript/Vitest/ESLint/Tailwind/Next configuration,
  `.env.example` and `.gitignore`.
- TypeScript scripts and tests, browser acceptance fixture JSON, and the
  `local_snapshot.py` and `prepare_public_release.py` operational tools/tests.
- The application eval inputs, implementation and tests under `evals/`, excluding
  generated results and the private agent harness.

Explicitly allowlisted public files include `README.md`, `README.ko.md`,
`LICENSE`, `THIRD_PARTY_NOTICES.md`, `Dockerfile`, `.dockerignore`, `compose.yaml`,
and `docs/{SELF_HOSTING,BACKUP_RESTORE,PUBLIC_RELEASE,DEMO,SETUP_DESIGN,REPORT_DESIGN}.md`.
Confirm each file's content and track it before export.

### Synthetic screenshots

The README screenshots are an exact allowlist of three files, captured
separately from the synthetic offline demo and reviewed before export:
`docs/demo-images/overview.png`, `docs/demo-images/resources.png` and
`docs/demo-images/first-checks.png`. Each must be a tracked, regular, non-symlinked file and is copied byte-for-byte. Any other entry under
`docs/demo-images/` — tracked (even if deleted on disk), untracked, hidden or in
a subfolder — stops preparation before the destination is created; it is not
silently skipped. A missing approved screenshot also stops preparation.
`synthetic_assets` in the readiness report lists each screenshot's path, byte
size and SHA-256; compare those with the independently reviewed captures. Never
replace a screenshot with one taken from a company workspace or another source.

When staging a clean release commit, use `git add --force -- release/licenses`
for the generated notice texts. Some of their paths contain `node_modules`,
which matches the application’s Git ignore rule.

The exporter excludes old Git history/refs, agent/MCP/hook configuration, phase
plans, historic/private documentation, company browser results, design exports,
local data/backups/environment files, dependency folders and build artifacts.
Sensitive key/database/log file extensions are excluded even under `src/`; the
reviewed public certificate fixture is an explicit exception. Additional future
file names require review of the allowlist, rather than copying entire folders.
The export rejects tracked local pricing folders and price snapshots outside
the bundled demo and frozen test fixtures. Every meter in those fixtures
must carry a synthetic identifier.

Because the agent harness and local Git hooks are intentionally excluded,
`evals:harness` and `hooks:install` are removed from the exported package scripts.
Application tests, demo scripts, application eval commands and their code remain
included. Private review/phase/OWASP Python automation and its tests are not
exported. No GitHub workflow is exported automatically. Validate any later public
CI workflow against this smaller source manifest.

## Dependency evidence and notices

`release/dependencies.json` inventories every non-root lockfile package entry,
including development and optional platform dependencies. For every installed
entry the exporter verifies its package version against the lock. Version drift
or symlinked dependency metadata/license files stops preparation.

Installed UTF-8 notice files named LICENSE/LICENCE, COPYING, NOTICE or COPYRIGHT
with supported text suffixes are copied byte-for-byte under `release/licenses/`,
preserving package-relative paths. Nested dependency directories are handled by
their own lock entries. The manifest records each text's source path, exported
path and SHA-256. This includes Pretendard's `dist/LICENSE.txt` (SIL OFL-1.1).
The reviewed top-level project license and custom third-party notices are also
included; generated evidence supplements those notices.

`release/readiness.json` distinguishes uninstalled dependency entries from
installed packages without discovered notice/license texts. Optional packages for
other platforms commonly are not installed locally. Their exact text is not
claimed to be verified. Resolve any missing notices for packages before shipping their code or embedded artifacts.
The source release includes lockfile references and available notices. Package
code, native binaries and fonts are fetched when an operator installs or builds.

This is a **source-only** export. A future Docker image, standalone server or
other binary bundle needs an inventory of its actual shipped modules/native
libraries, corresponding source and applicable notices. In particular, review
elkjs's EPL route, sharp/libvips's LGPL obligations, bundled PGlite components,
and Pretendard's OFL/copyright/reserved-name conditions. The exporter grants no
rights and makes no blanket determination about application licensing.

## Readiness and final review

The report always sets `ready_for_publication` and
`public_visibility_authorized` to false. No ownership clearance is inferred
from a successful export.

`excluded_tracked_count` is the number of tracked files left out. Their names
are deliberately not listed: they belong to the private checkout (internal
plans, browser audit results and similar) and must not appear in a public
report. Review exclusions in the private checkout with `git ls-files` instead.
`files` lists the path and SHA-256 of every exported file, and private-marker
findings name only exported files.

### Provenance and redistribution review list

`provenance_review` in the report carries the review list below. Every item has
a review status. The owner confirmed MIT publication rights for the personal
AzVision code and ported tests. Company validation material stays private.
`provenance_confirmations` repeats the evidence and pending decisions.

| Item | Scope | Owner decision |
| --- | --- | --- |
| AzVision-derived code | Logic ported from AzVision (ADR-020): `src/lib/inventory/{classify,normalize,relations,redact}.ts`, `src/lib/network/{analyze-path,service-tags,nsg,routes}.ts`, `src/lib/assessment/topology.ts` and the tests ported with them | MIT rights confirmed by the personal rights owner |
| Catalog, pricing and prose | `src/catalog/**` (rules, source links, reference architectures, synthetic price fixtures), `src/i18n/messages/**`, `evals/**` | See Microsoft credit, modification notes and license links in `THIRD_PARTY_NOTICES.md`. Each operator syncs Azure prices locally under Microsoft’s terms |
| Synthetic screenshots | The three `docs/demo-images/*.png` files above | Confirm the `synthetic_assets` hashes match the captures reviewed as synthetic-demo-only, and approve redistribution (font obligations sit with the dependency item) |
| Bundled dependencies | `package-lock.json`, `THIRD_PARTY_NOTICES.md`, `release/dependencies.json`, `release/licenses/**` | Review the files in the source release. Review license texts and other obligations for elkjs, libvips, PGlite and Pretendard before any future binary distribution |
| Publication approval | `release/readiness.json` | Confirm remaining markers are synthetic, rerun clean validation in the export, and explicitly approve before any public repository is created or changed |

Private-machine detectors report only classifications, occurrence counts and
file paths; `blocker_count` sums blocker occurrences. They match by shape, not by
any operator-specific value embedded in the exporter: macOS/Linux/Windows home
directories (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`), Tailscale
MagicDNS hosts (`*.ts.net`), Tailscale addresses (`100.64.0.0/10`,
`fd7a:115c:a1e0::/48`) and account project references. Regex-escaped dots are
normalized first, so an escaped literal cannot hide an address.

Classification depends on the value, not the file location. Only an exact,
intentionally neutral fixture value (home names `test`, `example`, `user`,
`username`; `mac.tail.ts.net`, `example.ts.net`, `100.64.0.0`, `100.64.1.1`) is
labeled `synthetic-context-review`. Any other match is a `blocker`, including in
tests and fixtures: a real local path left as a test fallback is still personal
data. Use placeholders such as `/absolute/path/to/bicep` in documentation and
an environment variable in tests. Generic private CIDRs, documentation addresses,
example UUIDs and synthetic redaction keys are not automatically unsafe findings.
Review exact source files privately. No matched values are printed in reports.
The detector is not a general secret scanner and cannot certify that all company
or proprietary information has been removed. Zero blockers does not make a
candidate ready: ownership/provenance confirmation and explicit publication
approval remain the final gate.

Real Bicep compiler tests never fall back to a machine-specific path. They read
`CLOUDSIGHT_TEST_BICEP_PATH` (the pinned CLI from [Native Bicep compiler](SELF_HOSTING.md#native-bicep-compiler)): unset
skips those tests explicitly, and a set but wrong path fails. Supply it when
validating a candidate that must exercise the real compiler.

Before approving publication:

1. Review the source/exception manifest, exclusions, remaining markers and all
   provenance confirmations. Sanitize the source and create a fresh candidate
   if anything changes. Resolve installed packages lacking license texts.
2. In the exported directory, run `npm ci`, `npm run lint`, `npm run build`,
   `npm run test` (with `CLOUDSIGHT_TEST_BICEP_PATH` set to the pinned CLI), and
   `python3 -m pytest scripts/ -q`. Confirm `blocker_count` is zero. Use synthetic/demo data;
   never copy a company DB, keys or `.env.local` to make validation pass.
3. Inspect the final archive and object graph of any newly initialized repository.
   Keep old branches, tags, objects, logs, screenshots and account configuration
   out. Decide separately whether to initialize a fresh Git repository and
   publish it; the preparation command performs neither action.
