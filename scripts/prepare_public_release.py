"""Build a reviewable source-only export; never publish or copy Git history."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys


class ReleaseError(ValueError):
    """A boundary or dependency verification failed before export."""


PUBLIC_DOCS = {
    "README.md", "README.ko.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "Dockerfile", ".dockerignore", "compose.yaml",
    "docs/SELF_HOSTING.md", "docs/BACKUP_RESTORE.md", "docs/PUBLIC_RELEASE.md", "docs/DEMO.md",
    "docs/SETUP_DESIGN.md", "docs/REPORT_DESIGN.md",
}
ROOT_FILES = {
    "package.json", "package-lock.json", "components.json", "eslint.config.mjs", "next.config.ts",
    "postcss.config.mjs", "tsconfig.json", "vitest.config.ts", ".env.example", ".gitignore",
}
PYTHON_SCRIPTS = {
    "scripts/local_snapshot.py", "scripts/test_local_snapshot.py",
    "scripts/prepare_public_release.py", "scripts/test_prepare_public_release.py",
}
# Separately captured, reviewed synthetic screenshots. The set is exact: any other entry under
# the directory (tracked or on disk) stops preparation instead of being silently skipped.
SYNTHETIC_ASSET_DIR = "docs/demo-images"
SYNTHETIC_ASSETS = frozenset({
    "docs/demo-images/overview.png", "docs/demo-images/resources.png", "docs/demo-images/first-checks.png",
})
SYNTHETIC_PRICE_FILES = {
    "src/catalog/prices.json",
    "src/lib/extend/legacy-evidence.test-data.json",
    "src/lib/extend/pre-intent-counted.test-data.json",
}
PRICE_SIGNATURE = {"asOf", "usdToCad", "prices"}


def find_price_snapshots(value):
    if isinstance(value, dict):
        if PRICE_SIGNATURE <= value.keys():
            yield value
        for item in value.values():
            yield from find_price_snapshots(item)
    elif isinstance(value, list):
        for item in value:
            yield from find_price_snapshots(item)


def validate_synthetic_snapshot(snapshot):
    if not isinstance(snapshot, dict) or set(snapshot) != PRICE_SIGNATURE | {"currency", "regions"}:
        return False
    regions = snapshot["regions"]
    prices = snapshot["prices"]
    if (snapshot["currency"] != "CAD" or not isinstance(snapshot["asOf"], str)
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", snapshot["asOf"])
            or not isinstance(regions, list) or not regions or not all(isinstance(r, str) for r in regions)
            or len(set(regions)) != len(regions) or not isinstance(prices, dict) or not prices):
        return False
    fx = snapshot["usdToCad"]
    if not isinstance(fx, dict) or set(fx) != {"rate", "pairs"}:
        return False

    def finite_number(value):
        return type(value) in (int, float) and math.isfinite(value)

    if not finite_number(fx["rate"]) or fx["rate"] <= 0 or type(fx["pairs"]) is not int or fx["pairs"] <= 0:
        return False
    for by_region in prices.values():
        if not isinstance(by_region, dict) or set(by_region) != set(regions):
            return False
        for entry in by_region.values():
            if (not isinstance(entry, dict) or set(entry) != {"meterId", "unitOfMeasure", "tiers"}
                    or not isinstance(entry["meterId"], str) or not entry["meterId"].startswith("synthetic:")
                    or not isinstance(entry["unitOfMeasure"], str)
                    or not isinstance(entry["tiers"], list) or not entry["tiers"]):
                return False
            previous = -1
            for tier in entry["tiers"]:
                if (not isinstance(tier, dict) or set(tier) != {"minUnits", "unitPrice"}
                        or not finite_number(tier["minUnits"]) or not finite_number(tier["unitPrice"])
                        or tier["minUnits"] <= previous or tier["unitPrice"] < 0
                        or (previous == -1 and tier["minUnits"] != 0)):
                    return False
                previous = tier["minUnits"]
    return True


def check_price_files(files):
    if SYNTHETIC_PRICE_FILES - files.keys():
        raise ReleaseError("required synthetic price fixtures are missing")
    for name, content in files.items():
        path = PurePosixPath(name)
        if path.suffix.lower() != ".json":
            continue
        if name not in SYNTHETIC_PRICE_FILES and path.name.lower().startswith("prices"):
            raise ReleaseError(f"unapproved price file: {name}")
        try:
            document = json.loads(content)
        except (ValueError, OverflowError) as error:
            raise ReleaseError(f"invalid release JSON: {name}") from error
        embedded = list(find_price_snapshots(document))
        if name not in SYNTHETIC_PRICE_FILES:
            if embedded:
                raise ReleaseError(f"unapproved embedded price snapshot: {name}")
            continue
        try:
            if name == "src/catalog/prices.json":
                expected = [document]
            elif name.endswith("/legacy-evidence.test-data.json"):
                expected = [document["evidence"]["catalog"]["prices"]]
            else:
                expected = [document[profile]["evidence"]["catalog"]["prices"]
                            for profile in ("postgres-mapping-v1", "pre-deployment")]
            valid = sorted(map(id, expected)) == sorted(map(id, embedded)) and all(
                validate_synthetic_snapshot(snapshot) for snapshot in expected)
        except (KeyError, TypeError, OverflowError):
            valid = False
        if not valid:
            raise ReleaseError(f"non-synthetic or malformed price fixture: {name}")


# Provenance/redistribution review list. Every item is a decision the owner must still make;
# a successful export never marks any of them resolved.
PROVENANCE_REVIEW = [
    {"id": "azvision-derived-code",
     "status": "owner-confirmed",
     "subject": "Logic ported to TypeScript from the owner's earlier AzVision project (ADR-020).",
     "scope": ["src/lib/inventory/classify.ts", "src/lib/inventory/normalize.ts",
               "src/lib/inventory/relations.ts", "src/lib/inventory/redact.ts",
               "src/lib/network/analyze-path.ts", "src/lib/network/service-tags.ts",
               "src/lib/network/nsg.ts", "src/lib/network/routes.ts", "src/lib/assessment/topology.ts",
               "and the tests ported with them"],
     "decision": "The owner confirmed MIT publication rights for the ported implementations and tests. "
                 "Company validation material is excluded."},
    {"id": "catalog-pricing-prose",
     "subject": "Catalog entries, rules, source links, synthetic price fixtures and explanatory prose.",
     "scope": ["src/catalog/**", "src/i18n/messages/**", "evals/**"],
     "decision": "Retain upstream attribution for Microsoft documentation-derived wording. "
                 "Azure price data is synced locally by the operator and excluded from distribution."},
    {"id": "synthetic-assets",
     "subject": "README screenshots captured from the synthetic offline demo only.",
     "scope": sorted(SYNTHETIC_ASSETS),
     "decision": "Owner confirms the exported screenshot hashes (synthetic_assets) match the captures "
                 "reviewed as synthetic-demo-only, and approves redistributing them."},
    {"id": "bundled-dependencies",
     "subject": "Locked npm dependencies, fonts and native/binary components.",
     "scope": ["package-lock.json", "THIRD_PARTY_NOTICES.md", "release/dependencies.json", "release/licenses/**"],
     "decision": "Owner reviews dependency obligations (including elkjs EPL, libvips LGPL, PGlite and "
                 "Pretendard OFL) per distributed artifact and resolves packages lacking license texts."},
    {"id": "publication-approval",
     "subject": "Fixture review, clean validation and the publication step itself.",
     "scope": ["release/readiness.json"],
     "decision": "Owner confirms remaining markers are synthetic, reruns clean install/lint/build/tests in "
                 "the export, and explicitly approves before any public repository is created or changed."},
]
PROVENANCE = [item["decision"] for item in PROVENANCE_REVIEW]


def allowed(name):
    """Directory membership alone never admits new untracked source or private docs."""
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        return False
    if any(part in {".git", ".data", "node_modules", ".next", "backups", "__pycache__"} for part in path.parts):
        return False
    if path.name.startswith(".env") and name != ".env.example":
        return False
    if path.suffix.lower() in {".pem", ".key", ".pfx", ".p12", ".db", ".sqlite", ".sqlite3", ".log"}:
        if name != "src/lib/scans/fixtures/test-certificate.pem":
            return False
    if name in PUBLIC_DOCS | ROOT_FILES | PYTHON_SCRIPTS:
        return True
    if name.startswith("src/") or (name.startswith("db/migrations/") and name.endswith(".sql")):
        return True
    if name.startswith("scripts/"):
        return name.endswith((".ts", ".tsx")) or (
            name.startswith("scripts/browser-test/fixtures/") and name.endswith(".json"))
    return name.startswith("evals/") and not name.startswith(("evals/harness/", "evals/results/"))


def check_synthetic_assets(root, tracked):
    """Admit exactly the approved screenshot set; reject anything else in that directory."""
    prefix = SYNTHETIC_ASSET_DIR + "/"
    entries = {name for name in tracked if name.startswith(prefix)}
    untracked = SYNTHETIC_ASSETS - entries
    if untracked:
        raise ReleaseError(f"missing tracked synthetic assets: {len(untracked)}")
    folder = root / SYNTHETIC_ASSET_DIR
    if folder.is_symlink():
        raise ReleaseError("symlink rejected: " + SYNTHETIC_ASSET_DIR)
    if folder.is_dir():
        for current, dirs, files in os.walk(folder, followlinks=False):
            for entry in dirs + files:
                entries.add((Path(current) / entry).relative_to(root).as_posix())
    if entries - SYNTHETIC_ASSETS:
        raise ReleaseError(f"unapproved files under {SYNTHETIC_ASSET_DIR}: {len(entries - SYNTHETIC_ASSETS)}")
    return {name: checked_file(root, name).read_bytes() for name in sorted(SYNTHETIC_ASSETS)}


def checked_file(root, name):
    path = root / name
    current = root
    for part in Path(name).parts:
        current /= part
        if current.is_symlink():
            raise ReleaseError(f"symlink rejected: {name}")
    if not path.is_file():
        raise ReleaseError(f"missing regular file: {name}")
    return path


def digest(data):
    return hashlib.sha256(data).hexdigest()


NOTICE_SUFFIXES = {"", ".txt", ".md", ".markdown", ".rst", ".html", ".htm",
                   ".bsd", ".closure-compiler", ".esprima"}


def license_inventory(root, packages):
    inventory, texts = [], {}
    for name, entry in sorted(packages.items()):
        if not name:
            continue
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or not name.startswith("node_modules/"):
            raise ReleaseError("unsupported lockfile package path")
        item = {"path": name, "version": entry.get("version"), "license": entry.get("license"),
                "dev": bool(entry.get("dev")), "optional": bool(entry.get("optional")),
                "resolved": entry.get("resolved"), "integrity": entry.get("integrity"),
                "installed": False, "texts": []}
        package = root / name
        if package.exists() or package.is_symlink():
            metadata = json.loads(checked_file(root, name + "/package.json").read_text())
            if metadata.get("version") != entry.get("version"):
                raise ReleaseError(f"installed version differs from lock: {name}")
            item["installed"] = True
            for folder, dirs, files in os.walk(package, followlinks=False):
                # Nested dependencies have their own exact lock entries.
                dirs[:] = sorted(d for d in dirs if d != "node_modules" and not (Path(folder) / d).is_symlink())
                for filename in sorted(files):
                    if (Path(filename).suffix.lower() not in NOTICE_SUFFIXES
                            or not re.fullmatch(r"(?i)(licen[sc]e|copying|notice|copyright)(?:[._-].*)?", filename)):
                        continue
                    local = (Path(folder) / filename).relative_to(root).as_posix()
                    data = checked_file(root, local).read_bytes()
                    if b"\0" in data:
                        continue
                    try:
                        data.decode("utf-8")
                    except UnicodeDecodeError:
                        continue
                    output = "release/licenses/" + local.removeprefix("node_modules/")
                    texts[output] = data
                    item["texts"].append({"source": local, "export": output, "sha256": digest(data)})
        inventory.append(item)
    return inventory, texts


# Generic personal-machine markers. No operator-specific value is embedded here; real local
# values are matched by shape and only exact, intentionally neutral fixture values are review-only.
MARKER_PATTERNS = {
    "personal_home": re.compile(
        r"(?:(?<![\w.-])/(?:Users|home)/|\b[A-Za-z]:\\{1,2}Users\\{1,2})(?P<value>[A-Za-z0-9._-]+)"),
    "personal_tailnet": re.compile(
        r"(?i)\b(?P<value>(?:[a-z0-9-]+\.)+ts\.net|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])"
        r"\.\d{1,3}\.\d{1,3}|fd7a:115c:a1e0:[0-9a-f:]*)\b"),
    "account_project_reference": re.compile(r"project_ref=(?P<value>[a-z0-9]{12,})"),
}
NEUTRAL_VALUES = {
    "personal_home": {"test", "example", "user", "username"},
    # Placeholder tailnet hosts and the CGNAT range boundary / documented fixture address.
    "personal_tailnet": {"mac.tail.ts.net", "example.ts.net", "100.64.0.0", "100.64.1.1"},
    "account_project_reference": set(),
}


def private_markers(files):
    """Report marker counts by file without values; any non-neutral value is a publication blocker."""
    findings = []
    for name, data in sorted(files.items()):
        try:
            content = data.decode("utf-8")
        except UnicodeDecodeError:
            continue
        # Regex-escaped literals (e.g. ``100\.x``) must not hide a real value from the scan.
        content = content.replace("\\.", ".")
        for category, pattern in MARKER_PATTERNS.items():
            values = [match.group("value").lower() for match in pattern.finditer(content)]
            if values:
                neutral = all(value in NEUTRAL_VALUES[category] for value in values)
                findings.append({"path": name, "category": category, "count": len(values),
                                 "classification": "synthetic-context-review" if neutral else "blocker"})
    return findings


def prepare(source, destination):
    source, destination = Path(source).resolve(), Path(destination)
    if not destination.is_absolute():
        raise ReleaseError("destination must be absolute")
    if destination.exists() or destination.is_symlink():
        raise ReleaseError("destination must not exist")
    resolved = destination.resolve()
    if resolved.is_relative_to(source) or source.is_relative_to(resolved):
        raise ReleaseError("destination must be outside the source tree")
    if not destination.parent.is_dir():
        raise ReleaseError("destination parent must already exist")
    result = subprocess.run(["git", "-C", str(source), "ls-files", "-z", "--cached"], capture_output=True)
    if result.returncode:
        raise ReleaseError("source must be a Git working tree")
    tracked = set(result.stdout.decode().rstrip("\0").split("\0")) - {""}
    if any(".cloudmaru-pricing" in PurePosixPath(name).parts for name in tracked):
        raise ReleaseError("tracked operator pricing path")
    names = {name for name in tracked if allowed(name)}
    assets = check_synthetic_assets(source, tracked)
    files = {name: checked_file(source, name).read_bytes() for name in sorted(names)}
    files.update(assets)
    names.update(assets)
    check_price_files(files)
    for required in ["package.json", "package-lock.json", "README.md", "README.ko.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]:
        if required not in files:
            raise ReleaseError(f"required public file missing: {required}")
    package = json.loads(files["package.json"])
    removed = []
    for script in ("hooks:install", "evals:harness"):
        if script in package.get("scripts", {}):
            package["scripts"].pop(script)
            removed.append(script)
    files["package.json"] = (json.dumps(package, indent=2, ensure_ascii=False) + "\n").encode()
    lock = json.loads(files["package-lock.json"])
    inventory, texts = license_inventory(source, lock.get("packages", {}))
    findings = private_markers(files)
    report = {
        "format": "cloudsight-public-source-v1", "source_only": True, "generated_preflight": True,
        "public_visibility_authorized": False, "ready_for_publication": False,
        "provenance_confirmations": PROVENANCE,
        "provenance_review": [{"status": "owner-decision-required", **item} for item in PROVENANCE_REVIEW],
        "private_markers": findings,
        "marker_count": sum(item["count"] for item in findings),
        "blocker_count": sum(item["count"] for item in findings if item["classification"] == "blocker"),
        "removed_package_scripts": removed,
        # Count only: excluded names belong to the private checkout and are not public data.
        "excluded_tracked_count": len(tracked - names),
        "reviewed_new_public_paths": sorted(names - tracked),
        "dependencies_without_installed_texts": [item["path"] for item in inventory if not item["texts"]],
        "installed_dependencies_without_texts": [item["path"] for item in inventory
                                                  if item["installed"] and not item["texts"]],
        "uninstalled_dependencies": [item["path"] for item in inventory if not item["installed"]],
        "synthetic_assets": [{"path": name, "sha256": digest(data), "bytes": len(data)}
                             for name, data in sorted(assets.items())],
        "files": [{"path": name, "sha256": digest(data)} for name, data in sorted(files.items())],
        "limits": ["Private-marker matching is narrow and does not certify absence of secrets or proprietary data.",
                   "Installed license texts are not a complete inventory of embedded binary components.",
                   "Uninstalled optional packages are inventoried but have no locally verified license texts.",
                   "The source checkout may change concurrently; each exported byte is hashed for review."],
    }
    outputs = dict(files)
    outputs.update(texts)
    outputs["release/dependencies.json"] = (json.dumps(inventory, indent=2) + "\n").encode()
    outputs["release/readiness.json"] = (json.dumps(report, indent=2) + "\n").encode()
    # Complete validation precedes the sole exclusive creation. No overwrite/cleanup fallback.
    destination.mkdir(mode=0o700)
    for name, data in sorted(outputs.items()):
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as output:
            output.write(data)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", required=True, type=Path, help="NEW absolute directory; never overwritten")
    args = parser.parse_args()
    try:
        report = prepare(Path(__file__).resolve().parent.parent, args.destination)
    except (ReleaseError, OSError, ValueError) as error:
        # Avoid exception payloads from malformed/private input values.
        print(f"Release preparation failed ({type(error).__name__}); no publication performed.", file=sys.stderr)
        return 1
    print(json.dumps({"exported_files": len(report["files"]), "synthetic_assets": report["synthetic_assets"],
                      "private_marker_count": report["marker_count"],
                      "blocker_count": report["blocker_count"],
                      "findings": report["private_markers"], "ready_for_publication": False}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
