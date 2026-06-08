import assert from "node:assert/strict";
import { test } from "node:test";

const validEnv = {
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/protocol_visualizer",
  HASURA_GRAPHQL_ENDPOINT: "http://hasura:8080/v1/metadata",
  HASURA_GRAPHQL_ADMIN_SECRET: "secret",
  ENVIO_RPC_URL_1: "https://example.com/1",
  ENVIO_RPC_URL_10: "https://example.com/10",
  ENVIO_RPC_URL_8453: "https://example.com/8453",
  ENVIO_RPC_URL_80094: "https://example.com/80094",
  ENVIO_RPC_URL_11155111: "https://example.com/11155111",
};

async function loadModule() {
  Object.assign(process.env, validEnv);
  process.env.ENVIO_HASURA_STARTUP_TIMEOUT_MS = "1";
  return import(`./start-envio.mjs?test=${Date.now()}-${Math.random()}`);
}

test("adds reset flag for Railway start commands", async () => {
  const { resolveEnvioArgs } = await loadModule();
  assert.deepEqual(resolveEnvioArgs([], { RAILWAY_SERVICE_ID: "svc" }), [
    "start",
    "-r",
  ]);
  assert.deepEqual(resolveEnvioArgs(["start", "-r"], { RAILWAY_SERVICE_ID: "svc" }), [
    "start",
    "-r",
  ]);
  assert.deepEqual(resolveEnvioArgs(["dev"], { RAILWAY_SERVICE_ID: "svc" }), [
    "dev",
  ]);
  assert.deepEqual(resolveEnvioArgs(["start"], {}), ["start"]);
});

test("rejects Railway schema configuration and port mismatches", async () => {
  const { validateIndexerEnv } = await loadModule();
  assert.throws(
    () =>
      validateIndexerEnv({
        ...validEnv,
        PORT: "9898",
        ENVIO_INDEXER_PORT: "9898",
        ENVIO_PG_SCHEMA: "public",
        RAILWAY_SERVICE_ID: "svc",
      }),
    /ENVIO_PG_SCHEMA must not be set/
  );
  assert.throws(
    () =>
      validateIndexerEnv({
        ...validEnv,
        PORT: "9898",
        ENVIO_INDEXER_PORT: "9899",
      }),
    /ENVIO_INDEXER_PORT must match PORT/
  );
});

test("formats spawn failures loudly", async () => {
  const { formatEnvioSpawnError } = await loadModule();
  assert.match(
    formatEnvioSpawnError(
      Object.assign(new Error("spawn envio ENOENT"), { code: "ENOENT" })
    ),
    /envio binary was not found/
  );
});
