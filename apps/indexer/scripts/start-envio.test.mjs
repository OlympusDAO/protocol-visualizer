import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

test("native handler typechecking uses the installed TypeScript CLI and rejects handler errors", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pv-handler-typecheck-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const require = createRequire(import.meta.url);
  mkdirSync(join(directory, "node_modules"));
  symlinkSync(
    dirname(require.resolve("typescript/package.json")),
    join(directory, "node_modules/typescript")
  );
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(
    join(directory, "tsconfig.json"),
    '{"compilerOptions":{"strict":true,"types":[]},"include":["handler.ts"]}'
  );
  const handler = join(directory, "handler.ts");
  const { check } = await import(
    new URL(
      "./src/HandlerTypeCheck.res.mjs",
      pathToFileURL(require.resolve("envio"))
    )
  );
  writeFileSync(handler, "export const answer: number = 42;");
  assert.equal(await check(directory, [handler]), "Passed");
  writeFileSync(handler, 'export const answer: number = "wrong";');
  const rejected = await check(directory, [handler]);
  assert.equal(rejected.TAG, "TypeErrors");
  assert.match(rejected._0, /TS2322/);
});

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

test("native storage preflight preserves launch dotenv and checks compatibility without mutations", (t) => {
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
import * as ChainMap from ${JSON.stringify(nativeUrl("ChainMap"))};
import * as ChainState from ${JSON.stringify(nativeUrl("ChainState"))};
import * as AddressRows from ${JSON.stringify(nativeUrl("AddressRows"))};
export const makeStorageFromEnv = (config, logger, schema, hasura, max) => {
  if (schema !== undefined || hasura !== false || max !== 1) throw new Error("unsafe storage options");
  const calls = [], scenario = process.env.STORAGE_CASE;
  const chains = ChainMap.values(config.chainMap);
  const unexpected = () => { throw new Error("mutating storage method called"); };
  return {
    holding: async () => { calls.push("holding"); return ["Nothing", "Stranded", "Diverged", "Outdated", "Invalid"].includes(scenario) ? scenario : "Initialized"; },
    readStoredConfig: async () => {
      calls.push("readStoredConfig");
      if (scenario === "error") throw new Error("fixture-private-credential");
      return { envioInfo: scenario === "incompatible" ? undefined : config.envioInfo, chains, contractMapping: config.contractMapping };
    },
    resumeInitialState: async () => {
      calls.push("resumeInitialState");
      return { chains: chains.map(chain => ({ id: chain.id, addressRows: scenario === "addresses" ? AddressRows.emptySeedRows() : AddressRows.seedRowsOf(ChainState.configStorageRows(chain, config.ecosystem.name, config.contractMapping)) })) };
    },
    takeOver: unexpected, initialize: unexpected, reset: unexpected, addChain: unexpected,
    close: async () => {
      writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ schema: Db.publicSchema, closed: true, calls }));
      if (scenario === "close") throw new Error("fixture-private-credential");
    },
  };
};`;
  const preload = `import { registerHooks } from "node:module";
registerHooks({ load(url, context, nextLoad) {
  return url === ${JSON.stringify(nativeUrl("Storage"))}
    ? { format: "module", shortCircuit: true, source: ${JSON.stringify(storage)} }
    : nextLoad(url, context);
}});`;
  for (const [scenario, status, calls] of [
    ["Nothing", 0, ["holding"]],
    ...["Stranded", "Diverged", "Outdated"].map((state) => [
      state,
      78,
      ["holding"],
    ]),
    ["compatible", 0, ["holding", "readStoredConfig", "resumeInitialState"]],
    ["incompatible", 78, ["holding", "readStoredConfig"]],
    ["addresses", 78, ["holding", "readStoredConfig", "resumeInitialState"]],
    ["error", 1, ["holding", "readStoredConfig"]],
    ["close", 1, ["holding", "readStoredConfig", "resumeInitialState"]],
    ["Invalid", 1, ["holding"]],
  ]) {
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
          LOG_LEVEL: "silent",
          ENVIO_API_TOKEN: "fixture-only",
          STORAGE_CASE: scenario,
        },
        encoding: "utf8",
        timeout: 10_000,
      }
    );
    assert.equal(result.status, status, `${scenario}: ${result.stderr}`);
    assert(
      !`${result.stdout}${result.stderr}`.includes("fixture-private-credential")
    );
    assert.deepEqual(
      JSON.parse(readFileSync(trace, "utf8")),
      {
        schema: "launch_schema",
        closed: true,
        calls,
      },
      scenario
    );
  }
});
