# Snapshot Gateway

`snapshot-gateway` is the public REST API for protocol visualizer snapshots.
It is a small TypeScript service built on Node's standard `node:http` server.
It reads allowlisted objects from a private S3-compatible Railway Bucket and
does not expose Hasura, bucket keys, or deployment ids publicly.

## Public Routes

```text
GET  /
HEAD /
GET  /ready
HEAD /ready
GET  /v1/openapi.json
HEAD /v1/openapi.json
GET  /v1/bounds
HEAD /v1/bounds
GET  /v1/manifest
HEAD /v1/manifest
GET  /v1/chains
HEAD /v1/chains
GET  /v1/chains/{chainId}/protocol
HEAD /v1/chains/{chainId}/protocol
```

`OPTIONS` is supported for allowlisted routes. Request bodies, unsupported
methods, unknown paths, unsupported query parameters, and unsupported chain ids
are rejected.

## Readiness

`/ready` returns `200` only when `v1/manifest.json` is readable from the
bucket. The active manifest is the public handover boundary: while a new
indexer deployment reindexes, the gateway continues serving the previous
manifest-backed deployment.

## Configuration

Required production variables:

```bash
BUCKET=${{<bucket-service>.BUCKET}}
ACCESS_KEY_ID=${{<bucket-service>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<bucket-service>.SECRET_ACCESS_KEY}}
REGION=${{<bucket-service>.REGION}}
ENDPOINT=${{<bucket-service>.ENDPOINT}}
```

Optional:

```bash
PORT=8080
PROTOCOL_CHAINS_CONFIG_PATH=/app/config/protocol-chains.json
```

## OpenAPI

`openapi.json` is generated from shared route/schema constants:

```bash
pnpm --filter snapshot-gateway run build
pnpm --filter snapshot-gateway run openapi:check
```

Do not hand-edit `openapi.json`.
