# Indexer operations

This runbook covers Envio startup and deliberate rebuilds.
RPC cache deployment and storage belong in [rpc-cache.md](rpc-cache.md).

## Prepare metadata before indexing

Download verified metadata before building the indexer:

```bash
ETHERSCAN_MIN_REQUEST_INTERVAL_MS=1000 pnpm run generate:indexer-metadata -- --prefetch-metadata --source-report benchmarks/metadata-source-coverage.json
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
pnpm run generate:indexer-metadata -- --chain-id 4663 --address 0x1912c3cfafe8a76a32a92861d815ac2837f237ca --explorer-abi apps/indexer/scripts/fixtures/robinhood-token-admin-registry-abi.json
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

Envio 3.19.0 checks configuration and configured addresses before taking over
existing storage. If startup refuses the database, the deployment exits nonzero.
Once Envio starts, its native `/healthz` reports process liveness. Use `/metrics`
to check indexed block progress and `hyperindex_synced_to_head` for catch-up.
Inspect ordinary crashes and restart with the same command once the cause is fixed.

## Indexer availability alerts

Railway runs the private `indexer-monitor` job every 15 minutes. One invocation
uses the dedicated Node Alpine image, checks the indexer's native `/metrics`
once with a five-second timeout, then exits. An HTTP 2xx response confirms
metrics reachability, including during backfill. Check committed block progress
separately to detect stalled ingestion. The job never resets the indexer.

Set the production and preview webhook values using the
[Discord setup instructions](discord-notifications.md). IaC supplies
`INDEXER_METRICS_URL`, the `MONITOR_NAME` project label, and the dedicated private
`monitor-state` bucket's `BUCKET`, `ENDPOINT`, `REGION`, `ACCESS_KEY_ID` and `SECRET_ACCESS_KEY`
references. Both service URLs and all bucket settings are required. URLs must
use HTTP or HTTPS without embedded credentials. The optional `MONITOR_NAME`
defaults to `Indexer`. IaC supplies `Visualizer`; runtime Railway metadata adds
the environment label outside production and selects the preview webhook.
The complete project/environment label must fit within 1024 characters.
Outside Railway, the environment name is optional; when absent, the explicit
`DISCORD_WEBHOOK_URL` and base label are used. A supplied name must not be blank.
Use `pnpm build:indexer-monitor`,
`pnpm test:indexer-monitor`, and `pnpm typecheck:indexer-monitor` for this app;
the root Turbo commands already cover every workspace with that role.
Set the optional `MONITOR_COOLDOWN_MINUTES` on the
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

## Reset the Railway indexer from the database host

This operation deletes the selected main Envio schema and its effect tables.
Obtain approval for the exact target and record a compatible backup or approved
full rebuild before starting. Leave the separate eRPC service and database intact.

1. Verify the project, environment, main `Postgres` service and effective Envio
   database. Review the [data inventory](#inventory-and-recovery) and confirm
   which schema, owner, grants and dependencies belong to this indexer.
   Verify that `ENVIO_PG_SCHEMA` is unset and that `ENVIO_PG_PUBLIC_SCHEMA` is
   either unset or set to `public`. Envio defaults to `public` when both are
   unset. Confirm that `public` is the effective schema before using the SQL
   below.
2. Pause indexer autodeploys, publisher and monitor jobs. Stop every indexer
   writer, including old rolling deployments, and confirm that writers cannot
   restart during the reset. If clients can write to the schema through Hasura,
   stop Hasura too. Keep the databases available.
3. Set `target_project` and `target_environment` to the verified Railway
   project and environment IDs. Open [Railway SSH](https://docs.railway.com/cli/ssh)
   on the main database host.
   Complete SSH host verification during this interactive connection.

   ```bash
   railway ssh --project "$target_project" --environment "$target_environment" --service Postgres
   ```

   From that host, open `psql` against the recorded main database under its
   approved maintenance role. If those correspond to the service's configured
   `POSTGRES_DB` and `POSTGRES_USER`, use:

   ```bash
   psql --no-psqlrc --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
   ```

4. Run these commands in `psql` to record the database port, name and role and
   confirm the schema owner, ACL and Envio metadata.

   ```psql
   \conninfo
   \dn+ public
   \dt public.envio_info
   ```

   Confirm that the schema is dedicated to Envio and review dependencies
   outside it before dropping it. Stop if the drop would remove any object
   outside the approved reset scope.
5. Exit the interactive session. From the repository root, stream the
   [checked-in reset script](../scripts/reset-indexer-schema.sql) to the same
   verified database host. Replace `VERIFIED_DB_PORT`, `VERIFIED_DB_NAME` and
   `VERIFIED_DB_ROLE` with the values recorded above. The command uses the
   service's `POSTGRES_PASSWORD` for its configured `POSTGRES_USER` role.
   A different maintenance role requires separately approved noninteractive
   authentication.

   ```bash
   railway ssh --project "$target_project" --environment "$target_environment" --service Postgres -- \
     'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -w -v ON_ERROR_STOP=1 --host 127.0.0.1 --port VERIFIED_DB_PORT --dbname VERIFIED_DB_NAME --username VERIFIED_DB_ROLE --file=-' \
     < scripts/reset-indexer-schema.sql
   ```

   The script requires `public.envio_info` and the standard `public` schema
   owner and grants. It preserves an existing direct `USAGE` and `CREATE`
   grant to the database owner and verifies the recreated ACL before commit.
   If the script refuses the reset, keep writers stopped. For a different
   approved owner or ACL, use a separately reviewed restore and verify the
   recorded owner and exact grants before committing that transaction.

6. Verify that the recreated schema is empty and that its permissions permit
   normal Envio initialization. Start Hasura if you stopped it. Before starting
   the indexer, verify that an authenticated `export_metadata` POST to Hasura's
   private `/v1/metadata` returns HTTP 2xx. Railway allows 30 seconds for the
   indexer's `/healthz`, and the bootstrap can wait up to 180 seconds for Hasura
   by default. Start one reviewed indexer deployment with its ordinary command. Native Envio
   initializes the empty schema and rebuilds its data and effect cache. Follow
   [Publish after recovery](#publish-after-recovery) after committed heights
   advance and all configured chains catch up.

Normal compatible restarts retain the native effect cache. Cached entries have
no handler version stamp. Envio rejects outputs that fail the current schema.
Version the effect name when its input or output meaning changes.

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
that no publisher job remains active. For an ordinary schema reset, follow the
[database-host stop sequence](#reset-the-railway-indexer-from-the-database-host).
Use the separate stop sequence below for a major-version rebuild.

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
   files. Start Hasura after database readiness and verify authenticated
   `export_metadata` succeeds before starting the indexer.
   Defer the native procedure's indexer route/health/progress checks until ingestion
   starts; it must not resume writers early.
5. Start the reviewed Envio image normally. If native compatibility refusal needs
   an approved schema reset, follow the [database-host procedure](#reset-the-railway-indexer-from-the-database-host)
   once the database is ready and every writer has stopped. Verify private docs
   routes and health, then advancing canonical observations and eventual catch-up
   across all configured chains. Keep ordinary startup and predeploy free of reset flags.
6. Follow [Publish after recovery](#publish-after-recovery) only after catch-up.
   Fresh schema creation recreates its indexes; any separate REINDEX,
   extension/constraint or backup-chain maintenance needs its own review. Retain
   recovery backups and old snapshot artifacts until acceptance.

If completion is uncertain, keep writers/publication paused and inspect sanitized
evidence. Do not blindly repeat destructive operations, weaken native guards or
clear eRPC storage to repair the main database.

### Handle an incompatible deployment

If native startup refuses the stored schema, inspect the deployment error and
confirm which compatibility check failed. For an approved rebuild, stop every
writer and follow the [database-host reset](#reset-the-railway-indexer-from-the-database-host).
Restart with the normal command once the database is ready.

### Publish after recovery

When Envio initializes an empty schema, it clears Hasura metadata and recreates
its table tracking, permissions and relationships. After initialization, verify
that tracking succeeded. Use the saved export to reapply only reviewed custom
permissions, relationships and other entries whose dependencies and access rules
are valid for the rebuilt schema. Keep Envio's regenerated metadata. Before
resuming publication, verify the publisher's private GraphQL query returns data
without errors.

Set a unique `INDEXER_DEPLOYMENT_ID` on the snapshot publisher before its first
post-reset publication. This prevents a same-commit rebuild from reusing the old
snapshot namespace. Record this value with the release.

Verify advancing committed block heights and block dates for all configured
chains. Then verify indexer readiness and completed catch-up before publication.
Resume the publisher and verify the new manifest and referenced artifacts.
The publisher uploads the active manifest last and withholds publication while
chains are unready. Resume monitor jobs and autodeploys after recovery.

If the reset or startup fails, keep ingestion stopped and inspect the database
and Envio diagnostics before another attempt. A previous image cannot safely resume
against an incompatible new schema. Restore its compatible database and affected
Hasura metadata, or complete another rebuild. Restarting or rolling back the image
alone does not restore deleted data. Do not clear the eRPC cache to repair an Envio reset.

## Local Compose reset

Stop the local `indexer` and all other writers first. Open `psql` on the Compose
`postgres` service with the main database and role from the local configuration.
Confirm `public` and its permissions with the same database checks above, then
reset only that schema and start the `indexer` normally. Preserve the Compose
volumes and the separate `rpc-cache-postgres` service.

## Verification boundary

Local subprocess tests check fail-fast configuration, Hasura startup, CLI
arguments, exit status and signals. The image fixture checks Tini and the
non-root UID. It checks native incompatible startup exits without changing the
main database, resets the disposable main schema from the database host, then
checks ordinary restart, native metrics, health, private ingestion docs and
unchanged eRPC cache rows. Live provider behavior needs separate verification.

## Current-state schema change

The current-state indexer removes eight history/reuse entities and adds a full
observation version to `ChainObservation`. This is an incompatible schema change;
use the approved rebuild procedure when deploying it. This document does not
authorize a reset. Existing published artifacts remain readable.

Historical backfill processes events and narrowly initializes core contracts at
creation. Full getter observations run at the bounded replay endpoint, or
when an unbounded chain catches up. Later eligible candidates trigger at most
one verification per UTC half-hour window; a window without a candidate has no
observation. A cold final backfill batch can perform the first observation before
Envio marks itself ready. Envio exposes no public transactional catch-up hook,
so a stationary tip between candidate blocks can wait for the next candidate.

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
