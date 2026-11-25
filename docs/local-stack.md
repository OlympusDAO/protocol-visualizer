# Local Docker Compose Stack

Use Docker Compose to run the Railway-like topology locally:

- `rpc-cache` forwards JSON-RPC and persists finalized history in its separate
  `rpc-cache-postgres` database. See [rpc-cache.md](rpc-cache.md).
- `postgres` stores Hasura metadata and indexed Envio data.
- `hasura` is private to the Compose network for the publisher, monitor, and
  indexer.
- `indexer` writes indexed data and exposes `/healthz` plus proxied Envio
  routes.
- `minio` is the private S3-compatible stand-in for Railway Bucket.
- `snapshot-publisher` and `snapshot-publisher-sample` are one-shot jobs.
- `snapshot-monitor` is a one-shot Discord monitor job.
- `snapshot-gateway` is the public Node REST API.
- `frontend` is built against the local REST API URL.

## Ports

Both PostgreSQL services use the [Compose-pinned](../docker-compose.yml) official Alpine image with `postgres18-data` / `rpc-cache-postgres18-data` volumes at `/var/lib/postgresql` and `PGDATA=/var/lib/postgresql/18/docker`. Local PG data is disposable; use fresh volumes for a major-version change instead of reusing old cluster files. This differs from the [production Railway storage contract](indexer-operations.md#database-major-version-rebuild). Stop this stack's containers before reviewing obsolete PostgreSQL volumes for named cleanup; never remove `minio-data` as a side effect or use a shared/global prune.

All published ports bind `127.0.0.1`; none defaults to a LAN-facing host binding.
See [security posture](security-posture.md) for local credentials and production boundaries.

| Service            | Host URL                | Purpose                      |
| ------------------ | ----------------------- | ---------------------------- |
| `frontend`         | `http://localhost:3000` | Protocol visualizer UI       |
| `snapshot-gateway` | `http://localhost:8082` | Public REST snapshot API     |
| `hasura`           | `http://localhost:8080` | Local Hasura console/API     |
| `indexer`          | `http://localhost:9898` | Indexer `/healthz` and proxy |
| `minio`            | `http://localhost:9000` | S3 API                       |
| `minio` console    | `http://localhost:9001` | Bucket inspection UI         |
| `postgres`         | `localhost:5432`        | Local database               |

Defaults are defined in `docker-compose.yml`. Copy `.env.compose.sample` to
`.env` and set `ENVIO_API_TOKEN`, `ETHERSCAN_API_KEY`, plus the enabled-chain
`UPSTREAM_RPC_URL_*` variables before starting the indexer. Required values in the
sample are uncommented; optional overrides are commented. The compose stack
fails early without the token, Etherscan key, and RPC URLs because HyperSync
with RPC fallback is the expected local ingestion path, and the indexer needs
Etherscan for contract metadata that is not already precomputed or local.
RPC-only indexing is much slower and is mainly useful for deliberate fallback
testing.

## Start And Publish

```bash
pnpm run stack:up
pnpm run stack:publish:sample
```

`stack:up` runs the long-running services in the foreground. Keep that terminal
attached for logs and stop it with `Ctrl-C`; run publisher and monitor jobs from
another terminal when needed. Publisher and monitor jobs are not started by
default because they mirror Railway cron/manual runs.

Use sample snapshots for a fast smoke test. Use live local Hasura data after the
indexer has caught up:

```bash
curl http://localhost:9898/healthz
pnpm run stack:publish
```

## REST Smoke Checks

```bash
curl -I http://localhost:8082/ready
curl -I http://localhost:8082/v1/openapi.json
curl http://localhost:8082/v1/bounds
curl http://localhost:8082/v1/chains
curl http://localhost:8082/v1/chains/1/protocol
```

`/ready` returns `503` until `v1/manifest.json` exists in MinIO. After a
successful publisher run it returns `200`.

Set `DISCORD_WEBHOOK_URL_PREVIEW` for the default `local-compose` environment
before running publisher or monitor jobs (`DISCORD_WEBHOOK_URL` is used only
when the environment is `production`). Both log an
error and exit unsuccessfully when it is missing or blank. To run the monitor:

```bash
pnpm run stack:monitor
```

## Shutdown And Cleanup

```bash
pnpm run stack:logs
pnpm run stack:down
```

`stack:down` keeps named volumes. Do not use `down --volumes`: it would delete Envio,
MinIO, and the independent persistent RPC cache.

## Validation

```bash
pnpm run stack:config
pnpm validate:all
```

`validate:all` builds production images. It does not require the local indexer
to complete a full backfill.

`stack:config` and `stack:up` require `ENVIO_API_TOKEN`, `ETHERSCAN_API_KEY`,
`UPSTREAM_RPC_URL_1`, `UPSTREAM_RPC_URL_10`, `UPSTREAM_RPC_URL_42161`,
`UPSTREAM_RPC_URL_421614`, `UPSTREAM_RPC_URL_84532`, `UPSTREAM_RPC_URL_4663`, `UPSTREAM_RPC_URL_8453`, `UPSTREAM_RPC_URL_80094`, and `UPSTREAM_RPC_URL_11155111` to be
present in `.env` or the shell environment.
