import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("bare source validation installs first, records native output and preserves first failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-validation-"));
  try {
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "bin"));
    symlinkSync(process.execPath, join(directory, "bin/node"));
    for (const file of ["validate.sh", "validation-evidence.mjs"])
      copyFileSync(
        new URL("../scripts/" + file, import.meta.url),
        join(directory, "scripts", file)
      );
    copyFileSync(".node-version", join(directory, ".node-version"));
    writeFileSync(
      join(directory, "bin/git"),
      '#!/bin/sh\nif [ "$1" = rev-parse ]; then echo fixture-head; fi\n',
      { mode: 0o755 }
    );
    function pnpm() {
      const fs = require("node:fs"),
        args = process.argv.slice(2).join(" ");
      fs.appendFileSync("calls", args + "\n");
      if (args === "install --frozen-lockfile") {
        if (process.env.INSTALL_FAIL) process.exit(17);
        fs.writeFileSync("installed", "");
      }
      if (!fs.existsSync("installed")) process.exit(18);
      if (process.env.STALE && args === "run build") {
        console.error("native drift failure");
        process.exit(23);
      }
    }
    writeFileSync(
      join(directory, "bin/pnpm"),
      "#!" + process.execPath + "\n(" + pnpm.toString() + ")();",
      { mode: 0o755 }
    );
    for (const [extra, code, count] of [
      [{}, 0, 8],
      [{ STALE: "1" }, 23, 6],
      [{ INSTALL_FAIL: "1" }, 17, 1],
    ]) {
      rmSync(join(directory, "installed"), { force: true });
      writeFileSync(join(directory, "calls"), "");
      const result = spawnSync("/bin/bash", ["scripts/validate.sh"], {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: join(directory, "bin") + ":/usr/bin:/bin",
          NVM_DIR: directory,
          PV_VALIDATION_CHILD: "",
          ...extra,
        },
      });
      assert.equal(result.status, code, result.stderr);
      const calls = readFileSync(join(directory, "calls"), "utf8")
        .trim()
        .split("\n");
      assert.equal(calls[0], "install --frozen-lockfile");
      assert.equal(calls.length, count);
      const receipt = JSON.parse(
        readFileSync(
          result.stdout.match(/Validation evidence: (.+)/)[1],
          "utf8"
        )
      );
      assert.equal(receipt.exitCode, code);
      assert.equal(receipt.head, "fixture-head");
      assert(receipt.finishedAt);
      if (code === 23)
        assert(
          readFileSync(receipt.log, "utf8").includes("native drift failure")
        );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
