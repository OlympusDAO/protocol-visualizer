# Railway Self-Hosted Snapshot Architecture

This project runs the Envio indexer, private Hasura, private Railway Bucket,
snapshot publisher, snapshot monitor, public REST API, and frontend on Railway.
Hasura, the indexer, publisher, monitor, bucket, and cache use private networking.
The existing Envio Postgres operator TCP proxy is retained during migration.
The public application services are `snapshot-gateway` and `frontend`.

The private RPC proxy and its independent Postgres are described in
[rpc-cache.md](rpc-cache.md), including variables, finality limits,
deployment order, and rollback. Provision those two resources before routing
consumers through the proxy.

## Infrastructure as Code

[`.railway/railway.ts`](../.railway/railway.ts) defines the whole project:
all seven application services, both databases, both volumes, the storage bucket,
production domains, and canvas groups. It preserves the current database image
majors and volume names. IaC supplies service connections through Railway references.
Provider URLs and operator secrets use `preserve()`; their values stay in Railway.
Optional operator settings listed in `variables.ignore` remain outside IaC ownership.

| Resource | Role |
| --- | --- |
| `Postgres` / `destruction-volume` | Envio data and Hasura metadata; existing Postgres 16 |
| `rpc-cache-postgres` / `postgres-volume` | Independent RPC cache; existing Postgres 18 |
| `hasura` | Private GraphQL for publisher and monitor |
| `indexer` | Private Envio indexer |
| `rpc-cache` | Private JSON-RPC cache |
| `snapshot-publisher` | Hourly bucket publisher |
| `snapshot-monitor` | Daily indexing monitor |
| `snapshot-gateway` | Public REST API |
| `frontend` | Public UI |
| `storage` | Private snapshot bucket in `sjc` |

The imported Envio volume is 5,000 MB in production and 50,000 MB in previews.
The cache volume is 50,000 MB. These are existing capacity limits, not database
reset commands. Review any later capacity or region change before merging.

## Bootstrap and migration

Use Railway CLI 5.71.0 or newer, Node and pnpm from this repository, and the
pinned Railway SDK installed by `pnpm install --frozen-lockfile`.

The local migration used Railway's `config migrate --show` preview and
`config pull --environment production --force --variables unmanaged` import.
The preview found no active legacy Config File settings. The import retained
storage and resource names; the repository's Docker, healthcheck, restart, and
cron settings were then moved into the IaC file. The legacy JSON files are removed.
Do not run `config pull --force` over the reviewed file during a normal rollout.

For each existing environment, check migration state before deploying this change:

```bash
railway link
railway config migrate status
```

Select the intended project and environment when linking. If the status lists
legacy file readers, use the reversible cutover command before deploying the
commit that removes those files:

```bash
railway config migrate cutover
```

That command changes live Config File settings and saves a local rollback
snapshot. It is separate from the filesystem-only `config migrate --apply`
generator. Keep the snapshot locally; `railway config migrate undo` restores
its settings if needed. Neither operation resets application databases.
No cutover, undo, or apply was run while preparing this migration.

Before the first merge:

1. Create a Railway project token scoped to **production**.
2. Add it as the GitHub repository secret **`RAILWAY_TOKEN`**.
3. Provision and verify the private cache service and its separate database first.
4. Supply all nine `UPSTREAM_RPC_URL_<id>` values on `rpc-cache`.
5. Preserve the other operator secrets listed below.
6. Review the production plan posted on the PR.

IaC supplies all nine consumer RPC URLs. The production rollout must wait until
the cache service passes private-network and provider checks. Otherwise, a whole-project
apply switches consumers to an unready proxy. Do not merge the automatic apply
workflow before this prerequisite is complete.

For a new environment, provision the cache resources first through a reviewed,
cache-only IaC plan or the Railway dashboard. Supply provider credentials manually
on `rpc-cache`. Configure its Dockerfile as `Dockerfile-rpc-cache`, its healthcheck
as `/healthcheck`, and its database reference as shown in [rpc-cache.md](rpc-cache.md).
Verify the proxy before the whole-project apply routes consumers through it.

## Automatic variables and manual secrets

| Destination | Supplied by IaC | Manual values retained in Railway |
| --- | --- | --- |
| `rpc-cache` | `PORT=4000`, `RPC_CACHE_DATABASE_URL` from `rpc-cache-postgres.DATABASE_URL` | Nine `UPSTREAM_RPC_URL_<id>` values; optional `RPC_CACHE_MAX_RPS` |
| `indexer` | Nine `ENVIO_RPC_URL_<id>` paths through `rpc-cache`; Envio database and Hasura references; `PORT=9898` | `ENVIO_API_TOKEN`, `ETHERSCAN_API_KEY`; optional `ENVIO_RPC_MODE` |
| `snapshot-publisher` | Nine `RPC_URL_<id>` paths; bucket, Hasura, and indexer metrics references | Optional `DISCORD_WEBHOOK_URL` and operator overrides |
| `snapshot-monitor` | Nine `RPC_URL_<id>` paths; bucket and indexer metrics references | Required `DISCORD_WEBHOOK_URL`; optional operator overrides |
| `snapshot-gateway` | Five bucket references; `PORT=8080` | Optional operator overrides |
| `hasura` | Envio database reference; shared admin-secret reference; `PORT=8080` | The shared `HASURA_GRAPHQL_ADMIN_SECRET` value |
| `frontend` | HTTPS URL from `snapshot-gateway.RAILWAY_PUBLIC_DOMAIN` | None for these connections |

The bucket references use `storage.BUCKET`, `storage.ACCESS_KEY_ID`,
`storage.SECRET_ACCESS_KEY`, `storage.REGION`, and `storage.ENDPOINT`.
Railway resolves them separately in each environment. Do not copy bucket credentials
into source or frontend variables. The frontend receives only the public gateway URL.

`preserve()` retains an existing value. It does not generate a missing provider URL,
API token, or webhook. Supply required secrets in Railway before deploying the service.
The RPC cache fails clearly at runtime when a required upstream value is absent.
Builds and IaC evaluation do not need provider credentials.

The PR 82 bootstrap copied existing indexer provider URLs into the cache's upstream
variables through the authenticated CLI. It did not print or commit their values.
This bootstrap does not supply credentials to production or future environments.
Before any consumer switch, retain the previous provider values for rollback.

## Automatic plan and apply

[`.github/workflows/railway-config.yml`](../.github/workflows/railway-config.yml)
uses the pinned official [Railway Config Action](https://github.com/railwayapp/config).
For same-repository PRs into `master` that affect IaC or its tooling:

- Opening, reopening, or updating the PR produces a **production** plan comment.
- Merging applies that exact saved plan to production.
- Closing without merging does not apply anything.
- Fork PRs do not receive the Railway credential or run these jobs.

The action checks the environment revision and `.railway/` tree before apply.
A changed environment or configuration requires a fresh PR plan. Destructive
changes are blocked by `confirm-destructive: false`; they need a separate,
explicitly approved operator action. Workflow runs are serialized for production
and do not cancel an apply already in progress.

The token selects the environment. It must be scoped to production for both
jobs. Do not substitute a preview token. Production sources always use `master`,
even while the production plan is generated from an unmerged PR.

Application code continues to use Railway GitHub autodeploys and watch patterns.
Those deployments can start independently of the IaC workflow; this workflow
does not serialize application deployments behind an infrastructure apply.
This workflow does **not** auto-apply IaC changes to PR environments on every
commit. For preview infrastructure changes, run an explicit plan and apply:

```bash
export RAILWAY_ENVIRONMENT=protocol-visualizer-pr-82
export RAILWAY_SOURCE_BRANCH=feat/robinhood-chain
pnpm run railway:check
pnpm run railway:plan
# After reviewing the preview plan:
railway config apply --environment "$RAILWAY_ENVIRONMENT"
```

Preview branches must be explicit. No production custom domains are attached to
previews. Operator secrets and generated Railway domains remain on Railway.
A PR environment's databases survive ordinary redeploys and disappear when
Railway deletes that temporary environment.

## Rollback

Restore previous application settings through a reviewed IaC change. Keep both
databases, volumes, and the bucket in the definition. Omitting a resource from
this whole-project file proposes deletion; the workflow blocks destructive
applies. Never change the Envio database image major during this migration.
Do not restore an old indexer image that resets the database at startup.
For proxy failures, restore prior consumer RPC URLs while keeping cache storage.

## Handover Model

The publisher writes snapshots under deployment-scoped internal keys:

```text
v1/deployments/<deploymentId>/chain/<chainId>/protocol.json
```

It publishes `v1/manifest.json` last. The manifest is the public blue/green
handover boundary. During a deliberate indexer rebuild, `snapshot-gateway`
keeps serving the previous active manifest.
Public REST responses never expose deployment ids or S3 object keys.

## Public REST API

```text
GET /
GET /healthz
GET /ready
GET /v1/openapi.json
GET /v1/bounds
GET /v1/manifest
GET /v1/chains
GET /v1/chains/{chainId}/protocol
```

`/v1/bounds` includes `indexingProgress.chains[*] = { chainId, date,
timestamp, block }`. Static JSON paths such as `/v1/manifest.json` and
`/v1/chain/{chainId}/protocol.json` are not public routes.

## Railway Variables

Required variables are uncommented in the examples below. Optional variables are
commented.

Set on `hasura`:

```bash
PORT=8080
HASURA_GRAPHQL_DATABASE_URL=${{Postgres.DATABASE_URL}}
HASURA_GRAPHQL_ADMIN_SECRET=${{shared.HASURA_GRAPHQL_ADMIN_SECRET}}
```

Hasura should stay on `PORT=8080` because the private URLs used by the indexer
and publisher target `hasura.railway.internal:8080`. If this port changes,
update `HASURA_GRAPHQL_ENDPOINT` on `indexer` and `HASURA_GRAPHQL_URL` on
`snapshot-publisher`.

Set on `indexer`:

```bash
PORT=9898
DATABASE_URL=${{Postgres.DATABASE_URL}}
HASURA_GRAPHQL_ENDPOINT=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/metadata
HASURA_GRAPHQL_ADMIN_SECRET=${{shared.HASURA_GRAPHQL_ADMIN_SECRET}}
ENVIO_RPC_URL_1=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/1
ENVIO_RPC_URL_10=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/10
ENVIO_RPC_URL_42161=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/42161
ENVIO_RPC_URL_421614=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/421614
ENVIO_RPC_URL_84532=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/84532
ENVIO_RPC_URL_4663=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/4663
ENVIO_RPC_URL_8453=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/8453
ENVIO_RPC_URL_80094=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/80094
ENVIO_RPC_URL_11155111=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/11155111
ENVIO_API_TOKEN=<envio-api-token>
ETHERSCAN_API_KEY=<etherscan-api-key>
# ENVIO_RPC_MODE=
```

`ENVIO_API_TOKEN` should be set for production deployments. When
`ENVIO_RPC_MODE` is left blank, the indexer wrapper derives `fallback` from the
token so Envio uses HyperSync with RPC fallback. Running without a token falls
back to RPC-only indexing and is materially slower for cold backfills.
`ETHERSCAN_API_KEY` is required so the indexer can fetch contract metadata that
is not already precomputed or available in local ABI/source-code files.

Do not set `ENVIO_PG_SCHEMA` on Railway. The indexer wrapper fails fast if it is
set. Railway start commands run `envio start` and resume compatible state.
Envio rejects incompatible changes; it does not automatically wipe data.
For an intentional reset, follow [indexer-operations.md](indexer-operations.md),
including the manual SSH reset in the existing indexer service.

The publisher and monitor read Envio's private `/metrics` endpoint to decide
whether a deployment is ready. The indexer Railway service must set `PORT=9898`
so the health wrapper exposes `/healthz`, `/ready`, and proxied `/metrics` on
`indexer.railway.internal:9898`. If that port is changed, update
`INDEXER_METRICS_URL` on both `snapshot-publisher` and `snapshot-monitor` to
match the indexer's `PORT`.

Set all nine `RPC_URL_<chainId>` variables on both snapshot jobs to the private
proxy paths documented in [rpc-cache.md](rpc-cache.md).

Set on `snapshot-publisher`:

```bash
HASURA_GRAPHQL_URL=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/graphql
HASURA_GRAPHQL_ADMIN_SECRET=${{hasura.HASURA_GRAPHQL_ADMIN_SECRET}}
RAILWAY_ENVIRONMENT_NAME=<provided by Railway>
INDEXER_METRICS_URL=http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:9898/metrics
BUCKET=${{storage.BUCKET}}
ACCESS_KEY_ID=${{storage.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{storage.SECRET_ACCESS_KEY}}
REGION=${{storage.REGION}}
ENDPOINT=${{storage.ENDPOINT}}
# INDEXER_DEPLOYMENT_ID=${{shared.INDEXER_DEPLOYMENT_ID}}
# DISCORD_WEBHOOK_URL=<discord webhook url>
# MONITOR_STALE_CHAIN_HOURS=24
```

`RAILWAY_ENVIRONMENT_NAME` is provided automatically by Railway. Do not add a
custom replacement variable; `snapshot-publisher` fails fast if the Railway
environment name is missing.

`INDEXER_DEPLOYMENT_ID` is a manual artifact namespace override. When it is not
set, Railway's `RAILWAY_GIT_COMMIT_SHA` is used. The publisher watches
`/apps/indexer/**`, so normal indexer code changes redeploy both indexer and
publisher from the same commit and produce a new namespace. Publisher-only code
changes also produce a new namespace for the same indexed data; this is
acceptable and simply creates a fresh snapshot manifest. For a same-commit
manual indexer redeploy, reset, or backfill, set `INDEXER_DEPLOYMENT_ID` to a new
safe value before running `snapshot-publisher` if the active manifest should
handover to a fresh bucket prefix.

Set on `snapshot-monitor`:

```bash
DISCORD_WEBHOOK_URL=<discord webhook url>
RAILWAY_ENVIRONMENT_NAME=<provided by Railway>
INDEXER_METRICS_URL=http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:9898/metrics
BUCKET=${{storage.BUCKET}}
ACCESS_KEY_ID=${{storage.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{storage.SECRET_ACCESS_KEY}}
REGION=${{storage.REGION}}
ENDPOINT=${{storage.ENDPOINT}}
# INDEXER_DEPLOYMENT_ID=${{shared.INDEXER_DEPLOYMENT_ID}}
# MONITOR_STATE_KEY=v1/monitor-state.json
# MONITOR_STALE_CHAIN_HOURS=24
```

`snapshot-monitor` also fails fast if `RAILWAY_ENVIRONMENT_NAME` is missing.

Set on `snapshot-gateway`:

```bash
BUCKET=${{storage.BUCKET}}
ACCESS_KEY_ID=${{storage.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{storage.SECRET_ACCESS_KEY}}
REGION=${{storage.REGION}}
ENDPOINT=${{storage.ENDPOINT}}
```

Set on `frontend`:

```bash
VITE_PROTOCOL_SNAPSHOT_BASE_URL=https://protocol-visualizer-api.olympusdao.finance
```

Use `BUCKET` for S3 API calls, not `RAILWAY_BUCKET_NAME`.

## Railway Policies

Long-running services use `restartPolicyType: ON_FAILURE` and
`restartPolicyMaxRetries: 1`: `hasura`, `indexer`, `snapshot-gateway`, and
`frontend`.

Cron services use `restartPolicyType: NEVER`:

- `snapshot-publisher`: `0 * * * *`
- `snapshot-monitor`: `5 0 * * *`

Healthchecks:

- `hasura`: `/healthz`
- `indexer`: `/healthz`
- `snapshot-gateway`: `/ready`
- `frontend`: `/`

The snapshot gateway also exposes `/healthz` as a storage-independent liveness
check. Railway intentionally uses `/ready` so a deployment is promoted only
after the active manifest and every referenced chain artifact are accessible.
Readiness failures emit sanitized, state-change-aware logs with provider error
codes, affected chain ids when available, and check duration.

## Deployment checks

After the initial apply, configure and verify the RPC cache, then check indexer
progress, publisher and monitor configuration, gateway `GET /ready`,
`GET /v1/bounds`, and `GET /v1/chains/1/protocol`. An infrastructure apply does
not prove that every application deployment or provider is healthy.

## Cloudflare

Cache eligible `GET` and `HEAD` routes under `/v1/` and `/`. Bypass `/ready`.
Block non-`GET`/`HEAD`/`OPTIONS` methods, request bodies on `GET`/`HEAD`, and
paths outside the public REST surface. Let Cloudflare handle edge compression.

## Validation

Run the repository validation sequence from `AGENTS.md`. The local
`validate:local` script also checks generated OpenAPI and the monitor build.


## Recorded migration checks (2026-10-29)

Railway CLI 5.71.0 and SDK 3.16.0 evaluated the complete definition. Read-only
plans show 3 additions and 12 build/deploy updates in production, and 1 addition
and 12 build/deploy updates in PR #82. Both have zero deletions and no changes
to existing databases, volumes, bucket, groups, or service variables.
The PostgreSQL images remain 16 for Envio and 18 for the separate cache.

All nine required repository validation steps passed in order. Native SDK tests
cover the resource inventory, database images, capacities, branch/domain rules,
variable ownership, and merge workflow guards. Checksum-verified Actionlint
1.7.12 validated the workflow. The workflow itself has not run against GitHub.
The current GitHub credential received HTTP 403 when listing secret names, so
the presence and scope of `RAILWAY_TOKEN` must be confirmed by a repository admin.
No infrastructure apply, live variable edit, cutover, push, or deployment was run.
