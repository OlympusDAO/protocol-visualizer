// Thin local command/log receipt. Native test/scanner output remains the evidence.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
function revision() {
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0)
      throw new Error("Cannot identify validation revision");
    return result.stdout.trimEnd();
  };
  return {
    head: git("rev-parse", "HEAD"),
    dirty: git("status", "--short").split("\n").filter(Boolean),
  };
}

export async function runRecorded(group, command, args) {
  const startedAt = new Date().toISOString();
  const directory = path.join(
    root,
    ".validation",
    `${startedAt.replaceAll(":", "-")}-${group}-${process.pid}`
  );
  mkdirSync(directory, { recursive: true });
  const log = path.join(directory, "output.log");
  const receipt = path.join(directory, "result.json");
  writeFileSync(log, "");
  const result = {
    group,
    command: [command, ...args],
    startedAt,
    ...revision(),
    log,
    exitCode: null,
  };
  const save = () =>
    writeFileSync(receipt, JSON.stringify(result, null, 2) + "\n");
  save();
  console.log(`Validation evidence: ${receipt}`);
  let exitCode = 1;
  let child;
  let receivedSignal;
  const forwardSignal = (signal) => {
    receivedSignal ||= signal;
    if (!child?.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);
  try {
    exitCode = await new Promise((resolve) => {
      child = spawn(command, args, {
        cwd: root,
        env: {
          ...process.env,
          PV_VALIDATION_CHILD: group,
        },
        detached: true,
        stdio: ["inherit", "pipe", "pipe"],
      });
      for (const [source, target] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
      ])
        source.on("data", (chunk) => {
          appendFileSync(log, chunk);
          target.write(chunk);
        });
      child.on("error", (error) => {
        result.error = error.code;
        appendFileSync(log, `Cannot start command: ${error.code}\n`);
      });
      child.once("close", (code, signal) => {
        const status = receivedSignal ? null : code;
        const termination = receivedSignal ?? signal;
        resolve(
          status ??
            (termination ? 128 + (constants.signals[termination] ?? 0) : 1)
        );
      });
    });
  } finally {
    process.off("SIGINT", forwardSignal);
    process.off("SIGTERM", forwardSignal);
    result.exitCode = exitCode;
    result.finishedAt = new Date().toISOString();
    result.finalRevision = revision();
    save();
    console.log(`Validation finished (exit ${exitCode}); evidence: ${receipt}`);
  }
  return exitCode;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [group, command, ...args] = process.argv.slice(2);
  if (!group || !command)
    throw new Error("Expected validation group and command");
  process.exitCode = await runRecorded(group, command, args);
}
