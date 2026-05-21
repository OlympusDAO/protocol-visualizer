# Protocol Visualizer

This repository contains the source code for a visualizer of the Olympus protocol.

To be specific, it visualizes the following:

- Modules
- Kernel
- Policies
- Roles
- Role Assignments
- Role Assignees

## Components

The project is made up of these components:

- Indexer
  - This uses Envio HyperIndex to index blockchain events
- GraphQL proxy
  - A GET-only public GraphQL gateway that forwards read queries to private
    Hasura and emits cache headers for Cloudflare
- Frontend
  - A static frontend that retrieves records through GraphQL and renders them in
    a diagram

## Deployment

The indexer is designed to be self-hosted with Postgres and Hasura. The default
indexer config is RPC-only and does not require `ENVIO_API_TOKEN`.

Railway self-hosting is documented in `docs/railway-self-hosting.md`. The
deployable Railway services are defined by `railway-indexer.json`,
`railway-hasura.json`, `railway-graphql-proxy.json`, and
`railway-frontend.json`.

The frontend is a static build that points at the public GraphQL proxy. The
proxy talks to Hasura over Railway private networking.

## Validation

Run full local validation (including Docker builds):

```bash
pnpm run validate:local
```

Run checks individually:

```bash
pnpm run check:runtime-versions
pnpm install --frozen-lockfile
pnpm run lint:check
pnpm run build
pnpm run docker:build:indexer
pnpm run docker:build:frontend
pnpm run docker:build:hasura
pnpm run docker:build:graphql-proxy
```

## Indexer

Indexer setup, local Envio testing, metrics, and Docker runtime notes are
documented in `apps/indexer/README.md`.

Quick local indexer commands:

```bash
pnpm run indexer:dev
pnpm run indexer:dev:reset
pnpm run indexer:metrics
```

## Frontend

The frontend reads from the public GraphQL proxy using GET requests. Configure
it at build time with:

```bash
VITE_ENVIO_GRAPHQL_URL=http://localhost:8080/graphql
```
