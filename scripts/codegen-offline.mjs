// Code generation reads local config/schema/ABIs; RPC URLs are interpolation fixtures only.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = readFileSync(
  new URL("../apps/indexer/config.yaml", import.meta.url),
  "utf8"
);
const env = {
  ...process.env,
  ENVIO_API_TOKEN: "fixture",
  ENVIO_RPC_MODE: "fallback",
};
for (const [key] of config.matchAll(/ENVIO_RPC_URL_\d+/g))
  env[key] = "http://127.0.0.1:1";
const result = spawnSync("pnpm", ["--filter", "indexer", "run", "codegen"], {
  cwd: root,
  env,
  stdio: "inherit",
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
