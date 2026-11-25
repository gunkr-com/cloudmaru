"""Offline, private, verified snapshots. Stop the app before using this operator tool."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil

# v2 records directories too: PGlite's PGDATA needs its empty PostgreSQL directories.
FORMAT = "cloudsight-snapshot-v2"
LABELS = ("data", "secrets")


def _digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def _tree(root):
    """Return (files, directories) relative to root; directories include empty ones."""
    if root.is_symlink():
        raise ValueError("snapshot-symlink")
    if not root.is_dir():
        raise ValueError("snapshot-source-directory-required")
    files, directories = {}, []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            raise ValueError("snapshot-symlink")
        if path.is_file():
            files[relative] = {"sha256": _digest(path), "bytes": path.stat().st_size}
        elif path.is_dir():
            directories.append(relative)
        else:
            raise ValueError("snapshot-special-file")
    # String order (not Path order) keeps manifests canonical and parents before children.
    return files, sorted(directories)


def _state(base):
    trees = {label: _tree(base[label] if isinstance(base, dict) else base / label) for label in LABELS}
    return ({label: trees[label][0] for label in LABELS}, {label: trees[label][1] for label in LABELS})


def _check(files, directories, expected_files, expected_directories):
    for label in LABELS:
        if directories[label] != expected_directories[label]:
            raise ValueError("snapshot-directory-set")
        if set(files[label]) != set(expected_files[label]):
            raise ValueError("snapshot-file-set")
        if files[label] != expected_files[label]:
            raise ValueError("snapshot-digest")


def _private_dir(path):
    path.mkdir(mode=0o700)
    # Explicit chmod: the process umask must neither widen nor narrow private modes.
    os.chmod(path, 0o700)


def _require_private(root):
    """Every snapshot or restored entry must be owner-only: directories 0700, files 0600."""
    for path in [root, *root.rglob("*")]:
        if path.is_symlink():
            raise ValueError("snapshot-symlink")
        expected = 0o700 if path.is_dir() else 0o600
        if (path.lstat().st_mode & 0o777) != expected:
            raise ValueError("snapshot-permissions")


def _new(destination):
    if destination.exists() or destination.is_symlink():
        raise ValueError("snapshot-destination-exists")
    _private_dir(destination)


def _copy(source, target, files, directories):
    _private_dir(target)
    for relative in directories:
        folder = source / relative
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError("snapshot-directory-set")
        # Parents sort before children, so each directory is created privately and exclusively.
        _private_dir(target / relative)
    for relative in files:
        src, dst = source / relative, target / relative
        if src.is_symlink():
            raise ValueError("snapshot-symlink")
        # Exclusive creation avoids replacing files in a partially completed copy.
        with src.open("rb") as incoming, dst.open("xb") as outgoing:
            os.chmod(dst, 0o600)
            shutil.copyfileobj(incoming, outgoing)


def backup(data, secrets, destination, *, stopped=False):
    data, secrets, destination = map(Path, (data, secrets, destination))
    if not stopped:
        raise ValueError("snapshot-stop-required")
    if (data / ".cloudsight.lock").exists():
        raise ValueError("snapshot-lock-present")
    if destination.exists() or destination.is_symlink():
        raise ValueError("snapshot-destination-exists")
    for source in (data, secrets):
        if destination.resolve().is_relative_to(source.resolve()):
            raise ValueError("snapshot-overlap")
    if data.resolve().is_relative_to(secrets.resolve()) or secrets.resolve().is_relative_to(data.resolve()):
        raise ValueError("snapshot-overlap")
    sources = {"data": data, "secrets": secrets}
    files, directories = _state(sources)
    _new(destination)
    for label in LABELS:
        _copy(sources[label], destination / label, files[label], directories[label])
    if (files, directories) != _state(sources) or (data / ".cloudsight.lock").exists():
        raise ValueError("snapshot-source-changed")
    manifest = {"format": FORMAT, "files": files, "directories": directories}
    with (destination / "manifest.json").open("x") as stream:
        os.chmod(destination / "manifest.json", 0o600)
        json.dump(manifest, stream, indent=2)
        stream.write("\n")
    verify(destination)
    return manifest


def verify(directory):
    directory = Path(directory)
    if directory.is_symlink() or (directory / "manifest.json").is_symlink():
        raise ValueError("snapshot-symlink")
    manifest = json.loads((directory / "manifest.json").read_text())
    if (manifest.get("format") != FORMAT or set(manifest.get("files", {})) != set(LABELS)
            or set(manifest.get("directories", {})) != set(LABELS)):
        raise ValueError("snapshot-format")
    for label in LABELS:
        listed = manifest["directories"][label]
        if listed != sorted(set(listed)) or any(
                not isinstance(item, str) or not item or item.startswith("/") or ".." in item.split("/")
                for item in [*listed, *manifest["files"][label]]):
            raise ValueError("snapshot-format")
    _check(*_state(directory), manifest["files"], manifest["directories"])
    _require_private(directory)
    if {p.name for p in directory.iterdir()} != {"data", "secrets", "manifest.json"}:
        raise ValueError("snapshot-file-set")
    return manifest


def restore(directory, destination):
    directory, destination = Path(directory), Path(destination)
    manifest = verify(directory)
    _new(destination)
    for label in LABELS:
        _copy(directory / label, destination / label, manifest["files"][label], manifest["directories"][label])
    _check(*_state(destination), manifest["files"], manifest["directories"])
    _require_private(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("backup")
    create.add_argument("--data", required=True, type=Path)
    create.add_argument("--secrets", required=True, type=Path)
    create.add_argument("--destination", required=True, type=Path)
    create.add_argument("--stopped", action="store_true")
    for command in ("verify", "restore"):
        entry = commands.add_parser(command)
        entry.add_argument("--snapshot", required=True, type=Path)
        if command == "restore":
            entry.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "backup":
            backup(args.data, args.secrets, args.destination, stopped=args.stopped)
        elif args.command == "restore":
            restore(args.snapshot, args.destination)
        else:
            verify(args.snapshot)
        print("snapshot-" + args.command + "-verified")
    except (OSError, ValueError, KeyError, TypeError):
        # No raw paths, contents, or key material in CLI errors.
        parser.exit(1, "snapshot-operation-failed: stop the app, check paths and permissions, and verify the snapshot.\n")


if __name__ == "__main__":
    main()
