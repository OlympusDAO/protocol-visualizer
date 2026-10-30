import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("metrics opens the browser only after forwarding succeeds and removes its temporary SSH configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "rpc-metrics-test-"));
  const log = join(directory, "commands.jsonl");
  const fixture = `#!/usr/bin/env node
const fs = require("node:fs");
const command = require("node:path").basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.METRICS_TEST_LOG, JSON.stringify({command,args}) + "\\n");
if (command === "railway") console.log("Host pv-rpc-cache-metrics\\n  HostName railway.example\\n  User fixture");
if (command === "uname") console.log("Darwin");
if (command === "ssh" && args.includes("check")) process.exit(1);
if (command === "ssh" && args.includes("-fN") && process.env.METRICS_TEST_SSH_FAIL) process.exit(1);
`;
  try {
    for (const command of ["railway", "ssh", "curl", "open", "uname"])
      writeFileSync(join(directory, command), fixture, { mode: 0o755 });
    const environment = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      METRICS_TEST_LOG: log,
      RAILWAY_ENVIRONMENT: "preview environment",
    };
    delete environment.METRICS_TEST_SSH_FAIL;
    const run = (env) =>
      spawnSync("bash", [resolve("scripts/rpc-cache-metrics.sh")], {
        env,
        encoding: "utf8",
        timeout: 10000,
      });
    const calls = () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

    const connected = run(environment);
    assert.equal(connected.status, 1, connected.stderr);
    assert.match(connected.stderr, /The SSH tunnel closed/);
    const commands = calls();
    assert(commands[0].args.includes("--dry-run"));
    assert(commands[0].args.includes("preview environment"));
    const tunnel = commands.find((call) => call.args.includes("-fN"));
    assert(tunnel.args.includes("ExitOnForwardFailure=yes"));
    assert(tunnel.args.includes("127.0.0.1:14001:127.0.0.1:4001"));
    const browser = commands.find((call) => call.command === "open");
    assert.deepEqual(browser.args, ["http://127.0.0.1:14001/metrics"]);
    assert(
      commands.findIndex((call) => call.command === "curl") <
        commands.indexOf(browser)
    );
    assert(!existsSync(tunnel.args[tunnel.args.indexOf("-F") + 1]));

    writeFileSync(log, "");
    const failed = run({ ...environment, METRICS_TEST_SSH_FAIL: "1" });
    assert.equal(failed.status, 1);
    assert(!calls().some((call) => call.command === "open"));
    assert(!calls().some((call) => call.command === "curl"));

    writeFileSync(log, "");
    const missingEnvironment = { ...environment };
    delete missingEnvironment.RAILWAY_ENVIRONMENT;
    const missing = run(missingEnvironment);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Set RAILWAY_ENVIRONMENT/);
    assert.equal(readFileSync(log, "utf8"), "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
