# Snapshot Publisher

This package generates protocol visualizer snapshot files and writes them to a
private Railway Bucket. It is a short-lived TypeScript/Node.js process
intended to run as a Railway cron job.

## Runtime Role

The publisher is the only service that reads protocol visualizer data from
private Hasura for the public frontend. On each run it:

1. Queries private Hasura once per supported chain.
2. Normalizes the GraphQL result into the public snapshot shape.
3. Generates deployment-scoped per-chain snapshot files and an active manifest.
4. Validates each protocol snapshot before upload.
5. Uses `v1/publisher.lock` to avoid overlapping runs.
6. Uploads and verifies every deployment-scoped chain file with S3 `HeadObject`.
7. Uploads and verifies `v1/manifest.json` last.

If any fetch, validation, upload, or verification fails, the process exits
non-zero so Railway records a failed cron run.

## Bucket Files

The generated object keys are internal. The public REST API is served by
`snapshot-gateway`.

```text
v1/deployments/<deploymentId>/chain/<chainId>/protocol.json
v1/manifest.json
v1/publisher.lock
```

The active manifest is the handover boundary. While a new indexer deployment is
reindexing, the gateway continues serving the previous complete manifest.

## Chain Configuration

Supported chains are defined once in:

```text
packages/protocol-config/protocol-chains.json
```

The publisher reads that file at startup. `SNAPSHOT_CHAIN_IDS` is only an
optional subset filter for a run; every chain ID in it must exist in the shared
config.

## Configuration

Production bucket publishing reads from Hasura and uploads to the private
Railway Bucket. Required variables are uncommented; optional variables are
commented. Configure these required variables on the `snapshot-publisher`
Railway service:

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
```

Use `BUCKET` as the S3 bucket name. Do not use `RAILWAY_BUCKET_NAME`.
`HASURA_GRAPHQL_ADMIN_SECRET` should reference the same value configured on the
private Hasura service; without it, Hasura may return an unauthorized or empty
schema response.
`INDEXER_METRICS_URL` is the private Envio metrics endpoint. The publisher uses
`hyperindex_synced_to_head` and per-chain `envio_progress_ready` metrics as the
handover gate before reading Hasura or writing bucket objects.
The indexer Railway service must expose the same port used here. With the
documented setup, set `indexer.PORT=9898` and keep
`INDEXER_METRICS_URL=http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:9898/metrics`.
`RAILWAY_ENVIRONMENT_NAME` is provided automatically by Railway and is required;
the publisher fails before metrics reads or bucket writes if it is missing.
The `indexingProgress` values in the published manifest come from this metrics
endpoint: `date` and `timestamp` are the metrics scrape time, and `block` is the
latest Envio progress block for that chain. They are not derived from the newest
protocol record timestamp.
`INDEXER_DEPLOYMENT_ID` is optional when Railway provides `RAILWAY_GIT_COMMIT_SHA`,
but one of those values must be present in production. The deployment id is
validated before any Hasura read or bucket write.

Optional variables:

```bash
# INDEXER_DEPLOYMENT_ID=
# SNAPSHOT_PUBLIC_BASE_PATH=/v1
# SNAPSHOT_PUBLIC_ORIGIN=https://protocol-visualizer-api.olympusdao.finance
# SNAPSHOT_CHAIN_IDS=1,10,42161,8453,80094,11155111
# PROTOCOL_CHAINS_CONFIG_PATH=/app/config/protocol-chains.json
# PUBLISHER_LOCK_TTL_MS=3300000
# DISCORD_WEBHOOK_URL=
```

`SNAPSHOT_PUBLIC_BASE_PATH` defaults to `/v1`. `SNAPSHOT_PUBLIC_ORIGIN` is used
for generated REST paths. `PROTOCOL_CHAINS_CONFIG_PATH` is set by the Docker
image and usually does not need to be configured manually. `DISCORD_WEBHOOK_URL`
enables immediate handover messages when a new manifest is published.

Local-only variables:

```bash
# SNAPSHOT_OUTPUT_DIR=/tmp/protocol-visualizer-snapshots
# SNAPSHOT_SOURCE=sample
```

When `SNAPSHOT_OUTPUT_DIR` is set and `SNAPSHOT_SOURCE` is omitted, the
publisher defaults to deterministic sample data so local validation can run
without Hasura or bucket credentials. Set `SNAPSHOT_SOURCE=hasura` when writing
live Hasura data to a local output directory.

## Railway Cron

The Railway service uses `/railway-snapshot-publisher.json`, which configures:

```text
cronSchedule: 0 * * * *
restartPolicyType: NEVER
```

The publisher's Railway `watchPatterns` intentionally include `/apps/indexer/**`.
For normal GitHub deployments, Railway provides `RAILWAY_GIT_COMMIT_SHA`; the
publisher uses that value as the deployment-scoped artifact id when
`INDEXER_DEPLOYMENT_ID` is not set. Watching indexer source keeps the publisher
redeployed from the same commit as indexer code changes, matching the artifact
handover model used by the metrics publisher. For a same-commit manual reindex,
set `INDEXER_DEPLOYMENT_ID` to a new explicit value before running the publisher
if a fresh bucket namespace is required.

Deployment identity behavior:

| Scenario | Artifact id used by default | Result |
| --- | --- | --- |
| Indexer code/config changes | New `RAILWAY_GIT_COMMIT_SHA` | Publisher redeploys because it watches `/apps/indexer/**`, writes a new deployment-scoped namespace after the indexer is ready, then publishes `v1/manifest.json` last. |
| Publisher-only code/config changes | New `RAILWAY_GIT_COMMIT_SHA` | Publisher writes a new namespace for the same indexed data and can publish a new manifest. This is acceptable, but the manifest id represents the artifact namespace, not a distinct indexer reindex. |
| Hourly cron with no new deploy | Existing deployment id | Publisher refreshes the current namespace. If the active manifest already points at that namespace, object overwrites can be visible before the manifest is rewritten. |
| Same-commit manual indexer redeploy or reset | Existing `RAILWAY_GIT_COMMIT_SHA` unless overridden | Set `INDEXER_DEPLOYMENT_ID` to a new safe value before the publisher run when a fresh namespace is required. |
| Manual publisher backfill | Explicit `INDEXER_DEPLOYMENT_ID` if set, otherwise `RAILWAY_GIT_COMMIT_SHA` | Use an explicit id for controlled backfills so the bucket namespace and logs identify the run clearly. |

Each cron invocation starts the container, publishes one snapshot batch, logs one
structured JSON result, logs `Snapshot publisher completed successfully; exiting`
on success, and exits.

The structured result includes `deploymentId`, `published`, `skipReason`,
`manifestPublishedLast`, and `indexingProgress`. If Envio metrics show that the
indexer is not synced to head for every supported chain, the publisher exits
successfully with `skipReason: "not_data_ready"`, does not read Hasura, and
leaves the current manifest untouched.

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
`HASURA_GRAPHQL_ADMIN_SECRET`, `INDEXER_METRICS_URL`, `SNAPSHOT_OUTPUT_DIR`, and
`SNAPSHOT_SOURCE=hasura`.

To publish into the local Docker Compose bucket, use the one-shot Compose jobs:

```bash
pnpm run stack:publish:sample
pnpm run stack:publish
```

`stack:publish:sample` writes deterministic sample data to MinIO. `stack:publish`
reads from the local Hasura service and should be run after the indexer is
ready.

## Validation

```bash
pnpm --filter snapshot-publisher run lint:check
pnpm --filter snapshot-publisher run build
pnpm run docker:build:snapshot-publisher
```

`build` compiles TypeScript and runs the Node test suite for snapshot
validation, chain allowlisting, and manifest-last behavior.
