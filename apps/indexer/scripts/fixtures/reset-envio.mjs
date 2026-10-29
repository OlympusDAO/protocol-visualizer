import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = process.env.RESET_FIXTURE_ROOT;
assert(root, "Missing reset fixture root");
const running = join(root, "running");
const workerRunning = join(root, "worker-running");

if (process.argv[2] === "worker") {
  writeFileSync(workerRunning, String(process.pid));
  process.on("SIGTERM", () => {
    unlinkSync(workerRunning);
    process.exit(0);
  });
  setInterval(() => {}, 1000);
} else if (process.argv[2] === "start") {
  writeFileSync(running, String(process.pid));
  const worker = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "worker"],
    { stdio: "ignore", shell: false }
  );
  let stopping = false;
  worker.once("exit", () => {
    if (stopping) process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopping = true;
    unlinkSync(running);
    if (worker.exitCode !== null) process.exit(0);
    worker.kill("SIGTERM");
  });
  setInterval(() => {}, 1000);
} else {
  assert(
    !existsSync(running) && !existsSync(workerRunning),
    "Migration started before ingestion stopped"
  );
  appendFileSync(
    join(root, "migrated"),
    `${process.argv.slice(2).join(" ")}\n`
  );
  while (existsSync(join(root, "migration-blocked"))) await pause(25);
  process.exit(Number(process.env.RESET_FIXTURE_MIGRATION_CODE));
}
