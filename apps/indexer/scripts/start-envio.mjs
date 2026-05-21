import { spawn } from "node:child_process";

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

if (process.env.RAILWAY_DEPLOYMENT_ID && !process.env.ENVIO_PG_SCHEMA) {
  process.env.ENVIO_PG_SCHEMA = process.env.RAILWAY_DEPLOYMENT_ID.replace(
    /[^a-zA-Z0-9_]/g,
    "_"
  );
}

if (process.env.PORT && !process.env.ENVIO_INDEXER_PORT) {
  process.env.ENVIO_INDEXER_PORT = process.env.PORT;
}

const child = spawn("./node_modules/.bin/envio", ["start"], {
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
