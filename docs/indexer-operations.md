# Indexer operations

This runbook covers Envio startup and deliberate rebuilds.
RPC cache deployment and storage belong in [rpc-cache.md](rpc-cache.md).

## Normal startup

The indexer runs `envio start` without a reset flag. Deployments and crash
restarts resume compatible state. Envio retains its configuration and schema
compatibility checks. If startup reports incompatibility, inspect the error.
No startup error automatically resets the database.

## Reset the Railway indexer from your local machine

**This operation drops and recreates the Envio schema.** Back up the Envio
database before you start. The separate RPC cache database remains intact.

The package command uses [Railway SSH](https://docs.railway.com/cli/ssh).
It runs Node directly because the distroless image has no shell, `pnpm`, or `npx`.
The deployed image must include the reset control script and updated startup wrapper.

### Prepare

1. Authenticate the Railway CLI and link this checkout to the intended project.
2. Check that the target environment has exactly one active indexer replica.
3. Pause indexer autodeploys, publisher jobs, and monitor jobs.
4. Keep Hasura, Envio Postgres, and the RPC cache running.
5. Check SSH access with this read-only command:

   ```bash
   railway ssh --service indexer --environment production -- /nodejs/bin/node --version
   ```

Replace `production` with the target environment. Register an SSH key if Railway
requires one. If the probe fails, stop before the reset.

### Stop ingestion, reset, and resume Envio

From the repository root on your local machine:

```bash
RAILWAY_ENVIRONMENT=production pnpm run indexer:reset:railway
```

`RAILWAY_ENVIRONMENT` is required. Use the exact environment name or ID.
The command always targets the `indexer` service in the linked project.

The remote script connects to a private Unix socket owned by the indexer user.
The startup wrapper stops the entire Envio process group and waits for it to exit.
If shutdown exceeds 30 seconds, the wrapper refuses to start the migration.
The wrapper then runs the deployed Envio command, with its configuration and variables:

```text
/nodejs/bin/node /app/apps/indexer/node_modules/envio/bin.mjs local db-migrate setup
```

After a successful migration, the wrapper starts Envio again inside the same
container. No Railway service restart, deployment, or start-command change is needed.
The command prints a completion message and exits with the migration status.
A successful launch does not mean that indexing has caught up.

During the reset, `/healthz` returns 200 and `/ready` and `/metrics` return 503.
Concurrent reset requests are rejected. The reset continues if SSH disconnects.
If completion is not confirmed, inspect the indexer logs before you run another reset.
If migration fails, ingestion remains stopped. Inspect the failure before retrying.
Never configure this command as the normal start command or pre-deploy command.

### Check recovery

1. Wait for indexer `/ready` and check that indexing progress advances.
2. Resume publisher and monitor jobs, then check the gateway manifest.
3. Restore the normal autodeploy configuration.

Use a fresh `INDEXER_DEPLOYMENT_ID` if a same-commit rebuild needs a new snapshot
namespace. Leave the RPC cache service, database, and volume intact.

## Local Compose reset

After stopping the local indexer, run:

```bash
docker compose run --rm --no-deps indexer scripts/start-envio.mjs local db-migrate setup
```

Start the indexer normally after successful completion. Do not remove any
project volumes. An explicit `scripts/start-envio.mjs start -r` or `--restart`
also resets and starts ingestion, but it must remain an operator-only action.

## Verification boundary

Local process fixtures check complete ingestion shutdown before migration,
restart after success, maintenance after failure, and concurrent reset rejection.
The Railway command test uses a fake CLI to check explicit environment selection.
The actual distroless image runs the official reset command against disposable
Postgres and fixture Hasura responses. These checks do not validate live SSH transport.
No live SSH session, deployment, variable change, or database reset was performed.
No arbitrary cursor SQL or partial historical replay is part of this procedure.
