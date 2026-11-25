"""Public exports use an explicit boundary and never carry private working data."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import zlib

import pytest

spec = importlib.util.spec_from_file_location("prepare_public_release", Path(__file__).with_name("prepare_public_release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def write(root, name, content=None):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content if content is not None else ("{}\n" if path.suffix == ".json" else "fixture\n"))
    return path


def png(seed=0):
    """A minimal valid 1x1 PNG whose pixel varies with ``seed``."""
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    header = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0))
    return (b"\x89PNG\r\n\x1a\n" + header
            + chunk(b"IDAT", zlib.compress(bytes([0, seed]))) + chunk(b"IEND", b""))


ASSETS = ["docs/demo-images/first-checks.png", "docs/demo-images/overview.png", "docs/demo-images/resources.png"]


def write_bytes(root, name, data):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "private"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    write(root, "package.json", json.dumps({"name": "fixture", "scripts": {
        "test": "vitest run", "demo:seed": "tsx scripts/demo-seed.ts",
        "evals:harness": "tsx evals/harness/run.ts", "hooks:install": "git config core.hooksPath .githooks"}}))
    write(root, "package-lock.json", json.dumps({"lockfileVersion": 3, "packages": {
        "": {"name": "fixture"}, "node_modules/font": {"version": "1.0.0", "license": "OFL-1.1"},
        "node_modules/optional": {"version": "2.0.0", "optional": True, "license": "MIT"}}}))
    for name in ["src/app/page.tsx", "src/lib/unit.test.ts", "db/migrations/0001.sql",
                 "scripts/browser-test/fixtures/data.json", "scripts/browser-test/seed.test.ts",
                 "scripts/demo-seed.ts", "scripts/local_snapshot.py", "scripts/test_local_snapshot.py",
                 "evals/scenarios.json", "evals/scenario.test.ts", "vitest.config.ts", ".env.example",
                 "docs/PRD.md", "docs/BROWSER_TEST_RESULTS.md", "docs/design/support.js", "AGENTS.md",
                 ".mcp.json", ".claude/settings.json", "phases/step.md", "scripts/execute.py",
                 "scripts/test_hooks.py", "evals/harness/run.ts", "evals/results/private.json"]:
        write(root, name)
    # Public documents and reviewed assets are tracked before export.
    for name in ["README.md", "README.ko.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "Dockerfile", "docs/DEMO.md"]:
        write(root, name)
    for seed, name in enumerate(ASSETS):
        write_bytes(root, name, png(seed=seed))
    snapshot = synthetic_price_snapshot()
    evidence = {"evidence": {"catalog": {"prices": snapshot}}}
    write(root, "src/catalog/prices.json", json.dumps(snapshot))
    write(root, "src/lib/extend/legacy-evidence.test-data.json", json.dumps(evidence))
    write(root, "src/lib/extend/pre-intent-counted.test-data.json",
          json.dumps({"postgres-mapping-v1": evidence, "pre-deployment": evidence}))
    subprocess.run(["git", "-C", str(root), "add", "."], check=True)
    write(root, "src/untracked-secret.ts")
    write(root, ".env.local", "not for export")
    write(root, "node_modules/font/package.json", '{"version":"1.0.0"}')
    write(root, "node_modules/font/dist/LICENSE.txt", "OFL font fixture license\n")
    write(root, "node_modules/font/NOTICE", "Font attribution\n")
    return root


def test_export_boundary_package_scripts_and_exact_license_texts(project, tmp_path):
    destination = tmp_path / "public"
    result = release.prepare(project, destination)
    for name in ["src/app/page.tsx", "src/lib/unit.test.ts", "scripts/browser-test/seed.test.ts",
                 "scripts/local_snapshot.py", "scripts/demo-seed.ts", "evals/scenario.test.ts",
                 "README.md", "README.ko.md", "docs/DEMO.md", "LICENSE", "Dockerfile"]:
        assert (destination / name).is_file(), name
    for name in [".git", ".env.local", ".mcp.json", "AGENTS.md", ".claude", "phases",
                 "docs/PRD.md", "docs/BROWSER_TEST_RESULTS.md", "docs/design", "scripts/execute.py",
                 "scripts/test_hooks.py", "src/untracked-secret.ts", "evals/harness", "evals/results"]:
        assert not (destination / name).exists(), name
    scripts = json.loads((destination / "package.json").read_text())["scripts"]
    assert scripts == {"test": "vitest run", "demo:seed": "tsx scripts/demo-seed.ts"}
    inventory = json.loads((destination / "release/dependencies.json").read_text())
    font = next(item for item in inventory if item["path"] == "node_modules/font")
    assert font["installed"] and font["version"] == "1.0.0"
    assert len(font["texts"]) == 2
    assert { (destination / item["export"]).read_text() for item in font["texts"] } == {
        "OFL font fixture license\n", "Font attribution\n"}
    assert not next(item for item in inventory if item["path"] == "node_modules/optional")["installed"]
    assert result["public_visibility_authorized"] is False
    assert result["provenance_confirmations"]
    assert (destination / "release/readiness.json").is_file()


@pytest.mark.parametrize("kind", ["existing", "relative", "inside_source", "ancestor"])
def test_destination_must_be_new_absolute_outside_source(project, tmp_path, kind):
    destination = {"existing": tmp_path, "relative": Path("relative"),
                   "inside_source": project / "public", "ancestor": project.parent}[kind]
    with pytest.raises(release.ReleaseError):
        release.prepare(project, destination)
    assert not (project / "public").exists()


def test_reject_symlink_even_when_tracked(project, tmp_path):
    (project / "src/app/page.tsx").unlink()
    (project / "src/app/page.tsx").symlink_to(project / ".env.local")
    with pytest.raises(release.ReleaseError, match="symlink"):
        release.prepare(project, tmp_path / "public")
    assert not (tmp_path / "public").exists()


def test_reject_installed_dependency_version_drift_before_writing(project, tmp_path):
    write(project, "node_modules/font/package.json", '{"version":"99.0.0"}')
    with pytest.raises(release.ReleaseError, match="version"):
        release.prepare(project, tmp_path / "public")
    assert not (tmp_path / "public").exists()


def test_license_symlink_is_never_copied(project, tmp_path):
    (project / "node_modules/font/NOTICE").unlink()
    (project / "node_modules/font/NOTICE").symlink_to(project / ".env.local")
    with pytest.raises(release.ReleaseError, match="symlink"):
        release.prepare(project, tmp_path / "public")


def test_reports_private_markers_without_values_and_classifies_tests(project, tmp_path):
    marker = "/Users/" + "alex-operator/private-path"
    write(project, "src/app/page.tsx", marker)
    write(project, "src/lib/unit.test.ts", "/home/test/fixture\n10.0.0.1\n" + "sk-ant-synthetic-only")
    result = release.prepare(project, tmp_path / "public")
    serialized = json.dumps(result)
    assert marker not in serialized and "sk-ant-synthetic-only" not in serialized
    findings = {entry["path"]: entry for entry in result["private_markers"]}
    assert findings["src/app/page.tsx"]["classification"] == "blocker"
    assert findings["src/lib/unit.test.ts"]["classification"] == "synthetic-context-review"
    assert findings["src/lib/unit.test.ts"]["count"] == 1
    assert result["blocker_count"] == 1
    assert result["ready_for_publication"] is False


# Real-looking values are assembled at runtime so this test file never carries them literally.
REAL_HOME = "/Users/" + "alex-operator/.codex/tools/bicep"
REAL_LINUX_HOME = "/home/" + "alex-operator/bin"
REAL_WINDOWS_HOME = "C:" + "\\Users\\" + "alex-operator\\bin"
REAL_JSON_WINDOWS_HOME = "C:" + "\\\\Users\\\\" + "alex-operator"
REAL_TAILNET_HOST = "build-box." + "tail1a2b3c" + ".ts.net"
REAL_TAILNET_IP = "100." + "101.102.103"
REAL_TAILNET_IPV6 = "fd7a:" + "115c:a1e0::1234"


@pytest.mark.parametrize("value, category", [
    (REAL_HOME, "personal_home"), (REAL_LINUX_HOME, "personal_home"), (REAL_WINDOWS_HOME, "personal_home"),
    (REAL_JSON_WINDOWS_HOME, "personal_home"),
    (REAL_TAILNET_HOST, "personal_tailnet"), (REAL_TAILNET_IP, "personal_tailnet"),
    (REAL_TAILNET_IPV6, "personal_tailnet"),
    # A regex-escaped literal is still the same machine address.
    (REAL_TAILNET_IP.replace(".", "\\."), "personal_tailnet"),
])
@pytest.mark.parametrize("path", ["src/lib/compiler.test.ts", "scripts/test_tool.py",
                                  "src/lib/fixtures/data.json", "scripts/tool.py"])
def test_real_personal_values_are_blockers_even_in_tests_and_fixtures(value, category, path):
    findings = release.private_markers({path: f"const fallback = '{value}';\n".encode()})
    assert findings == [{"path": path, "category": category, "count": 1, "classification": "blocker"}]


@pytest.mark.parametrize("value, category", [
    ("/home/test/data", "personal_home"), ("/Users/example/project", "personal_home"),
    ("/absolute/path/to/bicep", None), ("mac.tail.ts.net", "personal_tailnet"),
    ("MAC.TAIL.TS.NET", "personal_tailnet"), ("100.64.1.1", "personal_tailnet"),
    ("100.64.0.0", "personal_tailnet"), ("10.0.0.1", None), ("192.0.2.10", None),
])
def test_exact_intentional_neutral_fixtures_are_review_not_blockers(value, category):
    findings = release.private_markers({"src/lib/guard.test.ts": value.encode()})
    if category is None:
        assert findings == []
    else:
        assert findings == [{"path": "src/lib/guard.test.ts", "category": category, "count": 1,
                             "classification": "synthetic-context-review"}]


def test_neutral_value_mixed_with_real_value_is_a_blocker():
    content = f"/home/test/a\n{REAL_HOME}\n".encode()
    assert release.private_markers({"src/a.test.ts": content}) == [
        {"path": "src/a.test.ts", "category": "personal_home", "count": 2, "classification": "blocker"}]


def test_exporter_and_its_tests_carry_no_personal_markers():
    here = Path(__file__).resolve().parent
    files = {f"scripts/{name}": (here / name).read_bytes()
             for name in ["prepare_public_release.py", "test_prepare_public_release.py"]}
    assert [f for f in release.private_markers(files) if f["classification"] == "blocker"] == []


def test_unknown_untracked_public_doc_is_not_reviewed_by_directory(project, tmp_path):
    write(project, "docs/UNKNOWN.md", "private")
    release.prepare(project, tmp_path / "public")
    assert not (tmp_path / "public/docs/UNKNOWN.md").exists()


def test_sensitive_artifact_names_are_excluded_even_if_tracked(project, tmp_path):
    for name in ["src/.env.local", "src/backup.sqlite", "src/certificate.pfx", "src/key.pem",
                 "src/nested/.data/secret.json", "src/nested/node_modules/package.json"]:
        write(project, name)
        subprocess.run(["git", "-C", str(project), "add", name], check=True)
    write(project, "src/lib/scans/fixtures/test-certificate.pem", "public certificate fixture")
    subprocess.run(["git", "-C", str(project), "add", "src/lib/scans/fixtures/test-certificate.pem"], check=True)
    release.prepare(project, tmp_path / "public")
    for name in ["src/.env.local", "src/backup.sqlite", "src/certificate.pfx", "src/key.pem",
                 "src/nested/.data/secret.json", "src/nested/node_modules/package.json"]:
        assert not (tmp_path / "public" / name).exists()
    assert (tmp_path / "public/src/lib/scans/fixtures/test-certificate.pem").is_file()


def test_missing_installed_notices_are_distinct_from_uninstalled_optional(project, tmp_path):
    (project / "node_modules/font/NOTICE").unlink()
    (project / "node_modules/font/dist/LICENSE.txt").unlink()
    result = release.prepare(project, tmp_path / "public")
    assert result["installed_dependencies_without_texts"] == ["node_modules/font"]
    assert result["uninstalled_dependencies"] == ["node_modules/optional"]


def test_synthetic_asset_allowlist_is_exact():
    assert release.SYNTHETIC_ASSETS == frozenset(ASSETS)


def test_synthetic_assets_are_exported_byte_for_byte_with_hashes_in_readiness(project, tmp_path):
    destination = tmp_path / "public"
    result = release.prepare(project, destination)
    expected = []
    for name in ASSETS:
        data = (project / name).read_bytes()
        assert (destination / name).read_bytes() == data
        expected.append({"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
    readiness = json.loads((destination / "release/readiness.json").read_text())
    assert readiness["synthetic_assets"] == expected == result["synthetic_assets"]
    hashes = {item["path"]: item["sha256"] for item in readiness["files"]}
    assert all(hashes[item["path"]] == item["sha256"] for item in expected)
    assert sorted(p.name for p in (destination / "docs/demo-images").iterdir()) == [
        "first-checks.png", "overview.png", "resources.png"]


@pytest.mark.parametrize("extra, tracked", [
    ("docs/demo-images/company.png", False), ("docs/demo-images/company.png", True),
    ("docs/demo-images/.DS_Store", False), ("docs/demo-images/nested/overview.png", False),
    ("docs/demo-images/overview.jpg", True),
])
def test_unapproved_file_under_demo_images_is_rejected(project, tmp_path, extra, tracked):
    write_bytes(project, extra, png(seed=9))
    if tracked:
        subprocess.run(["git", "-C", str(project), "add", "-f", extra], check=True)
    with pytest.raises(release.ReleaseError, match="unapproved"):
        release.prepare(project, tmp_path / "public")
    assert not (tmp_path / "public").exists()


def test_tracked_unapproved_asset_is_rejected_even_when_deleted_on_disk(project, tmp_path):
    write_bytes(project, "docs/demo-images/old.png", png(seed=9))
    subprocess.run(["git", "-C", str(project), "add", "-f", "docs/demo-images/old.png"], check=True)
    (project / "docs/demo-images/old.png").unlink()
    with pytest.raises(release.ReleaseError, match="unapproved"):
        release.prepare(project, tmp_path / "public")


def test_missing_approved_asset_is_rejected(project, tmp_path):
    (project / ASSETS[0]).unlink()
    with pytest.raises(release.ReleaseError, match="missing"):
        release.prepare(project, tmp_path / "public")
    assert not (tmp_path / "public").exists()


def test_symlinked_asset_is_rejected(project, tmp_path):
    (project / ASSETS[1]).unlink()
    (project / ASSETS[1]).symlink_to(project / ".env.local")
    with pytest.raises(release.ReleaseError, match="symlink"):
        release.prepare(project, tmp_path / "public")


def test_readiness_counts_exclusions_without_naming_private_tracked_paths(project, tmp_path):
    # A personal marker in an excluded tracked file never reaches the scoped review either.
    write(project, "docs/BROWSER_TEST_RESULTS.md", REAL_HOME)
    destination = tmp_path / "public"
    result = release.prepare(project, destination)
    assert "excluded_tracked_paths" not in result
    assert result["excluded_tracked_count"] == 11
    report = (destination / "release/readiness.json").read_text()
    for private in ["docs/BROWSER_TEST_RESULTS.md", "BROWSER_TEST_RESULTS", "phases/step.md", "docs/PRD.md",
                    "AGENTS.md", ".mcp.json", "evals/results/private.json", "scripts/execute.py"]:
        assert private not in report, private
    assert json.loads(report)["excluded_tracked_count"] == 11
    assert all(item["path"] in {f["path"] for f in result["files"]} for item in result["private_markers"])


def test_provenance_review_list_records_owner_decisions_not_resolved_rights(project, tmp_path):
    result = release.prepare(project, tmp_path / "public")
    review = result["provenance_review"]
    assert [item["id"] for item in review] == [
        "azvision-derived-code", "catalog-pricing-prose", "synthetic-assets", "bundled-dependencies",
        "publication-approval"]
    for item in review:
        assert item["status"] == ("owner-confirmed" if item["id"] == "azvision-derived-code" else "owner-decision-required")
        assert item["scope"] and item["decision"]
    assets = next(item for item in review if item["id"] == "synthetic-assets")
    assert sorted(assets["scope"]) == ASSETS
    assert result["provenance_confirmations"] == [item["decision"] for item in review]
    assert result["ready_for_publication"] is False and result["public_visibility_authorized"] is False


def synthetic_price_snapshot():
    return {"asOf": "2026-01-15", "currency": "CAD", "regions": ["canadacentral"],
            "usdToCad": {"rate": 1.25, "pairs": 5},
            "prices": {"sample": {"canadacentral": {
                "meterId": "synthetic:sample:canadacentral:1", "unitOfMeasure": "1 Hour",
                "tiers": [{"minUnits": 0, "unitPrice": 0.08}]}}}}


@pytest.mark.parametrize("name, mutation", [
    ("src/catalog/prices.json", "real-meter"),
    ("src/catalog/prices.json", "missing-key"),
    ("src/lib/copied.json", "foreign-snapshot"),
    ("src/lib/prices-copy.json", "renamed-file"),
    (".cloudmaru-pricing/prices.json", "operator-file"),
    ("src/lib/extend/legacy-evidence.test-data.json", "stripped-marker"),
])
def test_reject_redistributable_price_data_only_from_the_reviewed_fixtures(project, tmp_path, name, mutation):
    snapshot = synthetic_price_snapshot()
    entry = snapshot["prices"]["sample"]["canadacentral"]
    if mutation == "real-meter":
        entry["meterId"] = "meter-fixture"
    if mutation == "stripped-marker":
        del entry["meterId"]
        snapshot = {"evidence": {"catalog": {"prices": snapshot}}}
    if mutation == "missing-key":
        del snapshot["asOf"]
    if mutation == "renamed-file":
        snapshot = {"example": "unrecognized price file"}
    if mutation == "foreign-snapshot":
        snapshot = {"nested": [snapshot]}
    write(project, name, json.dumps(snapshot))
    subprocess.run(["git", "-C", str(project), "add", "-f", name], check=True)
    with pytest.raises(release.ReleaseError, match="pricing|price"):
        release.prepare(project, tmp_path / "public")
    assert not (tmp_path / "public").exists()


def test_excludes_untracked_allowlisted_docs(project, tmp_path):
    write(project, "docs/PUBLIC_RELEASE.md", "untracked")
    release.prepare(project, tmp_path / "public")
    assert not (tmp_path / "public/docs/PUBLIC_RELEASE.md").exists()


def test_notice_export_omits_license_named_scripts_and_binary_files(project, tmp_path):
    write(project, "node_modules/font/license-update.mjs", "export const update = true;")
    write_bytes(project, "node_modules/font/COPYRIGHT.txt", b"\0binary")
    write(project, "node_modules/font/LICENSE-BSD", "BSD notice for bundled code")
    destination = tmp_path / "public"

    release.prepare(project, destination)

    assert not (destination / "release/licenses/font/license-update.mjs").exists()
    assert not (destination / "release/licenses/font/COPYRIGHT.txt").exists()
    assert (destination / "release/licenses/font/LICENSE-BSD").read_text() == "BSD notice for bundled code"
