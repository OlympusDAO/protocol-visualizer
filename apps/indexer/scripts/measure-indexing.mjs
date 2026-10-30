import { createRequire } from "node:module";
import { setTimeout as pause } from "node:timers/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "duration-seconds": { type: "string", default: "900" },
    "interval-seconds": { type: "string", default: "60" },
  },
});
const duration = Number(values["duration-seconds"]);
const interval = Number(values["interval-seconds"]);
if (![duration, interval].every((value) => Number.isFinite(value) && value > 0))
  throw new Error("Measurement duration and interval must be positive seconds");

const publicUrl = process.env.DATABASE_PUBLIC_URL;
const url = publicUrl || process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "Set DATABASE_PUBLIC_URL or DATABASE_URL for the indexer database"
  );
const require = createRequire(import.meta.url);
const postgres = createRequire(require.resolve("envio"))("postgres");
const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 2,
  ...(publicUrl ? { ssl: "require" } : {}),
  connection: { default_transaction_read_only: "on" },
});
const environment = process.env.RAILWAY_ENVIRONMENT_NAME ?? "local";
const started = performance.now();
let first;
let last;
let failed = false;
try {
  const schemas =
    await sql`SELECT table_schema FROM information_schema.views WHERE table_name='_meta' ORDER BY table_schema`;
  if (!schemas.length) throw new Error("Indexer metadata view is unavailable");
  while (true) {
    const chains = [];
    for (const { table_schema: schema } of schemas) {
      const rows =
        await sql`SELECT "chainId" AS chain_id, "startBlock" AS start_block, "progressBlock" AS processed_block, "bufferBlock" AS fetched_block, "sourceBlock" AS source_head, "eventsProcessed" AS processed_items, "isReady" AS ready FROM ${sql(schema)}._meta ORDER BY "chainId"`;
      chains.push(...rows.map((row) => ({ schema, ...row })));
    }
    last = {
      at: new Date().toISOString(),
      elapsed_seconds: (performance.now() - started) / 1000,
      environment,
      chains,
    };
    first ??= last;
    console.log(JSON.stringify({ type: "sample", ...last }));
    const remaining = duration - (last.elapsed_seconds - first.elapsed_seconds);
    if (remaining <= 0) break;
    await pause(Math.min(interval, remaining) * 1000);
  }
} catch {
  // Database error messages can contain connection credentials or host names.
  console.error(
    "Indexing measurement failed; check database access and the _meta view"
  );
  failed = true;
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
if (!failed && first && last) {
  const elapsed = last.elapsed_seconds - first.elapsed_seconds;
  console.log(
    JSON.stringify({
      type: "summary",
      environment,
      started_at: first.at,
      ended_at: last.at,
      elapsed_seconds: elapsed,
      chains: last.chains.map((chain) => {
        const before = first.chains.find(
          (row) =>
            row.schema === chain.schema && row.chain_id === chain.chain_id
        );
        const blocks = chain.processed_block - before.processed_block;
        const items = chain.processed_items - before.processed_items;
        return {
          schema: chain.schema,
          chain_id: chain.chain_id,
          start_block: before.processed_block,
          end_block: chain.processed_block,
          blocks,
          blocks_per_second: blocks / elapsed,
          processed_items: items,
          ready: chain.ready,
        };
      }),
    })
  );
}
