# Railway cache infrastructure

`railway.ts` is a named partial for the two new cache resources. Existing
services and storage remain outside its ownership. This is an incremental
migration, not a complete definition of the monorepo environment.

Use the pinned SDK from the root install and Railway CLI 5.71.0 or newer:

```bash
export RAILWAY_ENVIRONMENT=protocol-visualizer-pr-82
export RAILWAY_SOURCE_BRANCH=feat/robinhood-chain
pnpm run railway:check
pnpm run railway:plan
```

Review the plan. Apply only after approval:

```bash
railway config apply --environment "$RAILWAY_ENVIRONMENT"
```

Do not remove the `partial` export while the file lists only the cache pair.
A whole-project apply can delete resources absent from the definition.
Do not rename the partial without a separate ownership migration.

Provider credentials stay in Railway shared variables referenced by the cache
service. Do not commit credentials or plans containing decrypted values.
No automatic infrastructure apply is configured. Application GitHub autodeploys
and infrastructure plan/apply are separate operations.

See [the RPC cache runbook](../docs/rpc-cache.md) for variables, preview behavior,
consumer cutover, and rollback.
