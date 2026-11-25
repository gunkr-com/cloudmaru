# Single-operator installation

## Supported initial scope

One operator per installation; Node.js 24 on a local computer, or the
provided Docker Compose on Linux Docker Engine. PGlite is local storage,
not a shared database service. Use one application process per data volume.
Installations and workspaces keep their own credentials; there is no
fallback to a developer's personal key.

## Native local installation

1. Install Node.js 24 and run `npm ci` in a clean checkout.
2. Copy `.env.example` to `.env.local`. Set a dedicated
   `CLOUDSIGHT_DATA_DIR`, outside the repository. The template's `~/`
   expansion is supported for this data path.
3. Optionally set `CLOUDSIGHT_SECRETS_DIR` to an absolute private directory,
   separate from the repository and database. Leave it blank to use
   `~/.cloudsight/secrets`.
4. Run `npm run build`, then `npm run start -- --port 3180`.
5. Open `http://127.0.0.1:3180` and complete setup. Select the model your
   account can access and register the workspace API key. Connection checks
   are explicit actions; settings do not automatically launch an analysis.
6. Connect Azure using your own tenant/app certificate and selected
   subscriptions, or import Resource Graph JSON.
7. Run `npm run prices:sync` before using live Build or Extend.
8. To generate Extend Bicep artifacts, install the exact compiler described
   in [Native Bicep compiler](#native-bicep-compiler).

Azure Reader access covers inventory reads. Cost features need the
appropriate Cost Management read access; the Azure identity and Claude
API identity are independent. Missing access is reported per feature.
The certificate must remain on the server; never paste its private key into
the browser or a support issue.

`CLOUDSIGHT_ALLOWED_HOSTS` is an optional exact host allowlist for a private
proxy. `CLOUDSIGHT_DEV_ORIGINS` is a separate development-only HMR setting.
Neither provides authentication or changes the loopback bind.

## Local Build and Extend pricing

Run `npm run prices:sync` in the checkout to create a private,
dated CAD snapshot under `.cloudmaru-pricing/prices.json`. Sync again
when you want to refresh rates. Each accepted request uses the snapshot
it acquired when submitted. Assess and saved results with pricing
evidence are available without a current price file.

For a native install, an absolute `CLOUDMARU_PRICES_FILE` can select a
different file. Set it in the server environment or `.env.local` and pass
the same path when syncing, for example
`CLOUDMARU_PRICES_FILE=/absolute/private/prices.json npm run prices:sync`.

## Native Bicep compiler

Extend Bicep generation compiles locally with exactly Bicep CLI 0.49.2
(commit `b34271ac51`). Any other version is refused, and compilation never
deploys or changes Azure. Saved artifacts reopen and download without a
compiler. The tested native platforms are macOS and Linux on arm64 or x64;
Windows native installation is not a tested target.

Download the official release asset and check its published SHA-256 before
making it executable:

```sh
version=v0.49.2
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  asset=bicep-osx-arm64;   digest=8ae74a6cf9cbba0cb220c40cf0e955f98d59df950afab07c21b7bcb78c9c5d68 ;;
  Darwin-x86_64) asset=bicep-osx-x64;     digest=1403cd4b17178c40ee87a40222ce318a31a2b95db7bbcd964c03780cad89dc5e ;;
  Linux-aarch64) asset=bicep-linux-arm64; digest=48d8f152bd78c8848a41a07ac2d12b573306d9329fc961a85354a98a95cc275e ;;
  Linux-x86_64)  asset=bicep-linux-x64;   digest=0ab9de90c2493f206f8281bae74f9ee2d5ed3605548dab1adf41fef185e1f7c5 ;;
  *) echo "unsupported platform" >&2; exit 1 ;;
esac
dir="$HOME/.local/opt/cloudsight-bicep-$version"
mkdir -p -m 700 "$dir"
curl --fail --location --proto '=https' --tlsv1.2 \
  "https://github.com/Azure/bicep/releases/download/$version/$asset" -o "$dir/bicep.download"
check() { if command -v sha256sum >/dev/null 2>&1; then sha256sum -c -; else shasum -a 256 -c -; fi; }
echo "$digest  $dir/bicep.download" | check
chmod 700 "$dir/bicep.download" && mv "$dir/bicep.download" "$dir/bicep"
"$dir/bicep" --version
echo "CLOUDSIGHT_BICEP_PATH=$dir/bicep"
```

The version line must read `Bicep CLI version 0.49.2 (b34271ac51)`. If the
checksum line does not say `OK`, delete the download and do not run it.
Put the printed `CLOUDSIGHT_BICEP_PATH=…` line in `.env.local`: it must be
one absolute path to the executable (no `~`, arguments or shell syntax).
If it is unset, CloudMaru looks for `bicep` only on
`/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`.

If Extend reports that the compiler is unavailable or the wrong version,
run the configured path with `--version` as the server user and compare the
output above; fix the path or reinstall this exact release rather than
loosening the version check. The Docker image already installs the same
version with pinned Linux digests.

## Linux Docker Compose

```sh
# The container runs as UID/GID 10001; let that group traverse and read.
sudo install -d -m 750 -o root -g 10001 certificates
sudo install -d -m 2750 -o "$USER" -g 10001 .cloudmaru-pricing
npm ci
npm run prices:sync
docker compose build
docker compose up -d
docker compose ps
```

Compose mounts the pricing directory read-only. Its setgid bit keeps
group 10001 on each replacement file, which is written with mode `0640`.
For rootless or user-namespace Docker, use the host group ID mapped to
container GID 10001. Compose requires the host directory. If it exists
but the file is missing or unreadable, Build and Extend will show pricing
setup instructions and Assess and saved history remain available.

The default port is 3180; set `CLOUDSIGHT_PORT` to change it. The compose
file uses `network_mode: host`, no published ports, a non-root UID 10001,
read-only root filesystem, a bounded writable `/tmp`, and a private
`cloudsight-state` volume. The process binds `127.0.0.1` even if the
container's hostname environment is changed. The volume persists both
`/var/lib/cloudsight/data` and `/var/lib/cloudsight/secrets` across restarts.

Place certificates in the host certificate directory (or set
`CLOUDSIGHT_CERTS_DIR`) and give the container's group read access only:

```sh
sudo install -m 640 -o root -g 10001 reader.pem certificates/reader.pem
```

A `0700` directory or `0600` file owned by your host user is unreadable to
UID 10001 and shows up as a missing certificate. With rootless Docker or
user-namespace remapping, use the host GID that container GID 10001 maps to.
In Azure settings use the **container** path, for example
`/run/cloudsight-certificates/reader.pem`. The mount is read-only. Do not
grant world-readable permissions to fix a path error.

The image downloads Bicep CLI 0.49.2 from Microsoft's release and checks its
official SHA-256 for Linux arm64/amd64. Compilation is local; it does not
deploy or alter Azure. A native installation configures the same compiler
itself ([Native Bicep compiler](#native-bicep-compiler)). Saved artifacts can
still be reopened without a compiler.

The image carries license texts for its bundled dependencies in
`/app/third-party-licenses/` (with `manifest.json`); see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Docker Desktop host networking is opt-in and differs from Linux network
namespaces. This configuration's supported target is Linux Docker Engine;
use native Node on macOS rather than weakening the application bind.
Sources: [Docker host networking](https://docs.docker.com/engine/network/drivers/host/),
[Compose network mode](https://docs.docker.com/reference/compose-file/services/#network_mode).

## Remote company server

Run the same single-operator instance on a private Linux server. For SSH
access, keep the app's bind and forward the server's loopback port:

```sh
ssh -N -L 3180:127.0.0.1:3180 user@your-server
```

Then open `http://127.0.0.1:3180` locally. A private proxy is another option
when it supplies a suitable access boundary and you explicitly allow its
hostname. Shared employee access and public hosting require a separate
authentication/authorization design and are outside this initial scope.

## Secret storage and diagnostics

The settings UI is write-only for API keys. Local key files are plaintext
protected by OS directory/file permissions; they are not encrypted vaults.
Use a dedicated service account and protected disk, and restrict backup
access. The UI can show configuration status, but must not return stored
keys, certificate contents, or raw provider errors.

An explicit connection test checks the configured identity/model metadata
or Azure read access. Passing it does not verify every future analysis or
your organization's permission to transmit inventory to an AI provider.
Read [backup and upgrade instructions](BACKUP_RESTORE.md) before changing
versions. `.env.local` changes are reread during development; changing the
data directory after opening the DB requires a server restart.
