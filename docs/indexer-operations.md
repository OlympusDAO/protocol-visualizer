# Indexer operations

This runbook covers Envio startup, deliberate resets, and rebuilds.
RPC cache deployment and storage belong in [rpc-cache.md](rpc-cache.md).

## Railway CLI options

Checked against Railway CLI 5.71.0 and the linked official documentation.

| Command | Execution location | Fit for a deliberate reset |
| --- | --- | --- |
| [`railway run`](https://docs.railway.com/cli/run) | Your machine, with service variables | Requires local code/image and access to remote dependencies |
| [`railway redeploy`](https://docs.railway.com/cli/redeploy) | A new Railway deployment | Runs the service's configured command. No arbitrary command argument |
| [`railway cron run`](https://docs.railway.com/cli/cron) | A configured Railway cron service | Requires a cron service; do not schedule destructive resets |
| [`railway sandbox exec`](https://docs.railway.com/sandboxes) | A separately created sandbox | Requires sandbox setup, private networking, and the image/configuration |

The installed CLI has no general `railway exec` or `railway run --remote`
command for an arbitrary one-off service command. `railway run` does not run
inside the deployed indexer image. It does not provide private network access.
Our database and Hasura are private, so it is not a direct replacement for the
remote reset operation.

## Manual Railway reset job without SSH

For repeated operator use, configure a separate, manual `indexer-reset` service
once. Then trigger it from your local terminal. This avoids SSH tunnels, local
provider credentials, and changes to the normal indexer startup command.
This service is a proposed maintenance job. It is **not provisioned** by this
repository change.

Before its first deployment, configure the job with:

- The same immutable indexer image digest and runtime variables as the indexer.
  Keep its private database, Hasura, and RPC endpoints in the same environment.
- Custom Start Command:

  ```text
  /nodejs/bin/node scripts/start-envio.mjs local db-migrate setup
  ```

- Restart policy `NEVER`, one instance, and no healthcheck.
- No cron schedule, GitHub autodeploy, image auto-update, or other automatic trigger.
- No public endpoint or persistent volume.

Use the image source pinned to its digest. Do not attach the normal
`railway-indexer.json`: it specifies the indexer's healthcheck and restart
policy. Configure the reset command before the first job deployment, since that
deployment itself executes the destructive operation. Each later job deployment
also resets the database.

For each approved reset:

1. Back up the Envio database.
2. Stop the normal indexer and check that no replica or automatic restart is writing.
3. Pause publisher and monitor jobs.
4. Check the job's environment, database, and image digest against the stopped indexer.
5. Trigger the already-configured job from your terminal:

   ```bash
   railway redeploy --service indexer-reset --environment production
   ```

   Replace `production` with the actual environment. The command keeps its normal
   confirmation prompt. Do not use `railway redeploy --service indexer`: that
   starts the normal indexer instead of the reset job.

   If Railway reports that the completed job cannot be redeployed, check its
   source first. Only if that source is the verified immutable image digest,
   use:

   ```bash
   railway redeploy --from-source --service indexer-reset --environment production
   ```

   This pulls that pinned image again. Do not use this fallback with a moving
   tag or repository branch.

6. Inspect the latest job logs:

   ```bash
   railway logs --service indexer-reset --environment production
   ```

7. Wait for successful completion and check for Hasura metadata errors in the logs.
   If the job fails, keep the indexer stopped and investigate before another reset.
8. Resume the normal indexer with its normal image command.
9. Wait for indexer `/ready`, then resume publication and check the gateway manifest.

These commands are documented only. No reset job, deployment, schedule, or live
variable was created or changed during this work. The underlying distroless
reset command passed the controlled integration check. This Railway job lifecycle
was not exercised against a live environment.

## Normal startup and deliberate rebuild

Railway startup now runs `envio start` with no reset flag. Normal redeploys and
crash restarts resume compatible stored state. Envio 3.14.1 retains its own
configuration/schema compatibility checks. If startup reports incompatibility,
stop and inspect it; no error path automatically resets the database.

For an approved full rebuild:

1. Stop the indexer service and ensure no old replica/restart is writing. Pause
   publisher and monitor jobs while resetting. Back up Envio Postgres first.
2. Run a **one-off container from the exact deployed indexer image digest**, on
   the same private network, with the same indexer variables/configuration and
   working directory. Override its start command with this argv:

   ```text
   /nodejs/bin/node scripts/start-envio.mjs local db-migrate setup
   ```

   Envio's `setup` operation deliberately drops/recreates its schema and exits.
   It does not take a `--reset` option. The wrapper maps `DATABASE_URL` to
   Envio's Postgres variables. This command uses Node directly and works
   in the distroless image; `sh`, `pnpm`, and `npx` are not present. A platform
   one-off runner must use that argv, not a shell wrapper. Do not use
   `railway run` as though it executes inside the deployed image: it runs locally.
   For local Compose, after stopping indexer:

   ```bash
   docker compose run --rm --no-deps indexer scripts/start-envio.mjs local db-migrate setup
   ```

   For a command issued from your local terminal, use
   [the manual Railway reset job](#manual-railway-reset-job-without-ssh).
   The [local Docker fallback](#local-docker-fallback-with-ssh-tunnels) requires tunnels.

3. Restore the normal image command `scripts/start-envio.mjs`, then start the
   indexer. It rebuilds from configured start blocks. Leave `rpc-cache-postgres`
   and its volume alone. Resetting Envio cannot reach this separate database.
4. Wait for indexer `/ready`, run the publisher, and check the public gateway's
   `/ready` plus current manifest. Use a fresh `INDEXER_DEPLOYMENT_ID` if a new
   snapshot namespace is required for a same-commit rebuild.

An explicit `scripts/start-envio.mjs start -r` (or `--restart`) remains available
for a deliberate reset-and-run; never save it as the normal Railway command.
No cursor SQL, partial replay, automatic incompatibility recovery, or volume
removal is part of this workflow.

## Local Docker fallback with SSH tunnels

This procedure runs the deployed image in local Docker. SSH tunnels connect it
to the existing Railway environment. It resets the **Envio database**, not the
RPC cache database. Complete the stop, pause, and backup steps above first.
Keep the indexer stopped until the reset container exits successfully.

### Prerequisites

- Obtain a pullable or exported copy of the **exact deployed indexer image**.
  Record its registry reference, digest, and platform from the deployment artifact.
  A bare Railway image digest is not a registry reference. If the artifact is
  unavailable locally, use the private one-off runner described above.
  Do not substitute the current checkout or an image tagged `latest`.
- Register your SSH key with Railway. In the Hasura service, copy its **Service
  Instance ID** from the dashboard command palette. Keep Hasura running.
  The stopped indexer cannot serve as the SSH target.
- On Docker Desktop 4.34 or later, enable **Settings > Resources > Network >
  Enable host networking**. Docker Engine on Linux supports host networking.
  See [Docker host networking](https://docs.docker.com/engine/network/drivers/host/).
- Check the actual private hostnames and ports in the selected environment.
  The examples below use the service names in this runbook. They create no
  public domains or TCP proxies.

### Terminal 1: open the tunnels

Set the Hasura instance ID and actual private hostnames:

```bash
HASURA_INSTANCE_ID='<running-hasura-service-instance-id>'
ENVIO_DB_HOST='postgres.railway.internal'
HASURA_HOST='hasura.railway.internal'
RPC_CACHE_HOST='rpc-cache.railway.internal'

ssh -N -o ExitOnForwardFailure=yes \
  -L "127.0.0.1:15432:${ENVIO_DB_HOST}:5432" \
  -L "127.0.0.1:18080:${HASURA_HOST}:8080" \
  -L "127.0.0.1:14000:${RPC_CACHE_HOST}:4000" \
  "${HASURA_INSTANCE_ID}@ssh.railway.com"
```

Keep this terminal open. The forwards bind only to local loopback.
[Railway SSH](https://docs.railway.com/cli/ssh#forward-a-port-with-ssh--l)
supports forwarding into the same project's private network. This command runs
no shell or reset inside Hasura.

### Terminal 2: prepare the local configuration

Set the immutable image reference and its deployed platform:

```bash
INDEXER_IMAGE='<registry>/<indexer-image>@sha256:<deployed-image-digest>'
INDEXER_PLATFORM='linux/amd64' # Replace if the deployed artifact uses another platform.
ENVIO_DB_HOST='postgres.railway.internal' # Match Terminal 1 and DATABASE_URL.
docker pull --platform "$INDEXER_PLATFORM" "$INDEXER_IMAGE"

RESET_ENV_FILE="$(mktemp -t pv-indexer-reset.XXXXXX)"
chmod 600 "$RESET_ENV_FILE"
vi "$RESET_ENV_FILE"
```

If you loaded an exported image instead, omit `docker pull`. Check its digest
against the deployment artifact before continuing.

In the editor, copy the deployed indexer's service variables into this file.
Use the service configuration, not the wrapper process's derived environment.
Use plain `KEY=value` entries without shell interpolation or surrounding quotes.
Keep credentials out of shell commands and terminal output. Apply these changes:

- Keep the Envio database username, password, database name, hostname, and SSL
  mode. Change only its port to `15432`. Percent-encode credentials in the URI.
  Do not use `RPC_CACHE_DATABASE_URL` or the cache database credentials.
- Remove explicit `ENVIO_PG_*` connection variables. The wrapper derives them
  from `DATABASE_URL`. Keep `ENVIO_PG_SCHEMA` unset, as on Railway.
- Set `HASURA_GRAPHQL_ENDPOINT=http://127.0.0.1:18080/v1/metadata`.
  Keep the existing `HASURA_GRAPHQL_ADMIN_SECRET` and `ETHERSCAN_API_KEY`.
- Keep the existing Envio token and RPC mode. Set the nine RPC URLs below.
  The reset uses the deployed chain configuration; it does not start ingestion.

The network overrides in the file are:

```text
DATABASE_URL=postgresql://<user>:<encoded-password>@postgres.railway.internal:15432/<envio-database>?sslmode=<existing-mode>
HASURA_GRAPHQL_ENDPOINT=http://127.0.0.1:18080/v1/metadata
ENVIO_RPC_URL_1=http://127.0.0.1:14000/pv/evm/1
ENVIO_RPC_URL_10=http://127.0.0.1:14000/pv/evm/10
ENVIO_RPC_URL_42161=http://127.0.0.1:14000/pv/evm/42161
ENVIO_RPC_URL_8453=http://127.0.0.1:14000/pv/evm/8453
ENVIO_RPC_URL_80094=http://127.0.0.1:14000/pv/evm/80094
ENVIO_RPC_URL_4663=http://127.0.0.1:14000/pv/evm/4663
ENVIO_RPC_URL_11155111=http://127.0.0.1:14000/pv/evm/11155111
ENVIO_RPC_URL_421614=http://127.0.0.1:14000/pv/evm/421614
ENVIO_RPC_URL_84532=http://127.0.0.1:14000/pv/evm/84532
```

These entries supplement the retained runtime configuration; they are not a
complete environment file. Use your actual database hostname in both the URI
and `ENVIO_DB_HOST`. The Docker host override below preserves that hostname for
SSL verification while directing traffic through the local tunnel.

### Run the reset and restore normal operation

Check that the image, environment, database, and stopped indexer belong to the
same deployment. Then run this destructive command once:

```bash
docker run --rm \
  --platform "$INDEXER_PLATFORM" \
  --network host \
  --add-host "${ENVIO_DB_HOST}:127.0.0.1" \
  --env-file "$RESET_ENV_FILE" \
  --workdir /app/apps/indexer \
  --entrypoint /nodejs/bin/node \
  "$INDEXER_IMAGE" scripts/start-envio.mjs local db-migrate setup
```

The command exits after Envio recreates its schema and updates Hasura metadata.
It uses the image's Node binary and configuration, without a container shell.
If the command fails or the logs report a Hasura metadata error, keep the
indexer stopped and investigate. Do not repeat the reset automatically.

After a successful reset, remove the temporary credentials file:

```bash
rm -f "$RESET_ENV_FILE"
unset RESET_ENV_FILE
```

Close Terminal 1 with `Ctrl-C` to remove the tunnels. Resume the indexer with its
normal command, then follow the readiness and publisher checks above.
`railway run` alone is insufficient: it runs locally and does not make private
Railway hostnames reachable. No production reset or SSH tunnel was executed to
validate this documentation. The underlying distroless reset command passed the
controlled integration check described below.
