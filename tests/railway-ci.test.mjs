import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const workflow = readFileSync(".github/workflows/railway-config.yml", "utf8");
const required = ["ci.yml", "security-scan.yml", "audit.yml", 255339919];

async function runGate(
  response,
  checks = [{ status: "completed", conclusion: "success" }]
) {
  const match = workflow.match(
    /      - name: Wait for merge CI\n[\s\S]*?          script: \|\n([\s\S]*?)(?=^      - name:)/m
  );
  assert(match, "production apply must wait for merge CI");
  const calls = [];
  const attempts = new Map();
  const script = match[1].replace(/^ {12}/gm, "");
  await vm.runInNewContext(`(async () => {${script}\n})()`, {
    process: { env: { MERGE_COMMIT_SHA: "merged-release" } },
    context: { repo: { owner: "fixture", repo: "fixture" }, runId: 42 },
    core: { info() {} },
    setTimeout(resolve) {
      resolve();
    },
    github: {
      async paginate(_method, args) {
        assert.equal(args.ref, "merged-release");
        return checks;
      },
      rest: {
        checks: { listForRef() {} },
        actions: {
          async getWorkflowRun(args) {
            assert.equal(args.run_id, 42);
            return { data: { check_suite_id: 100 } };
          },
          async listWorkflowRuns(args) {
            calls.push({ ...args });
            const attempt = attempts.get(args.workflow_id) ?? 0;
            attempts.set(args.workflow_id, attempt + 1);
            return {
              data: { workflow_runs: response(args.workflow_id, attempt) },
            };
          },
        },
      },
    },
  });
  return calls;
}

test("production apply waits for every required workflow on the merge commit", async () => {
  assert.match(workflow.split("\n  apply:")[1], /^      checks: read$/m);
  assert(
    workflow.indexOf("- name: Wait for merge CI") <
      workflow.indexOf("- name: Apply reviewed production plan")
  );
  const calls = await runGate((name, attempt) =>
    name === "security-scan.yml" && attempt === 0
      ? []
      : [{ status: "completed", conclusion: "success" }]
  );
  assert.deepEqual(
    [...new Set(calls.map((call) => call.workflow_id))].sort(),
    required.toSorted()
  );
  for (const call of calls) {
    assert.equal(call.head_sha, "merged-release");
    assert.equal(
      call.event,
      call.workflow_id === 255339919 ? "dynamic" : "push"
    );
  }
  assert.equal(
    calls.filter((call) => call.workflow_id === "security-scan.yml").length,
    2
  );
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /^  push:\n    branches: \[master\]$/m);
});

test("production apply blocks failed managed CodeQL and additional commit checks", async () => {
  await assert.rejects(
    runGate((name) => [
      {
        status: "completed",
        conclusion: name === 255339919 ? "failure" : "success",
      },
    ]),
    /255339919: failure/
  );
  for (const status of ["completed", "in_progress"]) {
    await assert.rejects(
      runGate(
        () => [{ status: "completed", conclusion: "success" }],
        [
          {
            name: "Socket Security",
            status,
            conclusion: status === "completed" ? "failure" : null,
          },
        ]
      ),
      status === "completed" ? /Socket Security/ : /Timed out/
    );
  }
});

test("production apply rejects failed or skipped merge CI", async () => {
  for (const conclusion of ["failure", "cancelled", "skipped"]) {
    await assert.rejects(
      runGate(() => [{ status: "completed", conclusion }]),
      new RegExp(conclusion)
    );
  }
});

test("production apply times out when merge CI never finishes", async () => {
  await assert.rejects(
    runGate(() => [{ status: "in_progress", conclusion: null }]),
    /Timed out/
  );
  await assert.rejects(
    runGate(() => []),
    /Timed out/
  );
  await assert.rejects(
    runGate(() => [{ status: "completed", conclusion: "success" }], []),
    /Timed out/
  );
});

test("optional neutral or skipped checks do not block successful required workflows", async () => {
  await runGate(
    () => [{ status: "completed", conclusion: "success" }],
    [
      { status: "completed", conclusion: "neutral" },
      { status: "completed", conclusion: "skipped" },
    ]
  );
});

test("production apply excludes its own check suite without ignoring other apply jobs", async () => {
  const ownCheck = {
    name: "apply",
    status: "in_progress",
    conclusion: null,
    check_suite: { id: 100 },
  };
  const success = { status: "completed", conclusion: "success" };
  await runGate(() => [success], [ownCheck, success]);
  await assert.rejects(
    runGate(
      () => [success],
      [ownCheck, { ...ownCheck, check_suite: { id: 101 } }, success]
    ),
    /Timed out/
  );
});
