import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

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

function bootstrapFixture(t, { installedEnvio = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pv-envio-bootstrap-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "apps/indexer");
  const scripts = join(app, "scripts");
  const envio = join(app, "node_modules/envio");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(dirname(envio));
  const bootstrap = join(scripts, "start-envio.mjs");
  copyFileSync(new URL("./start-envio.mjs", import.meta.url), bootstrap);
  if (installedEnvio) {
    const require = createRequire(import.meta.url);
    symlinkSync(dirname(require.resolve("envio")), envio);
  } else {
    mkdirSync(envio);
    writeFileSync(
      join(envio, "bin.mjs"),
      `
      const result = {
        args: process.argv.slice(2),
        cwd: process.cwd(),
        pid: process.pid,
        port: process.env.ENVIO_INDEXER_PORT,
        database: [process.env.ENVIO_PG_HOST, process.env.ENVIO_PG_PORT,
          process.env.ENVIO_PG_DATABASE, process.env.ENVIO_PG_SSL_MODE],
        rpcMode: process.env.ENVIO_RPC_MODE
      };
      process.stdout.write("fixture:" + JSON.stringify(result) + "\\n");
      if (process.env.ENVIO_TEST_STAY_ALIVE) setInterval(() => {}, 1000);
      process.exitCode = Number(process.env.ENVIO_TEST_EXIT ?? 0);
    `
    );
  }
  return {
    app,
    launch(args, env) {
      const child = spawn(process.execPath, [bootstrap, ...args], {
        cwd: root,
        env: { ...validEnv, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      t.after(() => child.kill());
      let stdout = "",
        stderr = "";
      const outcome = new Promise((done, fail) => {
        child.once("error", fail);
        child.once("close", (code, signal) =>
          done({ code, signal, stdout, stderr })
        );
      });
      const observed = new Promise((done) => {
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
          const match = stdout.match(/^fixture:(.+)\n/m);
          if (match) done(JSON.parse(match[1]));
        });
        child.once("close", () => done(undefined));
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      return { child, outcome, observed };
    },
  };
}

async function hasuraFixture(t) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      secret: request.headers["x-hasura-admin-secret"],
      body: JSON.parse(body),
    });
    response.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((done) => server.close(done)));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/metadata`;
  return { endpoint, requests };
}

test("bootstrap checks Hasura and replaces itself with an ordinary Envio start", {
  timeout: 10_000,
}, async (t) => {
  const { endpoint, requests } = await hasuraFixture(t);
  const { app, launch } = bootstrapFixture(t);
  const run = launch([], {
    RAILWAY_SERVICE_ID: "fixture",
    PORT: "9898",
    DATABASE_URL:
      "postgres://user:password@db.example:5433/main?sslmode=require",
    HASURA_GRAPHQL_ENDPOINT: endpoint,
    ENVIO_TEST_EXIT: "23",
  });
  const result = await run.outcome;
  assert.equal(result.code, 23, result.stderr);
  assert.equal(result.signal, null);
  assert.deepEqual(await run.observed, {
    args: ["start"],
    cwd: app,
    pid: run.child.pid,
    port: "9898",
    database: ["db.example", "5433", "main", "require"],
    rpcMode: "sync",
  });
  assert.deepEqual(requests, [
    {
      method: "POST",
      secret: validEnv.HASURA_GRAPHQL_ADMIN_SECRET,
      body: { type: "export_metadata", args: {} },
    },
  ]);
});

test("bootstrap forwards explicit local arguments and preserves native signals", {
  timeout: 10_000,
}, async (t) => {
  const { launch } = bootstrapFixture(t);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const run = launch(["dev", "-r"], {
      DATABASE_URL: undefined,
      HASURA_GRAPHQL_ENDPOINT: undefined,
      HASURA_GRAPHQL_ADMIN_SECRET: undefined,
      ENVIO_TEST_STAY_ALIVE: "1",
    });
    const ready = await run.observed;
    assert.deepEqual(ready?.args, ["dev", "-r"]);
    assert.equal(ready.pid, run.child.pid);
    assert(run.child.kill(signal));
    const result = await run.outcome;
    assert.equal(result.code, null);
    assert.equal(result.signal, signal);
  }
});

test("invalid managed configuration exits before Hasura or Envio and logs variable names", {
  timeout: 10_000,
}, async (t) => {
  const { endpoint, requests } = await hasuraFixture(t);
  const { launch } = bootstrapFixture(t);
  const cases = [
    [{ ETHERSCAN_API_KEY: undefined }, /ETHERSCAN_API_KEY/],
    [{ DATABASE_URL: "fixture-private-invalid" }, /DATABASE_URL/],
    [{ ENVIO_RPC_URL_1: "fixture-private-invalid" }, /ENVIO_RPC_URL_1/],
    [
      { RAILWAY_SERVICE_ID: "fixture", ENVIO_PG_SCHEMA: "public" },
      /ENVIO_PG_SCHEMA/,
    ],
    [{ RAILWAY_SERVICE_ID: "fixture" }, /PORT must be set/],
    [
      { PORT: "9898", ENVIO_INDEXER_PORT: "9899" },
      /ENVIO_INDEXER_PORT must match/,
    ],
    [{ PORT: "fixture-private-invalid" }, /PORT must be a valid TCP port/],
    [{ ENVIO_RPC_MODE: "fixture-private-invalid" }, /ENVIO_RPC_MODE/],
    [
      { ENVIO_HASURA_STARTUP_TIMEOUT_MS: "fixture-private-invalid" },
      /ENVIO_HASURA_STARTUP_TIMEOUT_MS/,
    ],
  ];
  for (const [env, diagnostic] of cases) {
    const run = launch([], { HASURA_GRAPHQL_ENDPOINT: endpoint, ...env });
    const result = await run.outcome;
    assert.equal(result.code, 1);
    assert.match(result.stderr, diagnostic);
    assert.doesNotMatch(result.stderr, /fixture-private-invalid/);
    assert.equal(await run.observed, undefined);
  }
  assert.deepEqual(requests, []);
});

test("bootstrap executes the installed native Envio CLI", {
  timeout: 10_000,
}, async (t) => {
  const { launch } = bootstrapFixture(t, { installedEnvio: true });
  const { code, stdout, stderr } = await launch(["--version"]).outcome;
  assert.equal(code, 0, stderr);
  // The test loader rewrites local JSON modules. Read the manifest as JSON data.
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  );
  assert(stdout.split("\n").includes(`envio ${manifest.dependencies.envio}`));
});
