import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const validEnv = {
  DATABASE_URL:
    "postgres://postgres:postgres@localhost:5432/protocol_visualizer",
  HASURA_GRAPHQL_ENDPOINT: "http://hasura:8080/v1/metadata",
  HASURA_GRAPHQL_ADMIN_SECRET: "secret",
  ENVIO_RPC_URL_1: "https://example.com/1",
  ENVIO_RPC_URL_10: "https://example.com/10",
  ENVIO_RPC_URL_421614: "https://example.com/421614",
  ENVIO_RPC_URL_84532: "https://example.com/84532",
  ENVIO_RPC_URL_42161: "https://example.com/42161",
  ENVIO_RPC_URL_4663: "https://example.com/4663",
  ENVIO_RPC_URL_8453: "https://example.com/8453",
  ENVIO_RPC_URL_80094: "https://example.com/80094",
  ENVIO_RPC_URL_11155111: "https://example.com/11155111",
  ETHERSCAN_API_KEY: "etherscan-api-key",
};

async function loadModule() {
  Object.assign(process.env, validEnv);
  process.env.ENVIO_HASURA_STARTUP_TIMEOUT_MS = "1";
  return import(`./start-envio.mjs?test=${Date.now()}-${Math.random()}`);
}

test("shutdown forcibly stops an unresponsive process group after the deadline", async () => {
  const { stopEnvioGroup } = await loadModule();
  const child = spawn(
    process.execPath,
    [
      "-e",
      'process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)',
    ],
    { detached: true, stdio: ["ignore", "pipe", "ignore"] }
  );
  const exited = new Promise((accept) =>
    child.once("exit", (code, signal) => accept({ code, signal }))
  );
  try {
    await new Promise((accept, reject) => {
      child.stdout.once("data", accept);
      child.once("error", reject);
    });
    await stopEnvioGroup(child, "SIGTERM", 100);
    assert.equal((await exited).signal, "SIGKILL");
    await stopEnvioGroup(child, "SIGTERM", 100);
    await stopEnvioGroup(undefined, "SIGTERM", 100);
  } finally {
    child.kill("SIGKILL");
  }
});

test("resumes on Railway by default and resets only when explicitly requested", async () => {
  const { resolveEnvioArgs } = await loadModule();
  assert.deepEqual(resolveEnvioArgs([], { RAILWAY_SERVICE_ID: "svc" }), [
    "start",
  ]);
  assert.deepEqual(
    resolveEnvioArgs(["start", "-r"], { RAILWAY_SERVICE_ID: "svc" }),
    ["start", "-r"]
  );
  assert.deepEqual(resolveEnvioArgs(["dev"], { RAILWAY_SERVICE_ID: "svc" }), [
    "dev",
  ]);
  assert.deepEqual(resolveEnvioArgs(["start"], {}), ["start"]);
  assert.deepEqual(
    resolveEnvioArgs(["start", "--restart"], { RAILWAY_SERVICE_ID: "svc" }),
    ["start", "--restart"]
  );
  assert.deepEqual(resolveEnvioArgs(["local", "db-migrate", "setup"], {}), [
    "local",
    "db-migrate",
    "setup",
  ]);
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

test("allows local dev validation without managed database variables", async () => {
  const { validateIndexerEnv } = await loadModule();
  const {
    DATABASE_URL,
    HASURA_GRAPHQL_ENDPOINT,
    HASURA_GRAPHQL_ADMIN_SECRET,
    ...devEnv
  } = validEnv;

  assert.doesNotThrow(() =>
    validateIndexerEnv(devEnv, { requireManagedRuntimeEnv: false })
  );
  assert.throws(
    () => validateIndexerEnv(devEnv, { requireManagedRuntimeEnv: true }),
    /DATABASE_URL, HASURA_GRAPHQL_ENDPOINT, HASURA_GRAPHQL_ADMIN_SECRET/
  );
});

test("requires Etherscan API key for contract metadata", async () => {
  const { validateIndexerEnv } = await loadModule();
  const { ETHERSCAN_API_KEY, ...envWithoutEtherscan } = validEnv;

  assert.throws(
    () =>
      validateIndexerEnv(envWithoutEtherscan, {
        requireManagedRuntimeEnv: false,
      }),
    /ETHERSCAN_API_KEY/
  );
});

test("formats spawn failures loudly", async () => {
  const { formatEnvioSpawnError } = await loadModule();
  assert.match(
    formatEnvioSpawnError(
      Object.assign(new Error("spawn envio ENOENT"), { code: "ENOENT" })
    ),
    /Envio entrypoint was not found/
  );
});

test("spawns Envio through node instead of the pnpm shell shim", async () => {
  const { resolveEnvioCommand } = await loadModule();
  const command = resolveEnvioCommand("/app/apps/indexer");
  assert.equal(command.command, process.execPath);
  assert.deepEqual(command.args, [
    "/app/apps/indexer/node_modules/envio/bin.mjs",
    "start",
  ]);
});

test("resolves the Envio entrypoint independently of the SSH working directory", async () => {
  const { resolveEnvioCommand } = await loadModule();
  const previous = process.cwd();
  try {
    process.chdir(tmpdir());
    assert.equal(
      resolveEnvioCommand().args[0],
      fileURLToPath(new URL("../node_modules/envio/bin.mjs", import.meta.url))
    );
  } finally {
    process.chdir(previous);
  }
});

test("storage preflight captures launch dotenv before native CLI changes project directory", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pv-storage-env-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const launch = join(directory, "launch");
  const project = join(directory, "project");
  mkdirSync(launch);
  mkdirSync(project);
  writeFileSync(join(launch, ".env"), "ENVIO_PG_SCHEMA=launch_schema\n");
  writeFileSync(join(project, ".env"), "ENVIO_PG_SCHEMA=project_schema\n");
  writeFileSync(join(project, "schema.graphql"), "type Transfer { id: ID! }\n");
  writeFileSync(join(project, "handler.js"), "export {};\n");
  writeFileSync(
    join(project, "config.yaml"),
    `name: storage-env-fixture
contracts:
  - name: Example
    handler: ./handler.js
    events:
      - event: Transfer(address indexed from, address indexed to, uint256 value)
chains:
  - id: 1
    start_block: 0
    contracts:
      - name: Example
        address: "0x0000000000000000000000000000000000000001"
`
  );
  const envioRoot = dirname(
    createRequire(import.meta.url).resolve("envio/package.json")
  );
  const nativeUrl = (name) =>
    pathToFileURL(join(envioRoot, "src", `${name}.res.mjs`)).href;
  const trace = join(directory, "storage.json");
  // Run the real adapter/CLI/config/Env; replace only the database boundary.
  const storage = `import { writeFileSync } from "node:fs";
import { Db } from ${JSON.stringify(nativeUrl("Env"))};
export const makeClient = () => undefined;
export const makeStorageFromEnv = () => ({
  isInitialized: async () => false,
  close: async () => writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ schema: Db.publicSchema, closed: true }))
});`;
  const preload = `import { registerHooks } from "node:module";
registerHooks({ load(url, context, nextLoad) {
  return url === ${JSON.stringify(nativeUrl("PgStorage"))}
    ? { format: "module", shortCircuit: true, source: ${JSON.stringify(storage)} }
    : nextLoad(url, context);
}});`;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(preload)}`,
      fileURLToPath(new URL("./check-envio-storage.mjs", import.meta.url)),
      "start",
      "--directory",
      project,
    ],
    {
      cwd: launch,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "development",
        LOG_STRATEGY: "ecs-console",
        LOG_LEVEL: "silent",
        ENVIO_API_TOKEN: "fixture-only",
      },
      encoding: "utf8",
      timeout: 10_000,
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(trace, "utf8")), {
    schema: "launch_schema",
    closed: true,
  });
});
