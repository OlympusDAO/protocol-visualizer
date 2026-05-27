# Local Docker Compose Stack

Use Docker Compose when you want the local services to communicate like the
Railway deployment:

- `postgres` stores Hasura metadata and indexed Envio data.
- `hasura` exposes the private GraphQL API to other containers.
- `indexer` waits for Hasura, writes to Postgres, and exposes `/ready`.
- `minio` acts as a local S3-compatible replacement for a private Railway
  Bucket.
- `snapshot-publisher` is a one-shot job that writes snapshot objects to MinIO.
- `snapshot-gateway` reads allowlisted objects from MinIO and exposes `/v1/*`.
- `frontend` is built against the local snapshot gateway URL.

The local bucket is intentionally private to the browser path. The frontend only
talks to `snapshot-gateway`, while the publisher and gateway talk to MinIO on
the internal Compose network.

## Ports

| Service              | Host URL                  | Purpose                         |
| -------------------- | ------------------------- | ------------------------------- |
| `frontend`           | `http://localhost:3000`   | Protocol visualizer UI          |
| `snapshot-gateway`   | `http://localhost:8082`   | Public snapshot API             |
| `hasura`             | `http://localhost:8080`   | Local Hasura console/API        |
| `indexer`            | `http://localhost:9898`   | Indexer metrics and `/ready`    |
| `minio`              | `http://localhost:9000`   | S3 API                          |
| `minio` console      | `http://localhost:9001`   | Bucket inspection UI            |
| `postgres`           | `localhost:5432`          | Local database                  |

Defaults are defined in `docker-compose.yml`. To override them, copy
`.env.compose.sample` to `.env`; Docker Compose loads `.env` automatically.
The committed sample uses local-only credentials.

## Start The Stack

```bash
pnpm run stack:up
```

This builds and starts:

```text
postgres, hasura, minio, minio-create-bucket, indexer, snapshot-gateway, frontend
```

The publisher jobs are not started by `stack:up` because they are short-lived
jobs, matching Railway cron/manual-run behavior.

## Publish Snapshots

For a fast UI smoke test that does not wait for the indexer, seed deterministic
sample snapshots into MinIO:

```bash
pnpm run stack:publish:sample
```

For a live local run, wait for the indexer to catch up and then publish from the
local Hasura service:

```bash
curl http://localhost:9898/ready
pnpm run stack:publish
```

`stack:publish` runs the same snapshot-publisher image used on Railway. It
calls `http://hasura:8080/v1/graphql` over the Compose network and uploads
objects to `http://minio:9000`.

After publishing, verify the gateway:

```bash
curl -I http://localhost:8082/ready
curl -I http://localhost:8082/
curl -I http://localhost:8082/v1/manifest.json
curl -I http://localhost:8082/sitemap.xml
curl http://localhost:8082/v1/chain/1/protocol.json
```

`/ready` returns `503` until `v1/manifest.json` exists in MinIO. That mirrors
Railway, where the gateway does not become healthy until the initial publisher
run has created the manifest.

## Frontend

The frontend image is built with:

```text
VITE_PROTOCOL_SNAPSHOT_BASE_URL=http://localhost:8082
```

After publishing snapshots, open:

```text
http://localhost:3000
```

If you change `VITE_PROTOCOL_SNAPSHOT_BASE_URL`, rebuild the frontend container:

```bash
pnpm run stack:up
```

## Logs And Shutdown

```bash
pnpm run stack:logs
pnpm run stack:down
```

`stack:down` keeps the named Docker volumes. To remove local Postgres and MinIO
data, run Docker Compose directly:

```bash
docker compose down --volumes
```

## Validation

Check the Compose file without starting containers:

```bash
pnpm run stack:config
```

The usual repository validation remains:

```bash
pnpm run validate:local
```

`validate:local` builds the production images. It does not start the Compose
stack or require local RPC indexing to complete.
