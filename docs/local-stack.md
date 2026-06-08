# Local Docker Compose Stack

Use Docker Compose to run the Railway-like topology locally:

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
`.env` and set `ENVIO_API_TOKEN` plus the enabled-chain `ENVIO_RPC_URL_*`
variables before starting the indexer. Required values in the sample are
uncommented; optional overrides are commented. The compose stack fails early
without the token and RPC URLs because HyperSync with RPC fallback is the
expected local ingestion path; RPC-only indexing is much slower and is mainly
useful for deliberate fallback testing.

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

Run the monitor job only when `DISCORD_WEBHOOK_URL` is set:

```bash
pnpm run stack:monitor
```

## Shutdown And Cleanup

```bash
pnpm run stack:logs
pnpm run stack:down
docker compose down --volumes
```

`stack:down` keeps named volumes. The direct Docker command removes local
Postgres and MinIO data.

## Validation

```bash
pnpm run stack:config
pnpm run validate:local
```

`validate:local` builds production images. It does not require the local indexer
to complete a full backfill.

`stack:config` and `stack:up` require `ENVIO_API_TOKEN`,
`ENVIO_RPC_URL_1`, `ENVIO_RPC_URL_10`, `ENVIO_RPC_URL_42161`,
`ENVIO_RPC_URL_8453`, `ENVIO_RPC_URL_80094`, and `ENVIO_RPC_URL_11155111` to be
present in `.env` or the shell environment.
