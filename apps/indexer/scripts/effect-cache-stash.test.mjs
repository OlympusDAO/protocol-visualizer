import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const envio = pathToFileURL(require.resolve("envio"));
const native = (name) => import(new URL(`./src/${name}.res.mjs`, envio));
const indexerDir = fileURLToPath(new URL("../", import.meta.url));
const STASH = "envio_effect_cache_stash";
// Cross-chain and chain-scoped tables, named the way Envio names them.
const caches = [
  ["readCode", "crossChain"],
  ["readState", 1],
  ["readState", 10],
];

function localDatabaseUrl() {
  const url = new URL(process.env.PV_CACHE_POSTGRES_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.equal(url.search, "", "connection options must not override the host");
  return url;
}

function databaseEnv(url) {
  const env = {
    ...process.env,
    ENVIO_API_TOKEN: "fixture",
    ENVIO_HASURA: "false",
    ENVIO_PG_HOST: url.hostname,
    ENVIO_PG_PORT: url.port || "5432",
    ENVIO_PG_USER: decodeURIComponent(url.username),
    ENVIO_PG_PASSWORD: decodeURIComponent(url.password),
    ENVIO_PG_DATABASE: url.pathname.slice(1),
    ENVIO_PG_SSL_MODE: "false",
    LOG_LEVEL: "warn",
  };
  for (const id of [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532])
    env[`ENVIO_RPC_URL_${id}`] = "http://127.0.0.1:1";
  return env;
}

// Stages run in their own process: Envio reads its environment on import.
async function runStage(stage) {
  const [PgStorage, Internal, Config, Persistence] = await Promise.all(
    ["PgStorage", "Internal", "Config", "Persistence"].map(native)
  );
  const sql = PgStorage.makeClient(1);
  try {
    if (stage === "seed") {
      // An interrupted earlier reset left part of one cache in the stash.
      await sql.unsafe(`CREATE SCHEMA "${STASH}"`);
      for (const [name, scope] of caches) {
        const table = Internal.makeCacheTable(name, scope);
        const ids = [...Array(50).keys()].map((i) => `k${i}`);
        await sql.unsafe(
          PgStorage.makeCreateTableQuery(
            table,
            "public",
            false,
            undefined,
            undefined
          )
        );
        for (const id of ids)
          await sql.unsafe(
            `INSERT INTO public."${table.tableName}" (id, output) VALUES ($1, $2)`,
            [id, JSON.stringify({ id })]
          );
        if (scope === "crossChain") {
          await sql.unsafe(
            PgStorage.makeCreateTableQuery(
              table,
              STASH,
              false,
              undefined,
              undefined
            )
          );
          for (let i = 40; i < 60; i++)
            await sql.unsafe(
              `INSERT INTO "${STASH}"."${table.tableName}" (id, output) VALUES ($1, $2)`,
              [`k${i}`, JSON.stringify({ id: `k${i}` })]
            );
        }
      }
    } else if (stage === "check") {
      const config = Config.load();
      const persistence = PgStorage.makePersistenceFromConfig(
        config,
        undefined
      );
      try {
        await Persistence.initForRun(persistence, config, false, false);
        const counts = Object.fromEntries(
          Object.values(Persistence.getInitializedState(persistence).cache).map(
            ({ tableName, count }) => [tableName, count]
          )
        );
        assert.deepEqual(counts, {
          envio_effect_readCode: 60,
          envio_1_effect_readState: 50,
          envio_10_effect_readState: 50,
        });
        const [{ stashes }] = await sql.unsafe(
          "SELECT count(*)::int AS stashes FROM pg_namespace WHERE nspname = $1",
          [STASH]
        );
        assert.equal(stashes, 0, "an emptied stash schema is dropped");
      } finally {
        await persistence.storage.close();
      }
    } else {
      throw new Error(`Unknown stage ${stage}`);
    }
  } finally {
    await sql.end();
  }
}

const stage = process.argv.find((argument) => argument.startsWith("--stage="));
if (stage) {
  await runStage(stage.slice("--stage=".length));
} else {
  test("an explicit reset keeps the effect cache across Envio's schema migration", {
    skip:
      !process.env.PV_CACHE_POSTGRES_URL &&
      process.env.PV_REQUIRE_POSTGRES !== "1",
  }, async () => {
    assert.ok(
      process.env.PV_CACHE_POSTGRES_URL,
      "PV_CACHE_POSTGRES_URL is required when PV_REQUIRE_POSTGRES=1"
    );
    const url = localDatabaseUrl();
    const Postgres = require(
      require.resolve("postgres", { paths: [require.resolve("envio")] })
    );
    const admin = Postgres(url.toString(), { max: 1, connect_timeout: 5 });
    const database = `pv_effect_stash_${randomUUID().replaceAll("-", "")}`;
    let created = false;
    try {
      await admin.unsafe(`CREATE DATABASE "${database}"`);
      created = true;
      url.pathname = `/${database}`;
      const env = databaseEnv(url);
      const node = (args) => {
        const child = spawnSync(process.execPath, args, {
          cwd: indexerDir,
          env,
          encoding: "utf8",
          timeout: 60_000,
        });
        assert.equal(child.status, 0, `${args.join(" ")}: ${child.stderr}`);
        return child.stdout;
      };
      const envioBin = join(
        dirname(require.resolve("envio/package.json")),
        "bin.mjs"
      );
      const migrate = () => node([envioBin, "local", "db-migrate", "setup"]);
      const stageRun = (name) =>
        node([fileURLToPath(import.meta.url), `--stage=${name}`]);
      const stashScript = fileURLToPath(
        new URL("./effect-cache-stash.mjs", import.meta.url)
      );

      // The same sequence as the reset control socket.
      migrate();
      stageRun("seed");
      assert.match(node([stashScript, "stash"]), /Moved 3 effect cache tables/);
      migrate();
      assert.match(
        node([stashScript, "restore"]),
        /Restored 3 effect cache tables/
      );
      stageRun("check");
    } finally {
      try {
        if (created)
          await admin.unsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  });
}
