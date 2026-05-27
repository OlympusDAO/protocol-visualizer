# Snapshot Gateway

This app is the public read-only gateway for protocol visualizer snapshots. It
is a small Go HTTP service using the standard `net/http` server and the AWS SDK
for Go v2 S3 client.

## Runtime Role

Railway Buckets are private, so browsers cannot read snapshot files directly.
The gateway exposes a fixed public HTTP contract and maps each route to a known
object key in the private bucket.

Allowed public paths:

```text
GET  /
HEAD /
OPTIONS /
GET  /v1/
HEAD /v1/
OPTIONS /v1/
GET  /v1/index.html
HEAD /v1/index.html
OPTIONS /v1/index.html
GET  /robots.txt
HEAD /robots.txt
OPTIONS /robots.txt
GET  /sitemap.xml
HEAD /sitemap.xml
OPTIONS /sitemap.xml
GET  /v1/manifest.json
HEAD /v1/manifest.json
OPTIONS /v1/manifest.json
GET  /v1/schemas/manifest-v1.schema.json
HEAD /v1/schemas/manifest-v1.schema.json
OPTIONS /v1/schemas/manifest-v1.schema.json
GET  /v1/schemas/protocol-snapshot-v1.schema.json
HEAD /v1/schemas/protocol-snapshot-v1.schema.json
OPTIONS /v1/schemas/protocol-snapshot-v1.schema.json
GET  /v1/chain/{chainId}/protocol.json
HEAD /v1/chain/{chainId}/protocol.json
OPTIONS /v1/chain/{chainId}/protocol.json
GET  /ready
HEAD /ready
```

Supported chain IDs are loaded from
`packages/protocol-config/protocol-chains.json`, which is copied into the
gateway image. The gateway rejects unknown paths, unsupported chains, request
bodies, and methods other than `GET`, `HEAD`, and CORS preflight `OPTIONS` for
the allowlisted `/v1/` routes.

## Readiness

`/ready` checks that `v1/manifest.json` is accessible in the Railway Bucket with
S3 `HeadObject`. It returns:

- `200` when the gateway can access the manifest.
- `503` when the manifest is missing or the bucket cannot be reached.

This means the gateway will not be marked healthy before the initial manual
publisher run has created the manifest.

## Environment

```bash
BUCKET=${{<bucket-service>.BUCKET}}
ACCESS_KEY_ID=${{<bucket-service>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<bucket-service>.SECRET_ACCESS_KEY}}
REGION=${{<bucket-service>.REGION}}
ENDPOINT=${{<bucket-service>.ENDPOINT}}
PORT=8080
```

`PORT` is injected by Railway. The default outside Railway is `8080`.
`PROTOCOL_CHAINS_CONFIG_PATH` defaults to `config/protocol-chains.json` and is
set to `/app/config/protocol-chains.json` in the Docker image.

Use `BUCKET` as the S3 bucket name. Do not use `RAILWAY_BUCKET_NAME`.

## Cache Headers

The gateway sets stable content types and cache headers:

- `/v1/chain/*/protocol.json`: `public, s-maxage=3600, stale-while-revalidate=86400`
- `/v1/manifest.json`: `public, s-maxage=300, stale-while-revalidate=3600`
- `/`, `/v1/`, `/v1/index.html`: `public, s-maxage=300, stale-while-revalidate=3600`
- `/robots.txt`, `/sitemap.xml`: `public, s-maxage=300, stale-while-revalidate=3600`
- `/v1/schemas/*`: `public, max-age=86400, immutable`

It also sets `X-Content-Type-Options: nosniff`.

The gateway permits browser reads with `Access-Control-Allow-Origin: *` and
supports preflight only for allowlisted `/v1/` routes. It does not allow
credentials or map arbitrary request paths to bucket keys.

## Validation

The Docker build runs Go tests and compiles the static gateway binary:

```bash
pnpm run docker:build:snapshot-gateway
```

The tests cover route allowlisting, chain allowlisting, request-body rejection,
method rejection, CORS headers, cache headers, HEAD support, and
manifest-based readiness.

For local end-to-end testing, run the gateway through Docker Compose:

```bash
pnpm run stack:up
pnpm run stack:publish:sample
curl -I http://localhost:8082/v1/manifest.json
```
