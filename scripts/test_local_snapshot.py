"""Offline snapshot contract: never overwrite, follow links, or trust corrupt copies."""
import importlib.util
import json
from pathlib import Path
import os
import shutil
import subprocess
import pytest

spec = importlib.util.spec_from_file_location("local_snapshot", Path(__file__).with_name("local_snapshot.py"))
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


def fixture(tmp_path):
    data, secrets = tmp_path / "source-data", tmp_path / "source-secrets"
    data.mkdir()
    secrets.mkdir()
    (data / "PG_VERSION").write_text("17")
    (data / "base").mkdir()
    (data / "base" / "1").write_bytes(b"saved database")
    (secrets / "workspace.json").write_text('{"key":"synthetic-only"}')
    return data, secrets


def test_backup_and_restore_private_new_directories(tmp_path):
    data, secrets = fixture(tmp_path)
    backup = tmp_path / "backup"
    snapshot.backup(data, secrets, backup, stopped=True)
    assert snapshot.verify(backup)["format"] == "cloudsight-snapshot-v2"
    restored = tmp_path / "restored"
    snapshot.restore(backup, restored)
    assert (restored / "data/base/1").read_bytes() == b"saved database"
    assert (restored / "secrets/workspace.json").read_bytes() == (secrets / "workspace.json").read_bytes()
    assert (backup.stat().st_mode & 0o777) == 0o700
    assert ((restored / "secrets/workspace.json").stat().st_mode & 0o777) == 0o600
    assert str(data) not in (backup / "manifest.json").read_text()


def test_refuses_running_or_unacknowledged_source_and_existing_destination(tmp_path):
    data, secrets = fixture(tmp_path)
    with pytest.raises(ValueError, match="stop-required"):
        snapshot.backup(data, secrets, tmp_path / "no-ack", stopped=False)
    (data / ".cloudsight.lock").write_text(str(os.getpid()))
    with pytest.raises(ValueError, match="lock-present"):
        snapshot.backup(data, secrets, tmp_path / "locked", stopped=True)
    (data / ".cloudsight.lock").unlink()
    with pytest.raises(ValueError, match="destination-exists"):
        snapshot.backup(data, secrets, secrets, stopped=True)


def test_rejects_symlinks_tampering_and_unlisted_files(tmp_path):
    data, secrets = fixture(tmp_path)
    (data / "linked").symlink_to(secrets)
    with pytest.raises(ValueError, match="symlink"):
        snapshot.backup(data, secrets, tmp_path / "bad", stopped=True)
    (data / "linked").unlink()
    backup = tmp_path / "good"
    snapshot.backup(data, secrets, backup, stopped=True)
    (backup / "data/base/1").write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="digest"):
        snapshot.restore(backup, tmp_path / "restored")
    assert not (tmp_path / "restored").exists()
    (backup / "data/base/1").write_bytes(b"saved database")
    (backup / "data/extra").write_text("unexpected")
    with pytest.raises(ValueError, match="file-set"):
        snapshot.verify(backup)


def test_restore_refuses_existing_target_and_nested_backup(tmp_path):
    data, secrets = fixture(tmp_path)
    with pytest.raises(ValueError, match="overlap"):
        snapshot.backup(data, secrets, data / "snapshot", stopped=True)
    backup = tmp_path / "backup"
    snapshot.backup(data, secrets, backup, stopped=True)
    with pytest.raises(ValueError, match="destination-exists"):
        snapshot.restore(backup, data)


PG_EMPTY_DIRS = ("pg_logical/mappings", "pg_logical/snapshots", "pg_logical-extra", "pg_wal/archive_status", "pg_tblspc")


def test_empty_directories_are_snapshotted_verified_and_restored(tmp_path):
    data, secrets = fixture(tmp_path)
    for relative in PG_EMPTY_DIRS:
        (data / relative).mkdir(parents=True)
    backup = tmp_path / "backup"
    manifest = snapshot.backup(data, secrets, backup, stopped=True)
    assert manifest["format"] == "cloudsight-snapshot-v2"
    assert set(PG_EMPTY_DIRS) <= set(manifest["directories"]["data"])
    restored = tmp_path / "restored"
    snapshot.restore(backup, restored)
    for relative in PG_EMPTY_DIRS:
        path = restored / "data" / relative
        assert path.is_dir() and not any(path.iterdir())
        assert (path.stat().st_mode & 0o777) == 0o700


def test_verify_rejects_missing_or_extra_directories_and_old_format(tmp_path):
    data, secrets = fixture(tmp_path)
    (data / "pg_tblspc").mkdir()
    backup = tmp_path / "backup"
    snapshot.backup(data, secrets, backup, stopped=True)
    (backup / "data/pg_tblspc").rmdir()
    with pytest.raises(ValueError, match="directory-set"):
        snapshot.verify(backup)
    with pytest.raises(ValueError, match="directory-set"):
        snapshot.restore(backup, tmp_path / "restored")
    assert not (tmp_path / "restored").exists()
    (backup / "data/pg_tblspc").mkdir(mode=0o700)
    (backup / "secrets/unexpected").mkdir()
    with pytest.raises(ValueError, match="directory-set"):
        snapshot.verify(backup)
    (backup / "secrets/unexpected").rmdir()
    manifest_path = backup / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["format"] = "cloudsight-snapshot-v1"
    del manifest["directories"]
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="format"):
        snapshot.verify(backup)


REPO = Path(__file__).resolve().parent.parent
PGLITE = REPO / "node_modules" / "@electric-sql" / "pglite" / "package.json"
PGLITE_SCRIPT = """
const { PGlite } = await import("@electric-sql/pglite");
const [mode, dir] = process.argv.slice(1);
const db = new PGlite(dir);
if (mode === "create") {
  await db.exec("create table synthetic_restore (value integer); insert into synthetic_restore values (42);");
} else {
  const result = await db.query("select value from synthetic_restore");
  console.log(JSON.stringify(result.rows));
}
await db.close();
"""


def pglite(mode, directory):
    return subprocess.run(
        ["node", "--input-type=module", "-e", PGLITE_SCRIPT, mode, str(directory)],
        cwd=REPO, capture_output=True, text=True, timeout=120, check=False,
        env={"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", "")},
    )


@pytest.mark.skipif(shutil.which("node") is None or not PGLITE.exists(),
                    reason="needs Node and installed @electric-sql/pglite (npm ci)")
def test_restored_pglite_database_reopens(tmp_path):
    data, secrets = tmp_path / "data", tmp_path / "secrets"
    secrets.mkdir(mode=0o700)
    created = pglite("create", data)
    assert created.returncode == 0, created.stderr
    assert any(not any(path.iterdir()) for path in data.rglob("*") if path.is_dir()), "fixture needs empty PGDATA dirs"
    backup = tmp_path / "backup"
    snapshot.backup(data, secrets, backup, stopped=True)
    restored = tmp_path / "restored"
    snapshot.restore(backup, restored)
    reopened = pglite("read", restored / "data")
    assert reopened.returncode == 0, reopened.stderr
    assert json.loads(reopened.stdout.strip().splitlines()[-1]) == [{"value": 42}]


def test_verify_requires_private_snapshot_permissions(tmp_path):
    data, secrets = fixture(tmp_path)
    (data / "pg_tblspc").mkdir()
    backup = tmp_path / "backup"
    snapshot.backup(data, secrets, backup, stopped=True)
    for path in [backup, *backup.rglob("*")]:
        expected = 0o700 if path.is_dir() else 0o600
        assert (path.stat().st_mode & 0o777) == expected, path
    os.chmod(backup / "data/pg_tblspc", 0o755)
    with pytest.raises(ValueError, match="permissions"):
        snapshot.verify(backup)
    with pytest.raises(ValueError, match="permissions"):
        snapshot.restore(backup, tmp_path / "restored")
    os.chmod(backup / "data/pg_tblspc", 0o700)
    os.chmod(backup / "secrets/workspace.json", 0o644)
    with pytest.raises(ValueError, match="permissions"):
        snapshot.verify(backup)
    os.chmod(backup / "secrets/workspace.json", 0o600)
    snapshot.restore(backup, tmp_path / "restored")
    for path in [tmp_path / "restored", *(tmp_path / "restored").rglob("*")]:
        expected = 0o700 if path.is_dir() else 0o600
        assert (path.stat().st_mode & 0o777) == expected, path


@pytest.mark.parametrize("directories", [
    ["base", "pg_tblspc", "base"],
    ["pg_tblspc", "base"],
    ["base", "../outside"],
    ["base", "/absolute"],
    ["base", ""],
    ["base", "base/1"],
    [],
])
def test_verify_rejects_non_canonical_directory_manifests(tmp_path, directories):
    data, secrets = fixture(tmp_path)
    (data / "pg_tblspc").mkdir()
    backup = tmp_path / "backup"
    snapshot.backup(data, secrets, backup, stopped=True)
    manifest_path = backup / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["directories"]["data"] = directories
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="format|directory-set"):
        snapshot.verify(backup)


def test_restore_umask_does_not_widen_or_narrow_private_modes(tmp_path):
    data, secrets = fixture(tmp_path)
    (data / "pg_wal/archive_status").mkdir(parents=True)
    backup = tmp_path / "backup"
    previous = os.umask(0o077 | 0o200)
    try:
        snapshot.backup(data, secrets, backup, stopped=True)
        snapshot.restore(backup, tmp_path / "restored")
    finally:
        os.umask(previous)
    assert ((tmp_path / "restored/data/pg_wal/archive_status").stat().st_mode & 0o777) == 0o700
