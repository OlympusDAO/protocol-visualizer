# Frontend

This package contains the Vite/React protocol visualizer frontend.

## Environment

The frontend reads from the public GraphQL proxy using GET requests. Configure
the endpoint at build time:

```bash
VITE_ENVIO_GRAPHQL_URL=http://localhost:8081/graphql
```

For Railway, point this value at the public GraphQL proxy domain, not directly
at Hasura.

## Development

```bash
pnpm --filter frontend run dev
```

## Validation

```bash
pnpm --filter frontend run lint:check
pnpm --filter frontend run build
```
