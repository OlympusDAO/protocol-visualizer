# Snapshot Publisher

This package generates the public protocol visualizer snapshot files and writes
them to a private Railway Bucket. It is a short-lived TypeScript/Node.js process
intended to run as a Railway cron job.

## Runtime Role

The publisher is the only service that reads protocol visualizer data from
private Hasura for the public frontend. On each run it:

1. Queries private Hasura once per supported chain.
2. Normalizes the GraphQL result into the public snapshot shape.
3. Generates per-chain `protocol.json` files, schema files, `manifest.json`,
   and `index.html`.
4. Validates each protocol snapshot before upload.
5. Uploads and verifies every non-manifest file with S3 `HeadObject`.
6. Uploads and verifies `manifest.json` last.

If any fetch, validation, upload, or verification fails, the process exits
non-zero so Railway records a failed cron run.

## Public Files

The generated object keys match the public gateway paths:

```text
v1/index.html
v1/manifest.json
v1/schemas/manifest-v1.schema.json
v1/schemas/protocol-snapshot-v1.schema.json
v1/chain/1/protocol.json
v1/chain/10/protocol.json
v1/chain/42161/protocol.json
v1/chain/8453/protocol.json
v1/chain/80094/protocol.json
v1/chain/11155111/protocol.json
```

The public schema version is `1.0.0`. Future JSON file types should get their
own schema files under `v1/schemas/`.

## Chain Configuration

Supported chains are defined once in:

```text
packages/protocol-config/protocol-chains.json
```

The publisher reads that file at startup. `SNAPSHOT_CHAIN_IDS` is only an
optional subset filter for a run; every chain ID in it must exist in the shared
config.

## Environment

Production requires:

```bash
HASURA_GRAPHQL_URL=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/graphql
BUCKET=${{<bucket-service>.BUCKET}}
ACCESS_KEY_ID=${{<bucket-service>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<bucket-service>.SECRET_ACCESS_KEY}}
REGION=${{<bucket-service>.REGION}}
ENDPOINT=${{<bucket-service>.ENDPOINT}}
SNAPSHOT_PUBLIC_BASE_PATH=/v1
```

Use `BUCKET` as the S3 bucket name. Do not use `RAILWAY_BUCKET_NAME`.

Optional variables:

```bash
SNAPSHOT_CHAIN_IDS=1,10,42161,8453,80094,11155111
PROTOCOL_CHAINS_CONFIG_PATH=/app/config/protocol-chains.json
```

## Local Generation

Generate deterministic sample snapshots without Hasura or bucket credentials:

```bash
pnpm run snapshots:generate:local
```

That writes files to:

```text
/tmp/protocol-visualizer-snapshots
```

To write live Hasura data locally, set `HASURA_GRAPHQL_URL`,
`SNAPSHOT_OUTPUT_DIR`, and `SNAPSHOT_SOURCE=hasura`.

## Validation

```bash
pnpm --filter snapshot-publisher run lint:check
pnpm --filter snapshot-publisher run build
pnpm run docker:build:snapshot-publisher
```

`build` compiles TypeScript and runs the Node test suite for snapshot
validation, chain allowlisting, and manifest-last behavior.
