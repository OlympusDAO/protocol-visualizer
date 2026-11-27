// Routing tests only: every container/package command is a disposable fake.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const pgImage =
  "postgres:18.6-alpine3.24@sha256:9ba53c7d41ea093baf5c1ba635ba5434c4f979880527d49bb7d9237d3193085b";

function fixture(t, { cached = false, ...env } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "pv-integration-routing-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = path.join(directory, "calls.jsonl");
  const present = path.join(directory, "pg-present");
  if (cached) writeFileSync(present, "cached");
  mkdirSync(path.join(directory, "scripts"));
  for (const file of ["test-integration.mjs", "validation-evidence.mjs"])
    copyFileSync(
      new URL(`../scripts/${file}`, import.meta.url),
      path.join(directory, "scripts", file)
    );
  const record = `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify([command, ...args]) + "\\n");`;
  for (const command of ["docker", "pnpm", "git"])
    writeFileSync(
      path.join(directory, command),
      `#!${process.execPath}
const fs = require("node:fs");
const command = ${JSON.stringify(command)}, args = process.argv.slice(2);
${record}
if (command === "git" && args[0] === "rev-parse") console.log("fixture-head");
if (command === "pnpm" && process.env.FIXTURE_RPC_FAILURE) process.exit(26);
if (command === "docker") {
  if (args[0] === "info" && process.env.FIXTURE_DOCKER_FAILURE) process.exit(17);
  if (args[0] === "image" && args[1] === "inspect") {
    if (args[2].startsWith("protocol-visualizer/") && process.env.FIXTURE_APP_MISSING) process.exit(18);
    if (args[2] === ${JSON.stringify(pgImage)} && !fs.existsSync(${JSON.stringify(present)})) process.exit(1);
    console.log("[local tag]");
  } else if (args[0] === "pull") {
    if (args[1] !== ${JSON.stringify(pgImage)}) process.exit(42);
    if (process.env.FIXTURE_PULL_FAILURE) process.exit(23);
    fs.writeFileSync(${JSON.stringify(present)}, "pulled exact fixture");
  }
}
`,
      { mode: 0o755 }
    );
  const environment = {
    ...process.env,
    PATH: directory,
    PV_VALIDATION_CHILD: "integration",
    RPC_CACHE_TEST_SKIP_RESET: "",
    ...env,
  };
  delete environment.NODE_TEST_CONTEXT;
  const options = { cwd: directory, env: environment };
  const run = () =>
    spawnSync(process.execPath, ["scripts/test-integration.mjs"], {
      ...options,
      encoding: "utf8",
    });
  return {
    run,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8").split("\n").filter(Boolean).map(JSON.parse)
        : [],
  };
}

test("integration prepares only missing pinned PG18 independently of security scans", (t) => {
  for (const cached of [false, true]) {
    const f = fixture(t, { cached, PV_VALIDATION_CHILD: "" });
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert(result.stdout.includes("Validation finished (exit 0); evidence:"));
    assert.equal(f.calls().filter((c) => c[1] === "info").length, 1);
    const calls = f.calls();
    assert.deepEqual(
      calls.filter((c) => c[1] === "pull"),
      cached ? [] : [["docker", "pull", pgImage]]
    );
    assert.deepEqual(
      calls.filter((c) => c[1] === "image").map((c) => c[3]),
      [
        "protocol-visualizer/indexer:local",
        "protocol-visualizer/rpc-cache:local",
        pgImage,
        pgImage,
      ]
    );
    assert.deepEqual(
      calls.filter((c) => c[0] === "pnpm"),
      [["pnpm", "run", "test:rpc-cache"]]
    );
    assert(!calls.some((c) => ["create", "build", "rm"].includes(c[1])));
  }
});

test("every database used by required integration shares the independently prepared exact fixture pin", () => {
  for (const file of [
    "services/rpc-cache/integration.test.mjs",
    "scripts/benchmark-indexer.mjs",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(source.match(/const pgImage =\s*"([^"]+)"/)[1], pgImage);
    assert(source.includes("PGDATA=/var/lib/postgresql/18/docker"));
  }
});

test("integration prerequisite failures stop before the actual image fixtures", (t) => {
  for (const [env, status] of [
    [{ FIXTURE_DOCKER_FAILURE: "1" }, 17],
    [{ FIXTURE_APP_MISSING: "1" }, 18],
    [{ FIXTURE_PULL_FAILURE: "1" }, 23],
    [{ RPC_CACHE_TEST_SKIP_RESET: "1" }, 1],
  ]) {
    const f = fixture(t, { ...env, PV_VALIDATION_CHILD: "" });
    const result = f.run();
    assert.equal(result.status, status, result.stderr);
    assert(!f.calls().some((c) => c[1] === "create" || c[0] === "pnpm"));
    if (env.FIXTURE_APP_MISSING)
      assert(!f.calls().some((c) => c[1] === "pull"));
  }
});

test("actual image fixture failures retain their nonzero status", (t) => {
  const f = fixture(t, {
    cached: true,
    FIXTURE_RPC_FAILURE: "1",
    PV_VALIDATION_CHILD: "",
  });
  const result = f.run();
  assert.equal(result.status, 26, result.stderr);
  assert.deepEqual(
    f.calls().filter((call) => call[0] === "pnpm"),
    [["pnpm", "run", "test:rpc-cache"]]
  );
  assert.match(result.stdout, /Validation finished \(exit 26\)/);
});
