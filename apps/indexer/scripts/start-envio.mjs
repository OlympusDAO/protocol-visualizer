import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RPC_MODES = new Set(["sync", "fallback"]);
const DEFAULT_HASURA_STARTUP_TIMEOUT_MS = 180_000;
const HASURA_STARTUP_RETRY_INTERVAL_MS = 2_000;
const HASURA_STARTUP_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_INDEXER_INTERNAL_PORT_OFFSET = 1;
const HEALTHCHECK_REQUEST_TIMEOUT_MS = 5_000;

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

export const isRailwayRuntime = (env = process.env) =>
  Object.entries(env).some(
    ([key, value]) => key.startsWith("RAILWAY_") && value?.trim()
  );

export const hasResetFlag = (args) =>
  args.includes("-r") || args.includes("--reset");

export const resolveEnvioArgs = (args, env = process.env) => {
  const resolvedArgs = args.length === 0 ? ["start"] : [...args];
  if (
    isRailwayRuntime(env) &&
    resolvedArgs[0] === "start" &&
    !hasResetFlag(resolvedArgs)
  ) {
    resolvedArgs.push("-r");
  }
  return resolvedArgs;
};

const envioArgs = resolveEnvioArgs(process.argv.slice(2));

export const resolveEnvioCommand = (cwd = process.cwd()) => {
  const envioBinPath = resolve(cwd, "node_modules/envio/bin.mjs");
  return {
    command: process.execPath,
    args: [envioBinPath, ...envioArgs],
  };
};

const isStartCommand = () => {
  const [command] = envioArgs;
  return command === "start";
};

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

const getBooleanEnv = (key, defaultValue) => {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw new Error(`${key} must be true, false, 1, or 0; received ${value}`);
};

const sleep = (durationMs) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, durationMs));

const isBlank = (value) => value === undefined || value.trim() === "";

const isUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const prepareIndexerEnv = (env = process.env) => {
  if (env.PORT && !env.ENVIO_INDEXER_PORT) {
    env.ENVIO_INDEXER_PORT = env.PORT;
  }
  return env;
};

export const validateIndexerEnv = (env = process.env) => {
  const required = [
    "DATABASE_URL",
    "HASURA_GRAPHQL_ENDPOINT",
    "HASURA_GRAPHQL_ADMIN_SECRET",
    "ENVIO_RPC_URL_1",
    "ENVIO_RPC_URL_10",
    "ENVIO_RPC_URL_8453",
    "ENVIO_RPC_URL_80094",
    "ENVIO_RPC_URL_11155111",
  ];
  const missing = required.filter((key) => isBlank(env[key]));
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const urlVars = [
    "HASURA_GRAPHQL_ENDPOINT",
    "ENVIO_RPC_URL_1",
    "ENVIO_RPC_URL_10",
    "ENVIO_RPC_URL_8453",
    "ENVIO_RPC_URL_80094",
    "ENVIO_RPC_URL_11155111",
  ];
  const invalidUrls = urlVars.filter((key) => !isUrl(env[key] ?? ""));
  if (invalidUrls.length > 0) {
    throw new Error(`Invalid URL environment variables: ${invalidUrls.join(", ")}`);
  }

  if (isRailwayRuntime(env) && !isBlank(env.ENVIO_PG_SCHEMA)) {
    throw new Error("ENVIO_PG_SCHEMA must not be set on Railway");
  }
  if (isRailwayRuntime(env) && isBlank(env.PORT)) {
    throw new Error("PORT must be set when running on Railway");
  }
  if (
    !isBlank(env.PORT) &&
    !isBlank(env.ENVIO_INDEXER_PORT) &&
    env.PORT !== env.ENVIO_INDEXER_PORT
  ) {
    throw new Error("ENVIO_INDEXER_PORT must match PORT when PORT is set");
  }
};

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

const shouldUseHealthcheckWrapper = () =>
  isStartCommand() &&
  Boolean(process.env.PORT) &&
  getBooleanEnv("ENVIO_HEALTHCHECK_WRAPPER_ENABLED", true);

const useHealthcheckWrapper = shouldUseHealthcheckWrapper();

prepareIndexerEnv(process.env);
validateIndexerEnv(process.env);

if (useHealthcheckWrapper) {
  const externalPort = getPositiveIntegerEnv("PORT", 9898);
  const internalPort =
    process.env.ENVIO_INDEXER_PORT === process.env.PORT
      ? getPositiveIntegerEnv(
          "ENVIO_INDEXER_INTERNAL_PORT",
          externalPort + DEFAULT_INDEXER_INTERNAL_PORT_OFFSET
        )
      : getPositiveIntegerEnv("ENVIO_INDEXER_PORT", 9899);

  process.env.ENVIO_INDEXER_PORT = String(internalPort);
  process.env.ENVIO_HEALTHCHECK_WRAPPER_PORT = String(externalPort);

  console.log(
    `Using healthcheck wrapper on port ${externalPort}; Envio indexer will listen on port ${internalPort}`
  );
}

const waitForHasura = async () => {
  const endpoint = process.env.HASURA_GRAPHQL_ENDPOINT;
  const secret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

  if (!isStartCommand() || !endpoint || !secret) {
    return;
  }

  const timeoutMs = getPositiveIntegerEnv(
    "ENVIO_HASURA_STARTUP_TIMEOUT_MS",
    DEFAULT_HASURA_STARTUP_TIMEOUT_MS
  );
  const deadline = Date.now() + timeoutMs;
  let lastLogAt = 0;
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

    const now = Date.now();
    if (now - lastLogAt >= 10_000) {
      console.log(`Still waiting for Hasura metadata endpoint: ${lastError}`);
      lastLogAt = now;
    }

    await sleep(HASURA_STARTUP_RETRY_INTERVAL_MS);
  }

  throw new Error(
    `Hasura metadata endpoint did not become reachable within ${timeoutMs}ms: ${lastError}`
  );
};

const readReadyStatusFromMetrics = (metrics) => {
  const syncedToHead = metrics.match(
    /^hyperindex_synced_to_head\s+([0-9.]+)$/m
  );
  if (syncedToHead) {
    const value = Number(syncedToHead[1]);
    return {
      ready: value === 1,
      reason:
        value === 1
          ? "hyperindex_synced_to_head is 1"
          : "hyperindex_synced_to_head is not 1",
    };
  }

  const chainReadiness = [
    ...metrics.matchAll(
      /^envio_progress_ready\{[^}]*chainId="([^"]+)"[^}]*\}\s+([0-9.]+)$/gm
    ),
  ].map((match) => ({
    chainId: match[1],
    ready: Number(match[2]) === 1,
  }));

  if (chainReadiness.length === 0) {
    return {
      ready: false,
      reason: "readiness metrics are not available yet",
    };
  }

  const waitingChains = chainReadiness
    .filter((chain) => !chain.ready)
    .map((chain) => chain.chainId);

  return {
    ready: waitingChains.length === 0,
    reason:
      waitingChains.length === 0
        ? "all envio_progress_ready metrics are 1"
        : `waiting for chains: ${waitingChains.join(", ")}`,
  };
};

const fetchIndexerMetrics = async (internalPort) => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    HEALTHCHECK_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(`http://127.0.0.1:${internalPort}/metrics`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        metrics: "",
        error: `metrics endpoint returned HTTP ${response.status}`,
      };
    }

    return { metrics: await response.text(), error: "" };
  } catch (error) {
    return {
      metrics: "",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const proxyToIndexer = (request, response, internalPort) => {
  const proxyRequest = http.request(
    {
      hostname: "127.0.0.1",
      port: internalPort,
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (proxyResponse) => {
      response.writeHead(
        proxyResponse.statusCode ?? 502,
        proxyResponse.headers
      );
      proxyResponse.pipe(response);
    }
  );

  proxyRequest.on("error", (error) => {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ready: false,
        reason: `indexer proxy failed: ${error.message}`,
      })
    );
  });

  request.pipe(proxyRequest);
};

const startHealthcheckWrapper = () => {
  if (!useHealthcheckWrapper) {
    return undefined;
  }

  const externalPort = getPositiveIntegerEnv("ENVIO_HEALTHCHECK_WRAPPER_PORT");
  const internalPort = getPositiveIntegerEnv("ENVIO_INDEXER_PORT");

  const server = http.createServer(async (request, response) => {
    const pathname = request.url?.split("?")[0];
    if (pathname === "/healthz") {
      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname !== "/ready") {
      proxyToIndexer(request, response, internalPort);
      return;
    }

    const { metrics, error } = await fetchIndexerMetrics(internalPort);
    const status = error
      ? { ready: false, reason: error }
      : readReadyStatusFromMetrics(metrics);

    response.writeHead(status.ready ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(status));
  });

  server.listen(externalPort, "::", () => {
    console.log(`Healthcheck wrapper listening on port ${externalPort}`);
  });

  server.on("error", (error) => {
    console.error(`Healthcheck wrapper failed: ${error.message}`);
    process.exit(1);
  });

  return server;
};

export const formatEnvioSpawnError = (error) => {
  if (error?.code === "ENOENT") {
    return `Failed to start Envio: node or the Envio entrypoint was not found (${error.message})`;
  }
  return `Failed to start Envio: ${error.message}`;
};

export const run = async () => {
  await waitForHasura();

  const wrapperServer = startHealthcheckWrapper();
  const envioCommand = resolveEnvioCommand();

  const child = spawn(envioCommand.command, envioCommand.args, {
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(formatEnvioSpawnError(error));
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    wrapperServer?.close();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await run();
}
