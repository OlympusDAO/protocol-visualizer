# Indexer operations

This runbook covers Envio startup and deliberate rebuilds.
RPC cache deployment and storage belong in [rpc-cache.md](rpc-cache.md).

## Normal startup

The indexer runs `envio start` without a reset flag. Deployments and crash
restarts resume compatible state. Envio retains its configuration and schema
compatibility checks. If startup reports incompatibility, inspect the error.
No startup error automatically resets the database.

## Reset the existing indexer service over SSH

Use [Railway SSH](https://docs.railway.com/cli/ssh) to open a Node console in the
indexer container. The image contains Node but no `sh`, `bash`, `pnpm`, or `npx`.
A plain interactive `railway ssh` shell is therefore unsuitable for this image.
The command form below requests Node explicitly.

The container must remain running while **Envio ingestion is stopped**.
The normal wrapper exits when its Envio child exits, so killing that child does
not provide a stable maintenance container. Temporarily replace the start
command with a small health server instead. This uses the same image and
private service variables. No extra Railway service or local tunnel is needed.

### 1. Check SSH access before maintenance

From your local terminal, run this read-only probe:

```bash
railway ssh --service indexer --environment production -- /nodejs/bin/node --version
```

Replace `production` with the actual environment. Register an SSH key with
Railway if required. The probe must print the image's Node version and exit.
If SSH rejects the shell-free command, stop here. Do not assume that an
interactive shell is available or change the database to test connectivity.
The Railway SSH transport has not been tested against the live indexer.

### 2. Stop ingestion and keep the service available

1. Back up the Envio database.
2. Record the deployed image digest and current start command.
3. Pause indexer autodeploys, publisher jobs, and monitor jobs.
4. Stop the active indexer deployment. Check that all old replicas have stopped.
5. Set this temporary **Custom Start Command** on the existing indexer service:

   ```text
   /nodejs/bin/node -e 'require("http").createServer((q,r)=>{r.statusCode=q.url==="/healthz"?200:503;r.end("maintenance");}).listen(Number(process.env.PORT||9898),"::")'
   ```

6. Deploy the same image with that command and the existing service variables.
   Keep one replica. Do not deploy new source during this operation.
7. Check that the maintenance deployment is active and all old instances are stopped.

The temporary process performs no database work and does not start Envio.
It serves `/healthz` with status 200 so the Railway deployment can become active.
It returns status 503 for `/ready` and `/metrics`, preventing publication readiness.
Keep Hasura, Envio Postgres, and the RPC cache running.

### 3. Open the Node console and run the reset

From your local terminal:

```bash
railway ssh --service indexer --environment production -- /nodejs/bin/node --interactive
```

At the remote Node prompt, run these lines:

```javascript
process.chdir("/app/apps/indexer");
const { spawnSync } = require("node:child_process");
const reset = spawnSync(process.execPath, ["scripts/start-envio.mjs", "local", "db-migrate", "setup"], { stdio: "inherit" });
reset.status
```

**The `setup` command drops and recreates the Envio schema.** Run it once only,
with ingestion stopped. It uses the deployed image's configuration and existing
private database and Hasura connections. The wrapper derives Envio connection
variables from `DATABASE_URL`. It does not reset the separate RPC cache database.

Wait for the command to finish. Check that `reset.status` is `0` and that the
logs contain no Hasura metadata errors. If the reset fails, keep maintenance
mode active and investigate. Do not retry automatically.

Exit the Node console with:

```text
.exit
```

The maintenance process continues after this SSH session closes.

### 4. Resume normal indexing

1. Clear the temporary Custom Start Command to restore the image default.
   Its equivalent explicit command is `/nodejs/bin/node scripts/start-envio.mjs`.
2. Redeploy the same image with the normal command.
3. Wait for indexer `/ready` and check that indexing progress advances.
4. Resume publisher and monitor jobs, then check the gateway manifest.
5. Restore the indexer's normal autodeploy configuration.

Use a fresh `INDEXER_DEPLOYMENT_ID` if a same-commit rebuild needs a new snapshot
namespace. Leave the RPC cache service, database, and volume intact.
Never save a reset command as the normal start or pre-deploy command.

## Local Compose reset

After stopping the local indexer, run:

```bash
docker compose run --rm --no-deps indexer scripts/start-envio.mjs local db-migrate setup
```

Start the indexer normally after successful completion. Do not remove any
project volumes. An explicit `scripts/start-envio.mjs start -r` or `--restart`
also resets and starts ingestion, but it must remain an operator-only action.

## Verification boundary

The actual distroless image passed the local maintenance-process check:
`/healthz` returned 200, `/ready` and `/metrics` returned 503, and direct Node
execution worked. The interactive Node console and child-command pattern also
passed a local read-only version probe. The same official reset command passed
the controlled integration check against disposable Postgres and fixture Hasura responses.
No live SSH session, deployment, variable change, or database reset was performed.
No arbitrary cursor SQL or partial historical replay is part of this procedure.
