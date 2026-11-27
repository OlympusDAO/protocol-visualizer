import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
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

for (const [signal, status, followupSignal] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGINT", 130, "SIGTERM"],
]) {
  test(`recorder forwards ${signal}${followupSignal ? ` then ${followupSignal}` : ""} to descendants and finishes its receipt`, {
    timeout: 5_000,
  }, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "pv-validation-signal-"));
    t.after(() => {
      for (const file of ["worker-pid", "child-pid"]) {
        const pidFile = join(directory, file);
        if (existsSync(pidFile))
          try {
            process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
          } catch {}
      }
      rmSync(directory, { recursive: true, force: true });
    });
    mkdirSync(join(directory, "scripts"));
    copyFileSync(
      new URL("../scripts/validation-evidence.mjs", import.meta.url),
      join(directory, "scripts/validation-evidence.mjs")
    );
    writeFileSync(
      join(directory, "git"),
      '#!/bin/sh\nif [ "$1" = rev-parse ]; then echo fixture-head; fi\n',
      { mode: 0o755 }
    );
    writeFileSync(
      join(directory, "fixture.mjs"),
      `import { spawn } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
const signals = ["SIGINT", "SIGTERM"];
if (process.argv[2] === "worker") {
  writeFileSync("worker-pid", String(process.pid));
  const keepAlive = setInterval(() => {}, 1000);
  for (const signal of signals) process.once(signal, () => {
    if (${Boolean(followupSignal)} && signal === "SIGINT") {
      console.log("worker ignored SIGINT");
      return;
    }
    setTimeout(() => {
      console.log("worker stopped by " + signal);
      unlinkSync("worker-pid");
      clearInterval(keepAlive);
    }, 200);
  });
  console.log("worker ready");
} else {
  writeFileSync("child-pid", String(process.pid));
  for (const signal of signals) process.on(signal, () => {});
  const worker = spawn(process.execPath, ["fixture.mjs", "worker"], { stdio: "inherit" });
  worker.once("close", () => unlinkSync("child-pid"));
}
`
    );
    const recorder = spawn(
      process.execPath,
      [
        "scripts/validation-evidence.mjs",
        "signal",
        process.execPath,
        "fixture.mjs",
      ],
      {
        cwd: directory,
        env: { ...process.env, PATH: directory },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    t.after(() => recorder.kill("SIGKILL"));
    let output = "";
    let stderr = "";
    let sent = false;
    let escalated = false;
    let childPid;
    recorder.stdout.on("data", (chunk) => {
      output += chunk;
      if (!sent && output.includes("worker ready")) {
        childPid = Number(readFileSync(join(directory, "child-pid"), "utf8"));
        sent = true;
        recorder.kill(signal);
      }
      if (
        followupSignal &&
        !escalated &&
        output.includes("worker ignored SIGINT")
      ) {
        escalated = true;
        recorder.kill(followupSignal);
      }
    });
    recorder.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    assert.deepEqual(await once(recorder, "close"), [status, null], stderr);
    assert.match(
      output,
      new RegExp(`worker stopped by ${followupSignal ?? signal}`)
    );
    assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
    assert(!existsSync(join(directory, "worker-pid")));
    const receipt = JSON.parse(
      readFileSync(output.match(/Validation evidence: (.+)/)[1], "utf8")
    );
    assert.equal(receipt.exitCode, status);
    assert.equal(receipt.finalRevision.head, "fixture-head");
    assert(receipt.finishedAt);
    assert.match(readFileSync(receipt.log, "utf8"), /worker stopped by/);
  });
}
