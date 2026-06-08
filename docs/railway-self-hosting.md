# Railway Self-Hosted Snapshot Architecture

This project runs the Envio indexer, private Hasura, private Railway Bucket,
snapshot publisher, snapshot monitor, public REST API, and frontend on Railway.
Hasura, Postgres, the indexer, publisher, monitor, and bucket stay private. The
only public data service is `snapshot-gateway`.

## Infrastructure as Code

Railway infrastructure is defined in `.railway/railway.ts`. It replaces the old
per-service `railway-*.json` files and is the single source of truth for:

- services, groups, Postgres, and the snapshot bucket
- Dockerfile paths and root-anchored watch patterns
- healthchecks, restart policies, resource limits, and cron schedules
- local Git source branch, environment-derived bucket names, Railway variable
  references, and preserved secrets

Local checks:

```bash
pnpm run railway:iac:check
railway environment <environment-name>
pnpm run railway:iac:plan
```

`railway:iac:check` evaluates the TypeScript graph locally. `railway:iac:plan`
requires a logged-in Railway CLI and previews changes without applying them. Do
not run `railway config apply` until the plan has been reviewed, because it can
create services or change live Railway settings.

Railway IaC apply flow:

1. Select the target environment with `railway environment <environment-name>`.
2. Check out the Git branch this environment should build.
3. Push the code changes that contain the new `.railway/railway.ts` state.
4. Run `railway config apply` after reviewing the plan.

This is only necessary when the service, bucket, variable, build, deploy,
healthcheck, cron, or resource-limit setup changes. Ordinary application code
changes should deploy from GitHub without running `railway config apply`.

The project pins `railway@3.1.1` for the TypeScript IaC SDK and has a narrow
`minimumReleaseAgeExclude` entry for that exact package version.

The GitHub source branch is one value per environment and is shared by every
service. `.railway/railway.ts` derives it from the local Git checkout when you
run `railway config plan` or `railway config apply`, so run those commands from
the branch Railway should build. The IaC fails fast if Railway does not provide
an environment name or if the local source branch cannot be determined.

## Services

| Service              | IaC resource                      | Role                                      |
| -------------------- | --------------------------------- | ----------------------------------------- |
| `Postgres`           | `postgres("Postgres")`            | Envio data and Hasura metadata            |
| `hasura`             | `service("hasura")`               | Private GraphQL for publisher/monitor     |
| `indexer`            | `service("indexer")`              | Private Envio indexer                     |
| `snapshot-publisher` | `service("snapshot-publisher")`   | Hourly bucket publisher                   |
| `snapshot-monitor`   | `service("snapshot-monitor")`     | Daily Discord indexing monitor            |
| `snapshot-gateway`   | `service("snapshot-gateway")`     | Public Node REST API                      |
| `frontend`           | `service("frontend")`             | Public UI                                 |
| Railway Bucket       | `bucket(snapshot bucket name)`     | Private S3-compatible snapshot storage    |

The snapshot bucket resource name is generated per Railway environment:
`snapshots-<environment-slug>-<stable-id>`. For example, production evaluates to
a `snapshots-production-...` bucket, while a preview environment gets its own
`snapshots-<preview-environment>-...` bucket. Run `pnpm run railway:iac:check`
or `pnpm run railway:iac:plan` to see the exact resource name for the linked
environment.

## Handover Model

The publisher writes snapshots under deployment-scoped internal keys:

```text
v1/deployments/<deploymentId>/chain/<chainId>/protocol.json
```

It publishes `v1/manifest.json` last. The manifest is the public blue/green
handover boundary. While a new indexer deployment reindexes with
`envio start -r`, `snapshot-gateway` keeps serving the previous active manifest.
Public REST responses never expose deployment ids or S3 object keys.

## Public REST API

```text
GET /
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
commented. Required secrets and external service values are configured with
`preserveExisting: true` in `.railway/railway.ts`: Railway keeps the current
value instead of overwriting it, but the IaC still marks the variable as
required.

Defined on `hasura` by `.railway/railway.ts`:

```bash
HASURA_GRAPHQL_DATABASE_URL=${{Postgres.DATABASE_URL}}
HASURA_GRAPHQL_ADMIN_SECRET=<preserve existing secret>
```

Defined on `indexer` by `.railway/railway.ts`:

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
HASURA_GRAPHQL_ENDPOINT=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/metadata
HASURA_GRAPHQL_ADMIN_SECRET=${{hasura.HASURA_GRAPHQL_ADMIN_SECRET}}
ENVIO_RPC_URL_1=<ethereum RPC>
ENVIO_RPC_URL_10=<optimism RPC>
ENVIO_RPC_URL_42161=<arbitrum RPC>
ENVIO_RPC_URL_8453=<base RPC>
ENVIO_RPC_URL_80094=<berachain RPC>
ENVIO_RPC_URL_11155111=<sepolia RPC>
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
set. Railway start commands run `envio start -r`; public handover is handled by
the publisher manifest, not database schemas.

The publisher and monitor read Envio's private `/metrics` endpoint to decide
whether a deployment is ready. The examples below use `9898` because the indexer
Railway service should set `PORT=9898`; if that port is changed, update
`INDEXER_METRICS_URL` to match the indexer's `PORT`.

Defined on `snapshot-publisher` by `.railway/railway.ts`:

```bash
HASURA_GRAPHQL_URL=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/graphql
HASURA_GRAPHQL_ADMIN_SECRET=${{hasura.HASURA_GRAPHQL_ADMIN_SECRET}}
INDEXER_METRICS_URL=http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:9898/metrics
BUCKET=${{<generated-snapshot-bucket>.BUCKET}}
ACCESS_KEY_ID=${{<generated-snapshot-bucket>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<generated-snapshot-bucket>.SECRET_ACCESS_KEY}}
REGION=${{<generated-snapshot-bucket>.REGION}}
ENDPOINT=${{<generated-snapshot-bucket>.ENDPOINT}}
INDEXER_DEPLOYMENT_ID=${{indexer.RAILWAY_DEPLOYMENT_ID}}
# DISCORD_WEBHOOK_URL=<discord webhook url>
# MONITOR_STALE_CHAIN_HOURS=24
```

`INDEXER_DEPLOYMENT_ID` is required and should reference the indexer service's
`RAILWAY_DEPLOYMENT_ID`. This makes the publisher's deployment-scoped snapshot
keys match the indexer deployment that produced the data.

Defined on `snapshot-monitor` by `.railway/railway.ts`:

```bash
DISCORD_WEBHOOK_URL=<discord webhook url>
INDEXER_METRICS_URL=http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:9898/metrics
BUCKET=${{<generated-snapshot-bucket>.BUCKET}}
ACCESS_KEY_ID=${{<generated-snapshot-bucket>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<generated-snapshot-bucket>.SECRET_ACCESS_KEY}}
REGION=${{<generated-snapshot-bucket>.REGION}}
ENDPOINT=${{<generated-snapshot-bucket>.ENDPOINT}}
INDEXER_DEPLOYMENT_ID=${{indexer.RAILWAY_DEPLOYMENT_ID}}
# MONITOR_STATE_KEY=v1/monitor-state.json
# MONITOR_STALE_CHAIN_HOURS=24
```

Defined on `snapshot-gateway` by `.railway/railway.ts`:

```bash
BUCKET=${{<generated-snapshot-bucket>.BUCKET}}
ACCESS_KEY_ID=${{<generated-snapshot-bucket>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<generated-snapshot-bucket>.SECRET_ACCESS_KEY}}
REGION=${{<generated-snapshot-bucket>.REGION}}
ENDPOINT=${{<generated-snapshot-bucket>.ENDPOINT}}
```

Defined on `frontend` by `.railway/railway.ts`:

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

Resource limits are defined directly in `.railway/railway.ts` for every
service:

| Service              | vCPU | Memory |
| -------------------- | ---: | -----: |
| `hasura`             | 1    | 2 GB   |
| `indexer`            | 1    | 2 GB   |
| `snapshot-publisher` | 1    | 1 GB   |
| `snapshot-monitor`   | 0.25 | 512 MB |
| `snapshot-gateway`   | 1    | 1 GB   |
| `frontend`           | 0.5  | 1 GB   |

Healthchecks:

- `hasura`: `/healthz`
- `indexer`: `/healthz`
- `snapshot-gateway`: `/ready`
- `frontend`: `/`

## Deployment

1. Select the target environment with `railway environment <environment-name>`.
2. Check out the Git branch this environment should build.
3. Push the code changes that contain the intended `.railway/railway.ts` state.
4. Run `pnpm run railway:iac:plan` and review the planned changes.
5. Apply the reviewed plan with `railway config apply` only when service or
   variable setup changed.
6. Set preserved secrets and environment-specific values that are intentionally
   not committed to code.
7. Deploy Hasura and indexer.
8. Manually run `snapshot-publisher` once.
9. Confirm `GET /ready`, `GET /v1/bounds`, and
   `GET /v1/chains/1/protocol` through the gateway.
10. Point the frontend at the Cloudflare-proxied gateway domain.

## Cloudflare

Cache eligible `GET` and `HEAD` routes under `/v1/` and `/`. Bypass `/ready`.
Block non-`GET`/`HEAD`/`OPTIONS` methods, request bodies on `GET`/`HEAD`, and
paths outside the public REST surface. Let Cloudflare handle edge compression.

## Validation

Run the repository validation sequence from `AGENTS.md`. The local
`validate:local` script also checks generated OpenAPI and the monitor build.
Run `pnpm run railway:iac:check` for an offline Railway IaC graph check and
`pnpm run railway:iac:plan` before applying infrastructure changes.
