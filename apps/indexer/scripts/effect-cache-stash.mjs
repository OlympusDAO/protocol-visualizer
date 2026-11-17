import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Envio keeps effect results in cache tables inside its schema, and
// `envio local db-migrate setup` drops that schema. Envio's own way to keep the
// cache across a reset (a TSV dump to .envio/cache) shells out to psql, which
// the distroless runtime image does not have, so a reset used to refetch every
// cached contract read on every chain. Moving the tables to a side schema
// before the migration and back before ingestion restarts keeps them: Envio
// lists the cache tables in its schema when it resumes.
export const STASH_SCHEMA = "envio_effect_cache_stash";

// Raised by this script; its messages never contain connection details.
class StashError extends Error {}

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

// The same name pattern and column guard Envio uses to recognise cache tables
// (PgStorage.makeEffectCacheTableNamesQuery), restricted to tables that can be
// moved. Envio names chain-scoped caches `envio_<chainId>_effect_<name>`.
const listCacheTables = async (sql, schema) =>
  (
    await sql.unsafe(
      `SELECT t.table_name AS name
       FROM information_schema.tables t
       WHERE t.table_schema = $1
       AND t.table_type = 'BASE TABLE'
       AND t.table_name ~ '^envio_([0-9]+_)?effect_.+'
       AND (
         SELECT array_agg(c.column_name::text ORDER BY c.column_name::text)
         FROM information_schema.columns c
         WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
       ) = ARRAY['id', 'output']
       ORDER BY t.table_name`,
      [schema]
    )
  ).map((row) => row.name);

// Moves every cache table from one schema to another in one transaction.
// A table that already exists in the target (left behind by an interrupted
// reset) is merged instead, keeping the rows the target already has.
// Stashing creates the side schema; restoring drops it once it is empty.
export async function moveEffectCache(sql, from, to, { stash }) {
  if (from === to)
    throw new StashError("Effect cache source and target are the same schema");
  return sql.begin(async (tx) => {
    const tables = await listCacheTables(tx, from);
    if (stash && tables.length > 0)
      await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS ${quote(to)}`);
    const existing = new Set(await listCacheTables(tx, to));
    for (const table of tables) {
      const source = `${quote(from)}.${quote(table)}`;
      if (existing.has(table)) {
        await tx.unsafe(
          `INSERT INTO ${quote(to)}.${quote(table)} (id, output)
           SELECT id, output FROM ${source} ON CONFLICT DO NOTHING`
        );
        await tx.unsafe(`DROP TABLE ${source}`);
      } else {
        await tx.unsafe(`ALTER TABLE ${source} SET SCHEMA ${quote(to)}`);
      }
    }
    if (!stash) {
      const [{ remaining }] = await tx.unsafe(
        "SELECT count(*)::int AS remaining FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1",
        [from]
      );
      if (remaining === 0)
        await tx.unsafe(`DROP SCHEMA IF EXISTS ${quote(from)}`);
    }
    return tables;
  });
}

const run = async (operation) => {
  if (!["stash", "restore"].includes(operation))
    throw new StashError("Choose stash or restore");
  // Pinned like check-envio-storage.mjs: the table naming and the client come
  // from Envio internals.
  const require = createRequire(import.meta.url);
  const envioRoot = dirname(require.resolve("envio/package.json"));
  const { version } = JSON.parse(
    readFileSync(join(envioRoot, "package.json"), "utf8")
  );
  if (version !== "3.14.1")
    throw new StashError(
      "Review the effect cache stash before upgrading Envio"
    );
  const native = (name) =>
    import(pathToFileURL(join(envioRoot, "src", `${name}.res.mjs`)));
  const [Env, PgStorage] = await Promise.all([
    native("Env"),
    native("PgStorage"),
  ]);
  const schema = Env.Db.publicSchema;
  const sql = PgStorage.makeClient(1);
  try {
    const moved =
      operation === "stash"
        ? await moveEffectCache(sql, schema, STASH_SCHEMA, { stash: true })
        : await moveEffectCache(sql, STASH_SCHEMA, schema, { stash: false });
    console.log(
      operation === "stash"
        ? `Moved ${moved.length} effect cache tables to ${STASH_SCHEMA}.`
        : `Restored ${moved.length} effect cache tables to ${schema}.`
    );
  } finally {
    await sql.end();
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await run(process.argv[2]);
  } catch (error) {
    // Connection errors can carry credentials; report only their code.
    const detail =
      error instanceof StashError
        ? `: ${error.message}`
        : error?.code
          ? ` (${error.code})`
          : "";
    console.error(`Effect cache ${process.argv[2] ?? ""} failed${detail}.`);
    process.exitCode = 1;
  }
}
