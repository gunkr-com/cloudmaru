# Offline backup, restore, and upgrades

Snapshots contain private database and API key files. Store them with the
same access controls as the running installation; do not attach them to
issues or commit them to Git. The snapshot tool uses Python 3.10+ and no
third-party Python dependency.

## Backup a native installation

1. Stop the application process. Do not copy a running PGlite database.
2. Confirm no other process or container owns that data directory.
3. Create a **new** destination snapshot. Both source directories must
   exist; create an empty private secrets directory if you use env keys only.

```sh
python3 scripts/local_snapshot.py backup \
  --data /absolute/cloudsight/data \
  --secrets /absolute/cloudsight/secrets \
  --destination /absolute/backups/cloudsight-before-upgrade \
  --stopped
python3 scripts/local_snapshot.py verify \
  --snapshot /absolute/backups/cloudsight-before-upgrade
```

The tool refuses an existing destination, source/destination overlap,
symlinks, special files, or any remaining `.cloudsight.lock`. It verifies
source stability and destination bytes with SHA-256. Files and directories
are copied with private permissions; the manifest lists relative file names,
sizes and hashes plus every directory, including the empty ones PGlite's
PostgreSQL data directory needs to open, but not the source absolute paths.
Verify and restore refuse any entry that is not owner-only (directories
`0700`, files `0600`), whatever the process umask.
A failed partial snapshot must not be used. Snapshots use format
`cloudsight-snapshot-v2`; earlier v1 snapshots did not record empty
directories and are refused.

If a crash left a lock, first verify that no process owns the directory.
Start and gracefully stop that same installation to release the stale lock;
do not remove locks while another process might be alive. `--stopped` is an
operator acknowledgement, not proof that a process in another PID namespace
has stopped. Container installations must be stopped separately.

Certificates and environment-variable secrets live outside these two
directories. Back them up separately using your organization's secret
backup process. A successful state snapshot is not a certificate backup.

## Restore to a new location

```sh
python3 scripts/local_snapshot.py restore \
  --snapshot /absolute/backups/cloudsight-before-upgrade \
  --destination /absolute/cloudsight-restored
```

The destination must not exist. Restore verifies the manifest before writing
and copies into `data/` and `secrets/` underneath the new destination. Set
`CLOUDSIGHT_DATA_DIR` and `CLOUDSIGHT_SECRETS_DIR` to those absolute paths,
start a single server, and verify saved records. Do not start the old and
restored installations against the same directories.

## Docker volume backup

Run `docker compose stop` first and verify the container is stopped.
Use a trusted helper container with the state volume mounted **read-only**
to copy `/var/lib/cloudsight/data` and `secrets` into private host staging,
then run the snapshot tool against that stopped copy. Use a copy method
that keeps empty directories and permissions (`cp -a` or `tar`); PGlite will
not open a data directory without them. `docker compose config --volumes`
prints the volume key (`cloudsight-state`); Compose prefixes the actual
Docker volume name with the project name, so confirm it with
`docker volume ls --filter label=com.docker.compose.volume=cloudsight-state`.
Never start a second app container just to open the production DB.

On restore, stop the app and copy verified `data/` and `secrets/` into a
new state volume, preserving owner UID/GID 10001 and private permissions.
Point a separate compose project at the new volume for validation. Keep
the old volume untouched until recovery is accepted. Do not use
`docker compose down --volumes` as an upgrade step.

## Upgrade and rollback

1. Record the running release/commit and model/connection configuration.
2. Stop the instance, create a verified snapshot, and retain the old version.
3. Install/build the reviewed new version. Run only one instance on the
   original data directory; migrations apply when the database first opens.
4. Check setup state, saved Build/Assess/Extend records, reports, and
   connection diagnostics. Reading old results should not make AI calls.
5. To roll back, stop the new version and restore the **pre-upgrade snapshot
   into a new location** before starting the old version. Never run older
   code directly against an already migrated database without a compatible
   migration guarantee.
