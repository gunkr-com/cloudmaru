# First-run setup and workspace credentials

This extends ADR-023's environment-reference-only credential contract. The app remains a single-operator local/private installation. Existing workspace IDs, DB columns, analyses, scans, results, attempts and usage records are unchanged. No migration rewrites saved evidence.

## User flow

The root entry checks the current workspace locally. A workspace with neither an explicit setup choice nor a legacy Claude environment reference opens `/setup`; previously configured workspaces retain the Build entry. Other routes remain usable directly. Setup offers workspace management, optional Claude credentials, Azure configuration and local inventory import. Choosing local-only saves an explicit disabled setting and opens inventory. No save, page load, or skip action calls Claude or Azure.

`/workspaces/<id>/claude` manages that URL workspace, independently of the selected workspace cookie. The password input starts empty, never receives a saved key and clears after submission, including failure. Operators can replace a key, select a dedicated environment reference, or delete the active stored key and disable AI. New translations live in the `setup` domain. Existing environment-reference forms/actions remain compatible with the retained DB contract; the new page uses the new explicit configuration service.

## Secret storage contract

- `CLOUDSIGHT_SECRETS_DIR` is optional. Blank/unset uses `~/.cloudsight/secrets`; an explicit value must be an absolute server path. Literal `~` is not expanded in this variable.
- The directory must be outside the running repository and DB directory; it may be a sibling of the DB directory. Docker should mount a persistent private directory such as `/var/lib/cloudsight/secrets`, with data at `/var/lib/cloudsight/data`. Use a separate secrets directory for isolated QA installations.
- The app creates the directory with `0700`; existing directories must already have private permissions and belong to the process UID. Files use `0600` and must belong to that UID. Final directory/file symlinks, nonregular files, hard-linked files, public file permissions, oversized files and invalid JSON/schema are rejected. Errors expose only a stable generic message, with no raw filesystem error, path, key or cause.
- Files are named by validated workspace UUID, normalized to lowercase. Each contains exactly one source: `key` with a key and optional Claude model ID; `env` with a dedicated `CLOUDSIGHT_CLAUDE_KEY_*` name and optional model; or `disabled` without a key. API keys never enter the DB or repository.
- Writes use an exclusive randomly named `0600` temporary file, flush it, then atomically rename it over the active workspace file. Rotation never truncates the active file. Disabling replaces it with a tombstone; it does not remove the configuration and reveal an older environment fallback. Temporary files are removed after success/failure. A process crash can leave a private temporary file; operators must include this in secure cleanup/retention.
- File contents are plaintext protected by the OS service account and filesystem, not encrypted at rest by the application. Use a private, trusted parent directory and encrypted disk/volume where needed. Processes running as the same UID or an administrator can read these files. This is not a multi-user credential vault, and does not defend against a hostile process controlling the service account or replacing its filesystem concurrently.
- Deletion removes the key from active configuration; filesystem remnants, crash leftovers, snapshots and backups require separate retention management. Provider-side revocation is the operator's responsibility.

The file is authoritative only when it exists. If absent, the existing DB `claude_api_key_env` reference is read exactly as before. A missing variable, disabled file, unreadable file or malformed file never falls back to `ANTHROPIC_API_KEY` or another company's key. App requests continue to resolve the saved record's owning workspace on every attempt, including validation retries; they never select keys from the current workspace cookie. Explicit server-side keys and references override runtime-injected request fields. Development evals retain their previous global-key behavior.

The workspace model overrides `CLAUDE_MODEL` when present. Legacy references without a model keep `CLAUDE_MODEL`. The new form suggests `claude-opus-5-5` if no model is configured. Model metadata access and generation availability may differ; unknown model pricing continues to produce unknown cost rather than fabricated prices.

## Explicit diagnostics

Claude testing is an explicit action against saved settings. It sends one fixed-origin `GET https://api.anthropic.com/v1/models/<encoded-model-id>`, with a ten-second timeout, no redirects and no retry. It sends no prompt, inventory or user requirements, does not invoke generation and does not record a paid model usage row. Only a closed status and check timestamp return to the UI. Raw response bodies and credentials are neither persisted nor logged. This confirms key/model metadata access only, not billing balance, generation capacity or output quality. A new save clears the previous visible test result.

Azure local diagnostics read the saved certificate through the existing server credential wrapper. Missing connection/subscriptions, missing/invalid/expired certificate, password variable absence and expiry within 30 days have actionable states. The explicit access test goes through the existing Azure request allowlist and reads each selected subscription's metadata using GET. It starts no inventory scan and makes no Azure changes. Success proves subscription metadata access only; Resource Graph, Advisor and Cost Management permissions are not inferred. Reader and Cost Management Reader requirements are explained separately.

Diagnostic results are page-local and timestamped, not permanent validity claims. Configuration changes remount the Azure diagnostic panel. Claude/Azure exceptions and bodies are sanitized. Existing Host/Origin protections are unchanged; remote access still requires the installation's private transport/access controls.

## Preservation and validation

Back up the DB and private secrets separately under the installation's retention policy. Restoring credentials requires preserving workspace UUIDs and restoring file ownership/permissions. A DB-only restore preserves saved evidence and legacy references but cannot restore entered keys. No company secrets/data or live API requests were used for implementation verification. Unit and integration tests use synthetic keys, temporary private files, mocked provider transport and in-memory DB fixtures. Existing saved-result ownership, late attempts, usage and validation-retry acceptance tests remain in the full gate. Browser/PDF QA is performed by the coordinating root session.
