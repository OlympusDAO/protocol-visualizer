import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const RPC_MODES = new Set(["sync", "fallback"]);
const DEFAULT_HASURA_STARTUP_TIMEOUT_MS = 180_000;
const HASURA_STARTUP_RETRY_INTERVAL_MS = 2_000;
const HASURA_STARTUP_REQUEST_TIMEOUT_MS = 5_000;

const loadDotEnv = () => {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
};

loadDotEnv();

const setDefaultEnv = (key, value) => {
  if (process.env[key] === undefined || process.env[key] === "") {
    process.env[key] = value;
  }
};

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl && !process.env.ENVIO_PG_HOST) {
  const parsed = new URL(databaseUrl);
  const sslMode = parsed.searchParams.get("sslmode");

  process.env.ENVIO_PG_HOST = parsed.hostname;
  process.env.ENVIO_PG_PORT = parsed.port || "5432";
  process.env.ENVIO_PG_USER = decodeURIComponent(parsed.username);
  process.env.ENVIO_PG_PASSWORD = decodeURIComponent(parsed.password);
  process.env.ENVIO_PG_DATABASE = parsed.pathname.replace(/^\//, "");

  if (sslMode && !process.env.ENVIO_PG_SSL_MODE) {
    process.env.ENVIO_PG_SSL_MODE = sslMode;
  }
}

setDefaultEnv("ENVIO_PG_SSL_MODE", "prefer");
setDefaultEnv("HASURA_GRAPHQL_ROLE", "admin");
setDefaultEnv("ENVIO_THROTTLE_CHAIN_METADATA_INTERVAL_MILLIS", "500");
setDefaultEnv("ENVIO_THROTTLE_PRUNE_STALE_DATA_INTERVAL_MILLIS", "30000");

if (process.env.RAILWAY_DEPLOYMENT_ID && !process.env.ENVIO_PG_SCHEMA) {
  process.env.ENVIO_PG_SCHEMA = process.env.RAILWAY_DEPLOYMENT_ID.replace(
    /[^a-zA-Z0-9_]/g,
    "_"
  );
}

if (process.env.PORT && !process.env.ENVIO_INDEXER_PORT) {
  process.env.ENVIO_INDEXER_PORT = process.env.PORT;
}

if (!process.env.ENVIO_RPC_MODE) {
  process.env.ENVIO_RPC_MODE = process.env.ENVIO_API_TOKEN?.trim()
    ? "fallback"
    : "sync";
}

if (!RPC_MODES.has(process.env.ENVIO_RPC_MODE)) {
  throw new Error(
    `ENVIO_RPC_MODE must be one of ${Array.from(RPC_MODES).join(", ")}; received ${JSON.stringify(
      process.env.ENVIO_RPC_MODE
    )}`
  );
}

console.log(`Using ENVIO_RPC_MODE=${process.env.ENVIO_RPC_MODE}`);

const envioArgs = process.argv.slice(2);
if (envioArgs.length === 0) {
  envioArgs.push("start");
}

const sleep = (durationMs) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, durationMs));

const getPositiveIntegerEnv = (key, defaultValue) => {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer; received ${value}`);
  }

  return parsed;
};

const isIndexerCommand = () => {
  const [command] = envioArgs;
  return command === "start" || command === "dev";
};

const waitForHasura = async () => {
  const endpoint = process.env.HASURA_GRAPHQL_ENDPOINT;
  const secret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

  if (!isIndexerCommand() || !endpoint || !secret) {
    return;
  }

  const timeoutMs = getPositiveIntegerEnv(
    "ENVIO_HASURA_STARTUP_TIMEOUT_MS",
    DEFAULT_HASURA_STARTUP_TIMEOUT_MS
  );
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";

  console.log(`Waiting for Hasura metadata endpoint at ${endpoint}`);

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      HASURA_STARTUP_REQUEST_TIMEOUT_MS
    );

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hasura-admin-secret": secret,
        },
        body: JSON.stringify({ type: "export_metadata", args: {} }),
        signal: controller.signal,
      });

      if (response.ok) {
        console.log("Hasura metadata endpoint is reachable");
        return;
      }

      const responseText = await response.text();
      lastError = `HTTP ${response.status}: ${responseText.slice(0, 200)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
    }

    await sleep(HASURA_STARTUP_RETRY_INTERVAL_MS);
  }

  throw new Error(
    `Hasura metadata endpoint did not become reachable within ${timeoutMs}ms: ${lastError}`
  );
};

await waitForHasura();

const child = spawn("./node_modules/.bin/envio", envioArgs, {
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Failed to start Envio: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
