import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("Railway operations announce and pin linked or explicit targets, and refuse a mismatched saved plan", () => {
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
else if (args[0] === "config" && args[1] === "plan") fs.writeFileSync("railway-plan.json",JSON.stringify({projectId:"project-id",environmentId:env.RAILWAY_ENVIRONMENT_ID}));
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

    const linkedPlan = run("plan");
    assert.equal(linkedPlan.status, 0, linkedPlan.stderr);
    assert.deepEqual(calls().at(-1).args, [
      "config",
      "plan",
      "--environment",
      "preview-id",
      "--out",
      "railway-plan.json",
    ]);
    assert.equal(run("apply").status, 0);

    const explicit = run("plan", ["--environment", "production", "--yes"], {
      RAILWAY_ENVIRONMENT: "preview",
    });
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.match(explicit.stderr, /Environment: production \(production-id\)/);
    assert(calls().at(-1).args.includes("production-id"));
    assert(calls().at(-1).args.includes("--yes"));
    const mismatched = run("apply");
    assert.equal(mismatched.status, 1);
    assert.match(mismatched.stderr, /Saved plan does not match/);
    assert(!calls().some((call) => call.args[0] === "config"));
    assert.equal(run("apply", ["--environment=production"]).status, 0);
    const otherArtifact = run("apply", [
      "--environment",
      "production",
      "--plan",
      "other.json",
    ]);
    assert.equal(otherArtifact.status, 1);
    assert.match(otherArtifact.stderr, /Scripts use railway-plan.json/);
    assert.equal(calls().length, 0);

    const unlinked = run("metrics", [], { RAILWAY_TEST_UNLINKED: "1" });
    assert.equal(unlinked.status, 1);
    assert.match(unlinked.stderr, /Cannot select one Railway environment/);
    assert(!calls().some((call) => call.command === "bash"));
    const unknown = run("plan", ["--environment", "does-not-exist"]);
    assert.equal(unknown.status, 1);
    assert(!calls().some((call) => call.args[0] === "config"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
