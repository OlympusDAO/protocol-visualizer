import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const RPC_MODES = new Set(["sync", "fallback"]);
const RPC_URLS = [1, 10, 42161, 421614, 84532, 4663, 8453, 80094, 11155111].map(
  (chainId) => `ENVIO_RPC_URL_${chainId}`
);
const DEFAULT_HASURA_STARTUP_TIMEOUT_MS = 180_000;
const HASURA_STARTUP_RETRY_INTERVAL_MS = 2_000;
const HASURA_STARTUP_REQUEST_TIMEOUT_MS = 5_000;
const indexerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(indexerDir, "../..");

function loadDotEnv() {
  const shellEnvKeys = new Set(Object.keys(process.env));
  const envPaths = new Set([
    resolve(repoRoot, ".env"),
    resolve(indexerDir, ".env"),
    resolve(process.cwd(), ".env"),
  ]);
  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      if (!key || shellEnvKeys.has(key)) continue;
      let value = line.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (!url.hostname || !["postgres:", "postgresql:"].includes(url.protocol))
      throw new Error("Expected a PostgreSQL URL with a hostname");
    return {
      host: url.hostname,
      port: url.port || "5432",
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
      sslMode: url.searchParams.get("sslmode"),
    };
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
}

const isBlank = (value) => value === undefined || value.trim() === "";

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validateIndexerEnv(managed) {
  const env = process.env;
  const urls = managed ? ["HASURA_GRAPHQL_ENDPOINT", ...RPC_URLS] : RPC_URLS;
  const required = ["ETHERSCAN_API_KEY", ...urls];
  if (managed) required.unshift("DATABASE_URL", "HASURA_GRAPHQL_ADMIN_SECRET");
  const missing = required.filter((name) => isBlank(env[name]));
  if (missing.length)
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  const invalid = urls.filter((name) => !isHttpUrl(env[name]));
  if (invalid.length)
    throw new Error(`Invalid URL environment variables: ${invalid.join(", ")}`);

  const onRailway = Object.entries(env).some(
    ([key, value]) => key.startsWith("RAILWAY_") && value?.trim()
  );
  if (onRailway && !isBlank(env.ENVIO_PG_SCHEMA))
    throw new Error("ENVIO_PG_SCHEMA must not be set on Railway");
  if (onRailway && isBlank(env.PORT))
    throw new Error("PORT must be set when running on Railway");
  for (const key of ["PORT", "ENVIO_INDEXER_PORT"]) {
    const port = Number(env[key]);
    if (
      !isBlank(env[key]) &&
      (!Number.isInteger(port) || port < 1 || port > 65535)
    )
      throw new Error(`${key} must be a valid TCP port`);
  }
  if (env.PORT && env.ENVIO_INDEXER_PORT && env.PORT !== env.ENVIO_INDEXER_PORT)
    throw new Error("ENVIO_INDEXER_PORT must match PORT when PORT is set");
}

function prepareIndexerEnv() {
  const env = process.env;
  if (env.DATABASE_URL) {
    const database = parseDatabaseUrl(env.DATABASE_URL);
    if (!env.ENVIO_PG_HOST) {
      env.ENVIO_PG_HOST = database.host;
      env.ENVIO_PG_PORT = database.port;
      env.ENVIO_PG_USER = database.user;
      env.ENVIO_PG_PASSWORD = database.password;
      env.ENVIO_PG_DATABASE = database.database;
      if (!env.ENVIO_PG_SSL_MODE && database.sslMode)
        env.ENVIO_PG_SSL_MODE = database.sslMode;
    }
  }
  env.ENVIO_PG_SSL_MODE ||= "prefer";
  env.HASURA_GRAPHQL_ROLE ||= "admin";
  env.ENVIO_THROTTLE_CHAIN_METADATA_INTERVAL_MILLIS ||= "500";
  env.ENVIO_THROTTLE_PRUNE_STALE_DATA_INTERVAL_MILLIS ||= "30000";
  if (!env.ENVIO_INDEXER_PORT && env.PORT) env.ENVIO_INDEXER_PORT = env.PORT;

  env.ENVIO_RPC_MODE ||= env.ENVIO_API_TOKEN?.trim() ? "fallback" : "sync";
  if (!RPC_MODES.has(env.ENVIO_RPC_MODE))
    throw new Error("ENVIO_RPC_MODE must be sync or fallback");
  console.log(`Using ENVIO_RPC_MODE=${env.ENVIO_RPC_MODE}`);
}

async function waitForHasura() {
  const { HASURA_GRAPHQL_ENDPOINT, HASURA_GRAPHQL_ADMIN_SECRET } = process.env;
  const timeoutMs = Number(
    process.env.ENVIO_HASURA_STARTUP_TIMEOUT_MS ||
      DEFAULT_HASURA_STARTUP_TIMEOUT_MS
  );
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error(
      "ENVIO_HASURA_STARTUP_TIMEOUT_MS must be a positive integer"
    );
  const deadline = Date.now() + timeoutMs;
  let lastLogAt = 0;
  let lastError = "request not attempted";
  console.log("Waiting for Hasura metadata endpoint");

  while (Date.now() < deadline) {
    try {
      const response = await fetch(HASURA_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hasura-admin-secret": HASURA_GRAPHQL_ADMIN_SECRET,
        },
        body: JSON.stringify({ type: "export_metadata", args: {} }),
        signal: AbortSignal.timeout(HASURA_STARTUP_REQUEST_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (response.ok) {
        console.log("Hasura metadata endpoint is reachable");
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch {
      lastError = "request failed";
    }
    const now = Date.now();
    if (now - lastLogAt >= 10_000) {
      console.log(`Still waiting for Hasura metadata endpoint: ${lastError}`);
      lastLogAt = now;
    }
    await sleep(HASURA_STARTUP_RETRY_INTERVAL_MS);
  }
  throw new Error(
    `Hasura metadata endpoint did not become reachable: ${lastError}`
  );
}

try {
  loadDotEnv();
  const args = process.argv.length === 2 ? ["start"] : process.argv.slice(2);
  const managed = args[0] === "start";
  validateIndexerEnv(managed);
  prepareIndexerEnv();
  if (managed) await waitForHasura();

  process.chdir(indexerDir);
  process.execve(
    process.execPath,
    [
      process.execPath,
      resolve(indexerDir, "node_modules/envio/bin.mjs"),
      ...args,
    ],
    process.env
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
