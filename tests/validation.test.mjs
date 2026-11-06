import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("validation checks the existing OpenAPI artifact before the full build and stops on drift", () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-validation-"));
  const trace = join(directory, "trace");
  writeFileSync(
    join(directory, "pnpm"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$VALIDATION_TRACE"
if [ "$*" = 'run openapi:check' ] && [ "$VALIDATION_STALE" = 1 ]; then
  echo 'OpenAPI fixture is stale' >&2
  exit 23
fi
`,
    { mode: 0o755 }
  );
  const commands = [
    "run check:runtime-versions",
    "install --frozen-lockfile",
    "run lint:check",
    "--filter @protocol-visualizer/snapshot-artifacts run build",
    "run openapi:check",
    "run build",
    "run snapshots:generate:local",
    "run container:build:indexer",
    "run container:build:frontend",
    "run container:build:snapshot-gateway",
    "run container:build:snapshot-publisher",
  ];
  try {
    for (const stale of [true, false]) {
      writeFileSync(trace, "");
      const result = spawnSync("bash", ["scripts/validate.sh"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          NVM_DIR: directory,
          VALIDATION_TRACE: trace,
          VALIDATION_STALE: stale ? "1" : "0",
        },
      });
      assert.equal(result.status, stale ? 23 : 0, result.stderr);
      assert.deepEqual(
        readFileSync(trace, "utf8").trim().split("\n"),
        stale ? commands.slice(0, 5) : commands
      );
      if (stale) assert.match(result.stderr, /step 5\/11/);
      else assert.match(result.stdout, /All 11 validation steps passed/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
