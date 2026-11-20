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
  mkdirSync(path.join(directory, "apps/indexer/scripts"), { recursive: true });
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
if (command === "docker") {
  if (args[0] === "start" && process.env.FIXTURE_START_FAILURE) process.exit(24);
  if (args[0] === "rm" && process.env.FIXTURE_CLEANUP_FAILURE) process.exit(25);
  if (args[0] === "info" && process.env.FIXTURE_DOCKER_FAILURE) process.exit(17);
  if (args[0] === "image" && args[1] === "inspect") {
    if (args[2].startsWith("protocol-visualizer/") && process.env.FIXTURE_APP_MISSING) process.exit(18);
    if (args[2] === ${JSON.stringify(pgImage)} && !fs.existsSync(${JSON.stringify(present)})) process.exit(1);
    console.log("[local tag]");
  } else if (args[0] === "pull") {
    if (args[1] !== ${JSON.stringify(pgImage)}) process.exit(42);
    if (process.env.FIXTURE_PULL_FAILURE) process.exit(23);
    fs.writeFileSync(${JSON.stringify(present)}, "pulled exact fixture");
  } else if (args[0] === "port") console.log("127.0.0.1:54999");
  else if (args[0] === "inspect") console.log("fixture image");
}
`,
      { mode: 0o755 }
    );
  for (const file of ["state-postgres.test.mjs", "effect-cache-stash.test.mjs"])
    writeFileSync(
      path.join(directory, "apps/indexer/scripts", file),
      `import fs from "node:fs"; const command="mock-sql", args=[${JSON.stringify(file)}]; ${record}`
    );
  writeFileSync(
    path.join(directory, "apps/indexer/scripts/register-typescript.mjs"),
    ""
  );
  const environment = {
    ...process.env,
    PATH: directory,
    PV_VALIDATION_CHILD: "integration",
    RPC_CACHE_TEST_SKIP_RESET: "",
    ...env,
  };
  delete environment.NODE_TEST_CONTEXT;
  const run = () =>
    spawnSync(process.execPath, ["scripts/test-integration.mjs"], {
      cwd: directory,
      encoding: "utf8",
      env: environment,
    });
  return {
    run,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse)
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
    const appChecks = calls.filter(
      (c) => c[1] === "image" && c[3].startsWith("protocol-visualizer/")
    );
    assert.equal(appChecks.length, 2);
    assert(
      calls.findIndex((c) => c[1] === "create") >
        calls.findIndex((c) => c[1] === "image" && c[3] === pgImage)
    );
    assert(
      calls.some((c) => c[0] === "mock-sql"),
      JSON.stringify(calls)
    );
    assert.deepEqual(
      calls
        .filter((c) => c[0] === "mock-sql")
        .map((c) => c[1])
        .sort(),
      ["effect-cache-stash.test.mjs", "state-postgres.test.mjs"]
    );
    assert(calls.some((c) => c[0] === "pnpm" && c[2] === "test:rpc-cache"));
    assert(calls.some((c) => c[1] === "rm" && c.includes("--volumes")));
    assert(!JSON.stringify(calls).includes("quay.io"));
    assert(!calls.some((c) => c[1] === "build"));
    assert(
      calls
        .find((c) => c[1] === "create")
        .includes("PGDATA=/var/lib/postgresql/18/docker")
    );
  }
});

test("every database used by required integration shares the independently prepared exact fixture pin", () => {
  for (const file of [
    "scripts/test-integration.mjs",
    "services/rpc-cache/integration.test.mjs",
    "scripts/benchmark-indexer.mjs",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(source.match(/const pgImage =\s*"([^"]+)"/)[1], pgImage);
    assert(source.includes("PGDATA=/var/lib/postgresql/18/docker"));
  }
});

test("integration prerequisite failures remain failures before container creation", (t) => {
  for (const [env, status] of [
    [{ FIXTURE_DOCKER_FAILURE: "1" }, 17],
    [{ FIXTURE_APP_MISSING: "1" }, 18],
    [{ FIXTURE_PULL_FAILURE: "1" }, 23],
    [{ RPC_CACHE_TEST_SKIP_RESET: "1" }, 1],
  ]) {
    const f = fixture(t, { ...env, PV_VALIDATION_CHILD: "" });
    const result = f.run();
    assert.equal(result.status, status, result.stderr);
    assert(
      !f
        .calls()
        .some(
          (c) => c[1] === "create" || c[0] === "mock-sql" || c[0] === "pnpm"
        )
    );
    if (env.FIXTURE_APP_MISSING)
      assert(!f.calls().some((c) => c[1] === "pull"));
  }
});

test("failed PostgreSQL startup removes the created fixture and anonymous volume, preserving failure", (t) => {
  const f = fixture(t, {
    cached: true,
    FIXTURE_START_FAILURE: "1",
    FIXTURE_CLEANUP_FAILURE: "1",
  });
  const result = f.run();
  assert.equal(result.status, 24, result.stderr);
  const calls = f.calls();
  const create = calls.find((c) => c[1] === "create");
  const name = create[create.indexOf("--name") + 1];
  assert.deepEqual(
    calls.find((c) => c[1] === "start"),
    ["docker", "start", name]
  );
  assert.deepEqual(calls.at(-1), [
    "docker",
    "rm",
    "--force",
    "--volumes",
    name,
  ]);
  assert(!calls.some((c) => c[0] === "mock-sql" || c[0] === "pnpm"));
});
