# Frontend

This package contains the Vite/React protocol visualizer frontend.

## Environment

The frontend reads per-chain protocol snapshots from the public snapshot
gateway. Configure the endpoint at build time:

```bash
VITE_PROTOCOL_SNAPSHOT_BASE_URL=http://localhost:8082
```

For Railway, point this value at the public snapshot gateway domain, not
directly at Hasura or the private Railway Bucket.

Supported chain labels and explorer URLs come from
`packages/protocol-config/protocol-chains.json`, which is also used by the
snapshot publisher and gateway.

## Development

```bash
pnpm --filter frontend run dev
```

## Validation

```bash
pnpm --filter frontend run lint:check
pnpm --filter frontend run build
```
