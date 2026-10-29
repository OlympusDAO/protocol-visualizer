# Railway Self-Hosted Snapshot Architecture

This project runs the Envio indexer, private Hasura, private Railway Bucket,
snapshot publisher, snapshot monitor, public REST API, and frontend on Railway.
Hasura, Postgres, the indexer, publisher, monitor, and bucket stay private. The
only public data service is `snapshot-gateway`.

The private RPC proxy and its independent Postgres are described in
[rpc-cache.md](rpc-cache.md), including variables, finality limits,
deployment order, and rollback. Provision those two resources before routing
consumers through the proxy.

## Services

New cache services use Railway native IaC. Review and apply the `rpc-cache`
partial as documented in [rpc-cache.md](rpc-cache.md). Pushing an application
commit does not apply infrastructure changes. Existing services keep their
legacy JSON settings during this migration; those settings expire on 2026-12-01.


| Service              | Railway config                    | Role                                      |
| -------------------- | --------------------------------- | ----------------------------------------- |
| `rpc-cache` | `.railway/railway.ts` | Private JSON-RPC cache |
| `rpc-cache-postgres` | `.railway/railway.ts` | Persistent RPC cache only |
| `Postgres`           | Railway template                  | Envio data and Hasura metadata            |
| `hasura`             | `/railway-hasura.json`            | Private GraphQL for publisher/monitor     |
| `indexer`            | `/railway-indexer.json`           | Private Envio indexer                     |
| `snapshot-publisher` | `/railway-snapshot-publisher.json`| Hourly bucket publisher                   |
| `snapshot-monitor`   | `/railway-snapshot-monitor.json`  | Daily Discord indexing monitor            |
| `snapshot-gateway`   | `/railway-snapshot-gateway.json`  | Public Node REST API                      |
| `frontend`           | `/railway-frontend.json`          | Public UI                                 |
| Railway Bucket       | Railway storage bucket            | Private S3-compatible snapshot storage    |

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
BUCKET=${{<bucket-service>.BUCKET}}
ACCESS_KEY_ID=${{<bucket-service>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<bucket-service>.SECRET_ACCESS_KEY}}
REGION=${{<bucket-service>.REGION}}
ENDPOINT=${{<bucket-service>.ENDPOINT}}
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
BUCKET=${{<bucket-service>.BUCKET}}
ACCESS_KEY_ID=${{<bucket-service>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<bucket-service>.SECRET_ACCESS_KEY}}
REGION=${{<bucket-service>.REGION}}
ENDPOINT=${{<bucket-service>.ENDPOINT}}
# INDEXER_DEPLOYMENT_ID=${{shared.INDEXER_DEPLOYMENT_ID}}
# MONITOR_STATE_KEY=v1/monitor-state.json
# MONITOR_STALE_CHAIN_HOURS=24
```

`snapshot-monitor` also fails fast if `RAILWAY_ENVIRONMENT_NAME` is missing.

Set on `snapshot-gateway`:

```bash
BUCKET=${{<bucket-service>.BUCKET}}
ACCESS_KEY_ID=${{<bucket-service>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<bucket-service>.SECRET_ACCESS_KEY}}
REGION=${{<bucket-service>.REGION}}
ENDPOINT=${{<bucket-service>.ENDPOINT}}
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

## Deployment

For the existing deployment, plan and apply the cache partial using
[rpc-cache.md](rpc-cache.md). Preserve the current Postgres, bucket, Hasura,
indexer, publisher, monitor, gateway, and frontend resources. Route consumers
through eRPC only after provider and cache checks pass.

A fresh whole-stack deployment needs a complete IaC definition. The legacy
JSON files in the table document existing service settings; new services cannot
opt into them. Migrate the existing stack separately before the 2026-12-01
cutoff, including its storage and environment-specific values.

After consumer cutover, confirm gateway `GET /ready`, `GET /v1/bounds`, and
`GET /v1/chains/1/protocol`, plus indexer progress and snapshot publication.

## Cloudflare

Cache eligible `GET` and `HEAD` routes under `/v1/` and `/`. Bypass `/ready`.
Block non-`GET`/`HEAD`/`OPTIONS` methods, request bodies on `GET`/`HEAD`, and
paths outside the public REST surface. Let Cloudflare handle edge compression.

## Validation

Run the repository validation sequence from `AGENTS.md`. The local
`validate:local` script also checks generated OpenAPI and the monitor build.
