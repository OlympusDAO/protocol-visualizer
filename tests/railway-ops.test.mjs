import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("native apply alias requires an explicit environment value", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    scripts["railway:apply"],
    "railway config apply --plan railway-plan.json --environment"
  );
});

test("operator docs verify linked project separately from saved environment and use current validation", () => {
  for (const file of ["docs/railway-self-hosting.md"]) {
    const text = readFileSync(file, "utf8");
    assert(text.includes("railway status"));
    assert(text.includes("`environmentId`"));
    assert(text.includes("no `projectId`"));
    assert(!text.includes("saved plan project/environment IDs"));
    assert(text.includes("`pnpm railway:apply production --json`"));
    assert(!text.includes("`pnpm railway:apply production`"));
  }
  const readme = readFileSync("apps/indexer/README.md", "utf8");
  assert(readme.includes("pnpm validate:all"));
  assert(!readme.includes("validate:local"));
  const cacheDocs = readFileSync("docs/rpc-cache.md", "utf8");
  const integration = readFileSync("scripts/test-integration.mjs", "utf8");
  const fixture = integration.match(/"(postgres:18[^"\n]+)"/)[1];
  assert(cacheDocs.includes(fixture));
  assert(cacheDocs.includes("`pnpm test:integration`"));
  assert(cacheDocs.includes("`--pull=never`"));
});

test("documented plan preparation restricts both fresh and pre-existing artifacts before native writes", () => {
  const preparation =
    "umask 077\ntouch railway-plan.json\nchmod 600 railway-plan.json";
  for (const file of ["docs/railway-self-hosting.md"]) {
    const text = readFileSync(file, "utf8");
    assert(text.includes(preparation));
    assert(
      text.indexOf(preparation) <
        text.indexOf("railway config plan --environment")
    );
    assert(text.includes("Gitignore is not filesystem protection"));
  }
  for (const existing of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), "private-plan-permissions-"));
    try {
      const plan = join(directory, "railway-plan.json");
      if (existing) {
        writeFileSync(plan, "fixture private data");
        chmodSync(plan, 0o644);
      }
      const result = spawnSync("/bin/sh", ["-c", preparation], {
        cwd: directory,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(statSync(plan).mode & 0o777, 0o600);
      assert.equal(
        readFileSync(plan, "utf8"),
        existing ? "fixture private data" : ""
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("Railway operations announce and pin linked or explicit targets, and reject removed plan/apply wrappers", () => {
  const root = mkdtempSync(join(tmpdir(), "railway-ops-"));
  const log = join(root, "calls.jsonl");
  const script = resolve("scripts/railway-ops.mjs");
  const fixture = `#!/usr/bin/env node
const fs = require("node:fs");
const command = require("node:path").basename(process.argv[1]);
const args = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.RAILWAY_TEST_LOG, JSON.stringify({command,args,project:env.RAILWAY_PROJECT_ID,environment:env.RAILWAY_ENVIRONMENT_ID}) + "\\n");
if (args[0] === "status") console.log(JSON.stringify({id:"project-id",name:"protocol-visualizer"}));
else if (args[0] === "environment") console.log(JSON.stringify({environments:[
  {id:"preview-id",name:"preview",isLinked:!env.RAILWAY_TEST_UNLINKED},
  {id:"production-id",name:"production",isLinked:false}
]}));
else console.error("EXECUTED " + command);
`;
  try {
    for (const name of ["railway", "bash"])
      writeFileSync(join(root, name), fixture, { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      RAILWAY_TEST_LOG: log,
    };
    delete env.RAILWAY_ENVIRONMENT;
    delete env.RAILWAY_TEST_UNLINKED;
    const run = (operation, args = [], overrides = {}) => {
      writeFileSync(log, "");
      return spawnSync(process.execPath, [script, operation, ...args], {
        cwd: root,
        env: { ...env, ...overrides },
        encoding: "utf8",
        timeout: 5000,
      });
    };
    const calls = () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);

    const metrics = run("metrics");
    assert.equal(metrics.status, 0, metrics.stderr);
    assert.match(metrics.stderr, /project protocol-visualizer \(project-id\)/);
    assert.match(metrics.stderr, /Environment: preview \(preview-id\)/);
    assert(
      metrics.stderr.indexOf("Environment:") <
        metrics.stderr.indexOf("EXECUTED bash")
    );
    assert.equal(calls().at(-1).environment, "preview-id");
    assert.equal(calls().at(-1).project, "project-id");

    for (const removed of ["plan", "apply"]) {
      const result = run(removed);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Choose metrics or reset/);
      assert.equal(calls().length, 0);
    }
    const reset = run("reset", ["--environment", "production"]);
    assert.equal(reset.status, 0, reset.stderr);
    assert.equal(calls().at(-1).environment, "production-id");
    assert.deepEqual(calls().at(-1).args, [
      "ssh",
      "--service",
      "indexer",
      "--environment",
      "production-id",
      "--",
      "/nodejs/bin/node",
      "/app/apps/indexer/scripts/reset-envio.mjs",
    ]);
    assert.equal(run("reset").status, 1);
    assert.equal(calls().length, 0);

    const unlinked = run("metrics", [], { RAILWAY_TEST_UNLINKED: "1" });
    assert.equal(unlinked.status, 1);
    assert.match(unlinked.stderr, /Cannot select one Railway environment/);
    assert(!calls().some((call) => call.command === "bash"));
    const unknown = run("reset", ["--environment", "does-not-exist"]);
    assert.equal(unknown.status, 1);
    assert(!calls().some((call) => call.args[0] === "config"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
