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

The indexer runs `envio start` without a reset flag. Deployments and explicit
restarts resume compatible state. Envio retains its configuration and schema
compatibility checks. If startup reports incompatibility, inspect the error.
No startup error automatically resets the database.

Envio 3.18.1 checks configuration and configured addresses before taking over
existing storage. If the native `start` child exits nonzero or by signal, the
parent keeps health and the reset socket available so Railway SSH can recover
the deployment without changing its production start command. `/healthz` 200
means control-process liveness; `/ready` and `/metrics` return 503 while paused.
This also parks ordinary terminal child failures: Railway will not automatically
restart a container whose parent remains healthy. Inspect the failure, then
explicitly restart/redeploy or obtain approval for a destructive reset; an
ordinary crash does not mean a reset is needed. A clean child exit, one-off
command completion, parent shutdown, or spawn/control-setup failure still exits
the wrapper.

## Indexer availability alerts

Railway runs the private `indexer-monitor` job every 15 minutes. One invocation
uses the dedicated Node Alpine image, checks the indexer's native `/metrics`
once with a five-second timeout, then exits. An HTTP 2xx response confirms
metrics reachability, including during backfill. Check committed block progress
separately to detect stalled ingestion. The job never resets the indexer.

Set the shared `DISCORD_WEBHOOK_URL` for each Railway environment. IaC supplies
`INDEXER_METRICS_URL`, the `MONITOR_NAME` environment label, and the existing
bucket's `BUCKET`, `ENDPOINT`, `REGION`, `ACCESS_KEY_ID` and `SECRET_ACCESS_KEY`
references. Both service URLs and all bucket settings are required. URLs must
use HTTP or HTTPS without embedded credentials. The optional `MONITOR_NAME`
defaults to `Indexer`. Set the optional `MONITOR_COOLDOWN_MINUTES` on the
monitor service to change its 60-minute default. Use a positive whole number
of minutes that converts safely to milliseconds. Startup validates configuration
before any network requests. Invalid values cause exit status `1` with a fixed
diagnostic.

The job stores alert state in `indexer-monitor/state.json`, separate from
snapshot state. A successful Discord outage delivery starts the configured
cooldown that survives restarts and recovery. A continuing outage can send
another alert on a scheduled run after the cooldown expires. The first healthy
run after a reported outage sends one recovery. Both alerts carry a Discord
embed with the project, status and timestamp. If a delivery or state operation
fails, the job exits with status `1` and the next run can retry if the alert is
still relevant. A successful delivery followed by a failed state write can
produce a duplicate. The scheduled `snapshot-monitor` continues its daily
snapshot and indexing checks.

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
This socket command requires the running parent, including when its Envio child
has failed. It cannot reach an exited deployment.

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

The migration drops Envio's schema, including its effect cache (cached contract
reads). The wrapper does not stash or restore those tables. A deliberate reset
starts with a cold effect cache and refetches contract reads. The separate eRPC
cache database is retained.
The wrapper then runs the deployed Envio command, with its configuration and variables:

```text
/nodejs/bin/node /app/apps/indexer/node_modules/envio/bin.mjs local db-migrate setup
```

After a successful migration, the wrapper starts Envio again inside the same
container. No Railway service restart, deployment, or start-command change is
needed for this explicit reset. Normal compatible restarts retain the native
effect cache: cached entries have no handler-version stamp. Envio rejects
outputs that fail the current schema, but cannot detect a same-shaped change in
meaning. Version the effect name when its input or output meaning changes. An
Envio upgrade or restoration to a fresh cluster requires separate compatibility
and recovery review; ordinary startup never resets storage automatically.
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
This runbook does not authorize a reset, volume deletion or credential change.
The native per-chain schema requires a full rebuild of an existing shared schema.
An ordinary restart does not make those schemas compatible.

### Inventory and recovery

Record the exact project/environment, main `Postgres` service and attached
`destruction-volume` identity, image/revision, configuration, effective mount and
`PGDATA`. Mark `rpc-cache-postgres` and its volume explicitly outside the reset
target. Secure a consistent main database backup/snapshot and verify recovery
through its compatible image/configuration or another full rebuild. Image
rollback alone cannot restore deleted data or open another major's cluster files.

Inventory the live data before approving destruction; repository source is not
proof that every row is disposable:

- Declared entities, observations, progress, checkpoints and dynamic registrations
  derive from configured chain history and pinned reads. Full replay requires all
  configured chains/start blocks, historical provider availability and the exact
  source/config/ABI inputs. Never copy arbitrary cursors into a fresh schema.
- Effect tables and `.envio/cache` include external ABI/source metadata that can
  change or disappear, not only reproducible chain reads. Preserve needed exports
  and runtime-only `data/contract-cache.json`, `data/abis` and `data/source-code`
  alongside committed metadata. An explicit reset starts with a cold effect cache;
  it does not transfer these cached outputs.
- Export Hasura metadata and preserve custom permissions, manual SQL/tables,
  roles/grants and extensions. Generated tracking can be recreated; chain replay
  cannot reconstruct unrecorded customizations.
- Retain the snapshot bucket's active manifest and referenced artifacts, publisher
  notification state/locks, monitor state and separate eRPC storage. Preserve
  private configuration/credentials through approved secure backup methods and
  record deployment IDs and volume mappings without logging secret values.

Pause indexer autodeploys, publisher and monitor jobs before a rebuild. Verify
that every ingestion writer has stopped, including old rolling deployments, and
that no publisher job remains active. Keep Hasura and the databases running for
an ordinary schema reset; the major-version procedure below has a separate stop
sequence. The reset socket stops only its own process group.

The gateway and frontend can serve the last valid snapshot during the rebuild.
Its block dates remain old, and freshness checks can report stale data.
Direct Hasura consumers lose indexed data until the rebuild completes.
Retain the snapshot bucket, manifest, Hasura service and separate eRPC storage.

### Database major-version rebuild

Image pins and volume declarations belong to [Railway IaC](../.railway/railway.ts)
and [local Compose](../docker-compose.yml). Production uses the Railway SSL
template, not the official local Alpine image. Preserve native database resource
and volume identities, passwords, capacity and mount `/var/lib/postgresql/data`.
The pinned [native CLI compiler](https://github.com/railwayapp/cli/blob/v5.75.0/src/iac/compiler.rs#L523-L566)
emits explicit `PGDATA=/var/lib/postgresql/data/pgdata`; raw image ENV alone does
not prove the live binding. Verify deployed mounts and effective data directory.
Local disposable volumes instead use parent `/var/lib/postgresql` and
`PGDATA=/var/lib/postgresql/18/docker`; see [local storage](local-stack.md#ports).

CI blocks source-image changes on the existing main `database.Postgres`, even
when a native plan labels them safe. A pin update does not migrate cluster files;
there is no automatic reset or CI bypass. For a separately approved rebuild:

1. Complete the inventory/backup above and review the exact old/new image and
   selected main volume. Stop all ingestion writers and pause/stop Hasura writers.
   Stop main `Postgres` before the volume operation; prevent its old deployment
   from restarting against reset data. Keep frontend, gateway, bucket and eRPC intact.
2. Obtain separate data-loss approval for that exact target and action: reset the
   selected main volume or replace it only with a reviewed binding. Retain resource
   identity and record any old/new volume mapping. Never target the cache, bucket,
   unrelated volumes or shared Docker state. No automatic volume wipe is supplied.
3. After the volume operation, generate and review a fresh native plan because
   the environment ETag has changed. Require that it cannot create, update, deploy
   or restart indexer/publisher/monitor writers; paused autodeploy alone does not
   prevent apply-triggered deployments. If the plan cannot isolate the database
   operation from writer deployments, stop. Obtain renewed approval for that exact
   plan and use the existing [native JSON-result procedure](railway-self-hosting.md#5-apply-the-reviewed-plan).
4. Keep writers paused until native result checks, a fresh read-only plan, complete
   HTTP/TCP inventory and database verification pass. Verify server version, image,
   fresh/reset data location inside the volume, effective `PGDATA`, TLS, roles and
   extensions before starting ingestion. Never start a new major against old-major
   files. Restore Hasura metadata/configuration deliberately after database readiness.
   Defer the native procedure's indexer route/health/progress checks until ingestion
   starts; it must not resume writers early.
5. Start the reviewed Envio image normally. If native compatibility refusal needs
   an approved schema reset, use the SSH command below only after database readiness
   and confirmation that every other writer is stopped. It is not a PostgreSQL
   major-version converter. Never add reset flags to ordinary startup or predeploy.
   Verify private docs routes and health, then advancing canonical observations,
   all configured chains and eventual readiness. Readiness may be 503 during reindex.
6. Follow [Publish after recovery](#publish-after-recovery) only after catch-up.
   Fresh schema creation recreates its indexes; any separate REINDEX,
   extension/constraint or backup-chain maintenance needs its own review. Retain
   recovery backups and old snapshot artifacts until acceptance.

If completion is uncertain, keep writers/publication paused and inspect sanitized
evidence. Do not blindly repeat destructive operations, weaken native guards or
clear eRPC storage to repair the main database.

### Handle an incompatible deployment

Deploy the approved image with the normal start command. If native startup
refuses the schema, ingestion stays stopped while the parent retains reset
control. Inspect the error. After separate reset approval and confirmation that
every other ingestion writer has stopped, run from the repository root:

```bash
pnpm indexer:reset:railway --environment production
```

Replace `production` with the selected environment name or ID.
It drains any remaining child processes,
runs native setup, and restarts ingestion only after setup succeeds. It stops
only its own process group, so the single-writer check still applies.

If the parent itself has exited, the socket is unavailable; inspect and recover
that deployment before attempting the SSH reset. Never retain `start -r` as the
production start command.

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
They also cover retained control after failed native starts without automatic
reset, clean completion, and propagation of one-off command statuses.
The Railway command test uses a fake CLI to check explicit environment selection.
The actual distroless image runs the official reset command against disposable
Postgres and fixture Hasura responses. A separate image check executes Node through
`/bin/sh` in a running container and verifies the pinned Node version and non-root
UID. These local checks do not validate live Railway SSH transport.
The image fixture checks that native incompatible startup leaves control alive
without changing the database dump hash or incompatibility sentinel, then uses
the existing explicit socket reset before normal ingestion resumes.
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

A missing or changed canonical anchor rejects the entire observation batch. No
partial entity changes or completion marker commit. Anchor checks are read-only;
their failure is reported as the sanitized `Canonical observation changed or
unavailable` error, rather than a verification row that would be rolled back.
This stops processing and, with native workers, stops sibling workers too.
Restarting can recover from a temporary provider failure. A persisted orphaned
anchor needs canonical state restored through supported rollback or an approved
rebuild; restarting alone does not repair it. Ordinary unsupported getters still
record their unavailable result within an otherwise canonical observation.
