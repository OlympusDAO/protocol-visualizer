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
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      await pause(200);
      unlinkSync(workerRunning);
      process.exit(0);
    });
  writeFileSync(workerRunning, String(process.pid));
  setInterval(() => {}, 1000);
} else if (process.argv[2] === "start") {
  if (process.env.RESET_FIXTURE_START_COMPLETE === "1") process.exit(0);
  if (
    Number(process.env.RESET_FIXTURE_START_CODE) &&
    !existsSync(join(root, "migrated"))
  )
    process.exit(Number(process.env.RESET_FIXTURE_START_CODE));
  writeFileSync(running, String(process.pid));
  const worker = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "worker"],
    { stdio: "ignore", shell: false }
  );
  if (
    process.env.RESET_FIXTURE_START_SIGNAL &&
    !existsSync(join(root, "migrated"))
  ) {
    while (!existsSync(workerRunning)) await pause(25);
    unlinkSync(running);
    process.kill(process.pid, process.env.RESET_FIXTURE_START_SIGNAL);
  }
  let stopping = false;
  worker.once("exit", () => {
    if (stopping) process.exit(0);
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      stopping = true;
      unlinkSync(running);
      if (worker.exitCode !== null) process.exit(0);
      worker.kill(signal);
    });
  setInterval(() => {}, 1000);
} else {
  assert(
    !existsSync(running) && !existsSync(workerRunning),
    "Migration started before ingestion stopped"
  );
  const migrationRunning = join(root, "migration-running");
  writeFileSync(migrationRunning, String(process.pid));
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      await pause(200);
      unlinkSync(migrationRunning);
      writeFileSync(join(root, "migration-stopped"), signal);
      process.exit(0);
    });
  appendFileSync(
    join(root, "migrated"),
    `${process.argv.slice(2).join(" ")}\n`
  );
  while (existsSync(join(root, "migration-blocked"))) await pause(25);
  unlinkSync(migrationRunning);
  process.exit(Number(process.env.RESET_FIXTURE_MIGRATION_CODE));
}
