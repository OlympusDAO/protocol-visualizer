# GraphQL Proxy

This package is a small public GraphQL gateway for the protocol visualizer.

It accepts browser-friendly `GET` GraphQL requests at `/graphql`, forwards them
to the private Hasura endpoint, and adds `Cache-Control` headers so Cloudflare
can cache successful responses by URL. `POST` and other non-GET GraphQL requests
are rejected. Introspection is allowed. `/ready` returns proxy liveness for
Railway healthchecks.

The public proxy contract is GET-only for browser and Cloudflare caching, but
the proxy forwards requests to Hasura as JSON POST requests for compatibility
with Hasura's GraphQL endpoint.

## Environment

Only `HASURA_GRAPHQL_URL` is required:

```bash
HASURA_GRAPHQL_URL=http://localhost:8080/v1/graphql
```

On Railway it should point at Hasura's private domain, for example:

```bash
HASURA_GRAPHQL_URL=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/graphql
```

Defaults:

- `PORT`: Railway injects this; otherwise defaults to `8080`
- `GRAPHQL_PROXY_CACHE_CONTROL`: `public, s-maxage=60, stale-while-revalidate=300`
- `GRAPHQL_PROXY_CORS_ORIGIN`: `*`
- `GRAPHQL_PROXY_MAX_URL_LENGTH`: `32768`
- `GRAPHQL_PROXY_MAX_QUERY_LENGTH`: `12000`
- `GRAPHQL_PROXY_MAX_VARIABLES_LENGTH`: `4000`

## Local Run

```bash
PORT=8081 HASURA_GRAPHQL_URL=http://localhost:8080/v1/graphql pnpm --filter graphql-proxy run dev
```

## Cloudflare

When exposing this service publicly, put a Cloudflare-proxied custom domain in
front of Railway and keep the public API surface to `GET /graphql`.

The full Cloudflare cache, WAF, and rate limiting setup is documented in
[`docs/railway-self-hosting.md`](../../docs/railway-self-hosting.md).

## Validation

```bash
pnpm --filter graphql-proxy run build
pnpm --filter graphql-proxy run lint:check
```
