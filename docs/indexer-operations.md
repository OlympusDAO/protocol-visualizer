# Indexer operations

This runbook covers Envio startup and deliberate rebuilds.
RPC cache deployment and storage belong in [rpc-cache.md](rpc-cache.md).

## Prepare metadata before indexing

Download verified metadata before building the indexer:

```bash
ETHERSCAN_MIN_REQUEST_INTERVAL_MS=1000 pnpm run indexer:metadata -- --prefetch-deployments --source-report docs/performance/indexer-metadata-source-coverage.json
```

This uses Sourcify's [contract lookup API](https://docs.sourcify.dev/docs/api/),
including compiler metadata, source files and runtime/deployment evidence. It
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
to refresh completed discovery, or `--output <file>` to inspect a separate copy.
For that preview, copy the bundled JSON to the output path first: a new output
path starts from empty metadata plus any local contract cache.
Review generated changes and run the repository validation before committing.
Run preparation after adding registered contracts or upgrading discovery logic;
do not make every startup depend on this download.

Only conclusive discovery receives a versioned chain/address/runtime-hash
receipt: a proven immutable deployment, ordinary code with explicitly empty
compiler immutable references, or bytecode/proxy evidence that excludes lifetime
reuse. Ordinary code alone does not establish immutable ineligibility. Runtime
negative reuse requires the observed code hash to match; positive lifetime facts
still require canonical creation and runtime verification. Reused facts retain
their actual verification block.

Unavailable sources, 404/429 responses and incomplete compiler proof never become
permanent negative receipts. Failed refreshes preserve prior metadata. Broad
preparation reports partial coverage; targeted unavailable refreshes fail.
Inspect the final summary rather than treating exit zero as complete coverage.
New or unprepared contracts retain automatic runtime discovery. These cases can
still contact Sourcify or Etherscan, so their independent runtime limits remain.
Raising eRPC's RPC budget does not change either metadata service's allowance.

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
performs no HTTP requests. Partial explorer verification does not authorize
deployment lifetime, immutable-getter or conclusive-discovery proofs.

The source report distinguishes unavailable Sourcify evidence from Etherscan
availability, unverified contracts, unsupported chains, authentication failures,
quota errors and malformed responses. Etherscan fallback preserves existing
nonempty metadata and independent proofs. It only fills missing ABI metadata;
it never follows proxy implementation or similar-match addresses. An explorer
ABI/source response does not supply compiler immutable references, source maps,
runtime matching or creation proof, so it cannot create a deployment-discovery
receipt or an immutable/lifetime fact. Later Sourcify proof discovery remains
eligible. `--refresh-getters` retains its Sourcify-only verification behavior.

Explorer requests use bounded retries for HTTP/API rate limits, transport errors
and body-read timeouts. Errors and source reports omit provider-authored error
text and credential URLs. Authentication failure or exhausted daily quota stops
further explorer calls for that batch while Sourcify preparation continues.

## Normal startup

The indexer runs `envio start` without a reset flag. Deployments and crash
restarts resume compatible state. Envio retains its configuration and schema
compatibility checks. If startup reports incompatibility, inspect the error.
No startup error automatically resets the database.

## Reset the Railway indexer from your local machine

**This operation drops and recreates the Envio schema.** Back up the Envio
database before you start. The separate RPC cache database remains intact.

The package command uses [Railway SSH](https://docs.railway.com/cli/ssh).
It runs Node directly because the distroless image has no shell, `pnpm`, or `npx`.
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
The Railway command test uses a fake CLI to check explicit environment selection.
The actual distroless image runs the official reset command against disposable
Postgres and fixture Hasura responses. These checks do not validate live SSH transport.
No live SSH session, deployment, variable change, or database reset was performed.
No arbitrary cursor SQL or partial historical replay is part of this procedure.
