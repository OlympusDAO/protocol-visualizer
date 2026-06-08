# Railway Self-Hosted Snapshot Architecture

This project runs the Envio indexer, private Hasura, private Railway Bucket,
snapshot publisher, snapshot monitor, public REST API, and frontend on Railway.
Hasura, Postgres, the indexer, publisher, monitor, and bucket stay private. The
only public data service is `snapshot-gateway`.

## Services

| Service              | Railway config                    | Role                                      |
| -------------------- | --------------------------------- | ----------------------------------------- |
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
commented.

Set on `hasura`:

```bash
HASURA_GRAPHQL_DATABASE_URL=${{Postgres.DATABASE_URL}}
HASURA_GRAPHQL_ADMIN_SECRET=${{shared.HASURA_GRAPHQL_ADMIN_SECRET}}
```

Set on `indexer`:

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
HASURA_GRAPHQL_ENDPOINT=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/metadata
HASURA_GRAPHQL_ADMIN_SECRET=${{shared.HASURA_GRAPHQL_ADMIN_SECRET}}
ENVIO_RPC_URL_1=<ethereum RPC>
ENVIO_RPC_URL_10=<optimism RPC>
ENVIO_RPC_URL_42161=<arbitrum RPC>
ENVIO_RPC_URL_8453=<base RPC>
ENVIO_RPC_URL_80094=<berachain RPC>
ENVIO_RPC_URL_11155111=<sepolia RPC>
ENVIO_API_TOKEN=<envio-api-token>
# ENVIO_RPC_MODE=
```

`ENVIO_API_TOKEN` should be set for production deployments. When
`ENVIO_RPC_MODE` is left blank, the indexer wrapper derives `fallback` from the
token so Envio uses HyperSync with RPC fallback. Running without a token falls
back to RPC-only indexing and is materially slower for cold backfills.

Do not set `ENVIO_PG_SCHEMA` on Railway. The indexer wrapper fails fast if it is
set. Railway start commands run `envio start -r`; public handover is handled by
the publisher manifest, not database schemas.

Set on `snapshot-publisher`:

```bash
HASURA_GRAPHQL_URL=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/graphql
HASURA_GRAPHQL_ADMIN_SECRET=${{hasura.HASURA_GRAPHQL_ADMIN_SECRET}}
BUCKET=${{<bucket-service>.BUCKET}}
ACCESS_KEY_ID=${{<bucket-service>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<bucket-service>.SECRET_ACCESS_KEY}}
REGION=${{<bucket-service>.REGION}}
ENDPOINT=${{<bucket-service>.ENDPOINT}}
# INDEXER_DEPLOYMENT_ID=${{shared.INDEXER_DEPLOYMENT_ID}}
# DISCORD_WEBHOOK_URL=<discord webhook url>
# MONITOR_STALE_CHAIN_HOURS=24
```

Set on `snapshot-monitor`:

```bash
DISCORD_WEBHOOK_URL=<discord webhook url>
HASURA_GRAPHQL_URL=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/graphql
HASURA_GRAPHQL_ADMIN_SECRET=${{hasura.HASURA_GRAPHQL_ADMIN_SECRET}}
BUCKET=${{<bucket-service>.BUCKET}}
ACCESS_KEY_ID=${{<bucket-service>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<bucket-service>.SECRET_ACCESS_KEY}}
REGION=${{<bucket-service>.REGION}}
ENDPOINT=${{<bucket-service>.ENDPOINT}}
# INDEXER_DEPLOYMENT_ID=${{shared.INDEXER_DEPLOYMENT_ID}}
# MONITOR_STATE_KEY=v1/monitor-state.json
# MONITOR_STALE_CHAIN_HOURS=24
```

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

## Deployment

1. Create Postgres and Railway Bucket.
2. Create Hasura, indexer, publisher, monitor, gateway, and frontend services
   with their config-as-code files.
3. Configure variables using Railway references.
4. Deploy Hasura and indexer.
5. Manually run `snapshot-publisher` once.
6. Confirm `GET /ready`, `GET /v1/bounds`, and
   `GET /v1/chains/1/protocol` through the gateway.
7. Point the frontend at the Cloudflare-proxied gateway domain.

## Cloudflare

Cache eligible `GET` and `HEAD` routes under `/v1/` and `/`. Bypass `/ready`.
Block non-`GET`/`HEAD`/`OPTIONS` methods, request bodies on `GET`/`HEAD`, and
paths outside the public REST surface. Let Cloudflare handle edge compression.

## Validation

Run the repository validation sequence from `AGENTS.md`. The local
`validate:local` script also checks generated OpenAPI and the monitor build.
