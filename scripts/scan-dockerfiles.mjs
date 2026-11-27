import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(
  "trivy",
  [
    "config",
    "--severity",
    "MEDIUM,HIGH,CRITICAL",
    "--exit-code",
    "1",
    "--skip-dirs",
    "node_modules",
    "--file-patterns",
    "dockerfile:Dockerfile-*",
    ".",
  ],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: "inherit",
  }
);
if (result.error) console.error(`Cannot start Trivy: ${result.error.message}`);
process.exitCode = result.status ?? 1;
