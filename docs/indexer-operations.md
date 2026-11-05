# Indexer operations

This runbook covers Envio startup and deliberate rebuilds.
RPC cache deployment and storage belong in [rpc-cache.md](rpc-cache.md).

## Prepare metadata before indexing

Download verified metadata before building the indexer:

```bash
ETHERSCAN_MIN_REQUEST_INTERVAL_MS=1000 pnpm run indexer:metadata -- --prefetch-metadata --source-report benchmarks/metadata-source-coverage.json
```

This uses Sourcify's [contract lookup API](https://docs.sourcify.dev/docs/api/),
including compiler ABI, NatSpec and the matching runtime hash. It
works without an Etherscan key. When `ETHERSCAN_API_KEY` is configured, Sourcify
misses also query Etherscan's `getsourcecode` endpoint for ABI and source in one
request. The existing interval variable also paces this
sequential Sourcify loop; the command above permits one request per second.
It selects registered contracts on the configured indexer chains, including
non-label external contracts, and writes `apps/indexer/src/generated/contract-metadata.json`.
The image bundles that file; prepared facts do not require a database warmup.

The command refreshes verified function metadata and retains role mappings and
existing checkpoint getter lists. New metadata entries use the verified ABI.
Use `--refresh-getters` instead when deliberately updating existing getter lists.
Use `--chain-id <id> --address <address>` for one registered contract, `--force`
to refresh prepared metadata, or `--output <file>` to inspect a separate copy.
For that preview, copy the bundled JSON to the output path first: a new output
path starts from empty metadata plus any local contract cache.
Review generated changes and run the repository validation before committing.
Run preparation after adding registered contracts or changing ABI metadata requirements;
do not make every startup depend on this download.

Prepared metadata contains ABI methods, documentation and role mappings. Source
annotations are bound to the observed runtime hash. Getters and bytecode are read
at each full current-state observation; metadata preparation does not authorize
cross-block value or deployment-lifetime reuse.

Unavailable sources and 404/429 responses preserve previous metadata and remain
retryable. Broad preparation reports partial coverage; targeted unavailable
refreshes fail. Inspect the final summary rather than treating exit zero as
complete coverage. New or unprepared contracts can still contact Sourcify or
Etherscan, so their independent runtime limits remain. Raising eRPC's RPC budget
does not change either metadata service's allowance.

Known account labels use `labelOnly: true` in `ContractNames.ts` or
`packages/protocol-config/other-contracts.json`. Preparation excludes these
identities before either metadata service is called, including with `--force`.
The source report lists them separately under `excluded`; their display names
remain available. An address present in both inventories stays excluded if either
entry marks it label-only. This is an explicit inventory decision, not an EOA
classification inferred from a failed download or an empty historical code read.
If an address later becomes a contract, review and remove the flag before preparing
its metadata. Runtime code-absence facts are not made permanent by this setting.

For the partially verified Robinhood `TokenAdminRegistry`, the public Blockscout
ABI observation is retained as a fixture. Reproduce the offline ABI import with:

```bash
pnpm run indexer:metadata -- --chain-id 4663 --address 0x1912c3cfafe8a76a32a92861d815ac2837f237ca --explorer-abi apps/indexer/scripts/fixtures/robinhood-token-admin-registry-abi.json
```

This narrow import validates the registered identity and Blockscout observation
URL, fills empty ABI metadata and retains any existing nonempty metadata. It
performs no HTTP requests. Partial explorer verification supplies ABI metadata, without runtime-bound NatSpec.

The source report distinguishes unavailable Sourcify evidence from Etherscan
availability, unverified contracts, unsupported chains, authentication failures,
quota errors and malformed responses. Etherscan fallback preserves existing
nonempty metadata. It only fills missing ABI metadata; it never follows proxy
implementation or similar-match addresses. Explorer ABI/source responses do not
supply runtime-bound documentation.
`--refresh-getters` retains its Sourcify-only verification behavior.

Explorer requests use bounded retries for HTTP/API rate limits, transport errors
and body-read timeouts. Errors and source reports omit provider-authored error
text and credential URLs. Authentication failure or exhausted daily quota stops
further explorer calls for that batch while Sourcify preparation continues.

## Normal startup

The indexer runs `envio start` without a reset flag. Deployments and crash
restarts resume compatible state. Envio retains its configuration and schema
compatibility checks. If startup reports incompatibility, inspect the error.
No startup error automatically resets the database.

The wrapper checks stored configuration through Envio's pinned compatibility
logic before starting ingestion. Empty or compatible storage starts normally.
A confirmed incompatibility keeps the reset control available and pauses
ingestion. `/healthz` returns 200 while `/ready` and `/metrics` return 503.
Database access errors and ordinary runtime failures still exit unsuccessfully.
The adapter uses internal Envio 3.14.1 exports and requires review before an upgrade.

## Reset the Railway indexer from your local machine

**This operation drops and recreates the Envio schema.** Record the recovery
choice before you start: a compatible backup or another full rebuild.
The separate RPC cache database remains intact.

The package command uses [Railway SSH](https://docs.railway.com/cli/ssh).
It runs Node directly; the image does not include `pnpm` or `npx`.
Railway SSH also requires a shell to launch that command. The indexer retains
its pinned distroless Node runtime and non-root user, with one BusyBox executable
copied from a digest-pinned official distroless image to provide `/bin/sh`.
This adds shell access and BusyBox's compiled applets, not a package manager.
The deployed image must include the reset control script and updated startup wrapper.

### Prepare

1. Authenticate the Railway CLI and link this checkout to the intended project.
2. Check that the target environment has exactly one active indexer replica.
3. Pause indexer autodeploys, publisher jobs, and monitor jobs.
4. Keep Hasura, Envio Postgres, and the RPC cache running.
5. Check SSH access with this read-only command:

   ```bash
   railway ssh --service indexer --environment production -- /nodejs/bin/node --version
   ```

Replace `production` with the target environment. Register an SSH key if Railway
requires one. If the probe fails, stop before the reset.

### Stop ingestion, reset, and resume Envio

From the repository root on your local machine:

```bash
RAILWAY_ENVIRONMENT=production pnpm run indexer:reset:railway
```

An explicit environment is required. Use `RAILWAY_ENVIRONMENT` or pass `--environment <name|id>`.
The script prints the project and environment names and IDs before it starts the reset.
The command always targets the `indexer` service in the linked project.

The remote script connects to a private Unix socket owned by the indexer user.
The startup wrapper stops the entire Envio process group and waits for it to exit.
If shutdown exceeds 30 seconds, the wrapper refuses to start the migration.
The wrapper then runs the deployed Envio command, with its configuration and variables:

```text
/nodejs/bin/node /app/apps/indexer/node_modules/envio/bin.mjs local db-migrate setup
```

After a successful migration, the wrapper starts Envio again inside the same
container. No Railway service restart, deployment, or start-command change is needed.
The command prints a completion message and exits with the migration status.
A successful launch does not mean that indexing has caught up.

During the reset, `/healthz` returns 200 and `/ready` and `/metrics` return 503.
Concurrent reset requests are rejected. The reset continues if SSH disconnects.
If completion is not confirmed, inspect the indexer logs before you run another reset.
If migration fails, ingestion remains stopped. Inspect the failure before retrying.
Never configure this command as the normal start command or pre-deploy command.

### Check recovery

1. Wait for indexer `/ready` and check that indexing progress advances.
2. Resume publisher and monitor jobs, then check the gateway manifest.
3. Restore the normal autodeploy configuration.

Use a fresh `INDEXER_DEPLOYMENT_ID` if a same-commit rebuild needs a new snapshot
namespace. Leave the RPC cache service, database, and volume intact.

## Plan a production rebuild

Production resets require explicit approval for the selected database and release.
This procedure is preparation, not authorization to reset production.
The native per-chain schema requires a full rebuild of an existing shared schema.
An ordinary restart does not make those schemas compatible.

Before the release:

1. Record the target project, production environment, Envio database and image commit.
2. Record the previous image, service configuration and Hasura metadata for recovery.
3. Choose recovery through a compatible database backup or another full rebuild.
4. Record the active snapshot manifest and retain all artifacts that it references.
5. Pause indexer autodeploys, publisher jobs and monitor jobs.
6. Verify that no publisher job remains active before the database operation.
7. Verify that only one indexer deployment remains active, including old deployments during a rolling release.

The gateway and frontend can serve the last valid snapshot during the rebuild.
Its block dates remain old, and freshness checks can report stale data.
Direct Hasura consumers lose indexed data until the rebuild completes.
Retain the snapshot bucket, manifest, Hasura service and separate eRPC storage.

### Deploy normally, then reset once

Deploy the approved image with the normal start command. If its schema is
incompatible, the wrapper pauses ingestion and waits for an explicit reset.
After all previous ingestion deployments stop, run:

```bash
RAILWAY_ENVIRONMENT=production pnpm run indexer:reset:railway
```

The same command handles both running and schema-incompatible indexers. It runs
the deployed image's official setup command and starts ingestion after success.
It needs no maintenance flag, custom HTTP command or second deployment.
The control stops only its own process group, so the single-writer check still
applies. Never retain `start -r` as the production start command.

### Publish after recovery

Set a unique `INDEXER_DEPLOYMENT_ID` on the snapshot publisher before its first
post-reset publication. This prevents a same-commit rebuild from reusing the old
snapshot namespace. Record this value with the release.

Verify advancing committed block heights and block dates for all configured
chains. Then verify indexer readiness and completed catch-up before publication.
Resume the publisher and verify the new manifest and referenced artifacts.
The publisher uploads the active manifest last and withholds publication while
chains are unready. Resume monitor jobs and autodeploys after recovery.

If setup fails or its completion is unknown, keep ingestion stopped and inspect
the migration logs before another attempt. A previous image cannot safely resume
against an incompatible new schema. Restore its compatible database and affected
Hasura metadata, or complete another rebuild. Restarting or rolling back the image
alone does not restore deleted data. Do not clear the eRPC cache to repair an Envio reset.

## Local Compose reset

After stopping the local indexer, run:

```bash
docker compose run --rm --no-deps indexer scripts/start-envio.mjs local db-migrate setup
```

Start the indexer normally after successful completion. Do not remove any
project volumes. An explicit `scripts/start-envio.mjs start -r` or `--restart`
also resets and starts ingestion, but it must remain an operator-only action.

## Verification boundary

Local process fixtures check complete ingestion shutdown before migration,
restart after success, maintenance after failure, and concurrent reset rejection.
They also cover incompatible startup without automatic reset, explicit reset
with no ingestion child, and ordinary storage/runtime failures exiting normally.
The Railway command test uses a fake CLI to check explicit environment selection.
The actual distroless image runs the official reset command against disposable
Postgres and fixture Hasura responses. A separate image check executes Node through
`/bin/sh` in a running container and verifies the pinned Node version and non-root
UID. These local checks do not validate live Railway SSH transport.
The native storage check runs against disposable PostgreSQL with a SELECT-only
role. Empty, compatible, incompatible, legacy and authentication-error cases
preserve the database dump hash. It never calls a migration as a preflight.
No arbitrary cursor SQL or partial historical replay is part of this procedure.

## Current-state schema change

The current-state indexer removes eight history/reuse entities and adds a full
observation version to `ChainObservation`. This is an incompatible schema change;
use the approved rebuild procedure when deploying it. This document does not
authorize a reset. Existing published artifacts remain readable.

Historical backfill processes events and narrowly initializes core contracts at
creation. Full getter observations run at the bounded replay endpoint, or at the
existing 100-block cadence when an unbounded chain is within 99 blocks of its
current RPC head. A cold final backfill batch can perform that observation before
Envio marks itself ready. There is no public Envio transactional catch-up hook;
a stationary, nonaligned tip can wait for the next cadence block.

The publisher requires native readiness and a versioned full-observation marker.
Envio's native metrics determine catch-up readiness. The publisher checks the
marker's exact block number, canonical hash, timestamp and verification version
through the private proxy. It does not query the latest head or apply another
block-age threshold. Missing, orphaned or unknown-version markers and unavailable
blocks withhold publication. Canonical validation happens during batch
construction, not atomically with manifest upload. A completed observation means every configured
family was attempted canonically; unsupported getters and mismatches remain
explicit in field verification and do not become successful reads.
