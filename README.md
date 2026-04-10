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

The project is made up of two components:

- Indexer
  - This uses the Ponder framework to index blockchain events
- Frontend
  - A static frontend that retrieves records from the indexer and renders them in a diagram

## Deployment

Note: WIP

- PostgreSQL database
  - Hosted on a Google Compute Engine VM
- Indexer
  - Hosted on a Google Compute Engine VM
- Frontend
  - Hosted on Fleek

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
```

## Runtime Image Notes

- The indexer runtime image keeps `pnpm`/Corepack so it can execute `pnpm exec ponder ...` at startup.
- `npm` is removed from the indexer runtime image because it is not required to run the service and it reduces toolchain-only vulnerability surface in container scans.
