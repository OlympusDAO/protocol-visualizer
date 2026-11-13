import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const required = [255339919];

async function runGate(
  response,
  checks = [{ status: "completed", conclusion: "success" }]
) {
  const match = workflow.match(
    / {6}- name: Wait for external checks\n[\s\S]*? {10}script: \|\n([\s\S]*?)(?=^ {6}- name:)/m
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

test("production apply depends on native CI jobs and waits only for external workflows", async () => {
  const apply = workflow.split("\n  railway-apply:")[1];
  assert.match(apply, /^ {6}checks: read$/m);
  assert.match(
    apply,
    /needs: \[lint-check, build, security-audit, dependency-audit, railway-plan\]/
  );
  assert.match(apply, /needs.railway-plan.outputs.run-id != ''/);
  assert.match(apply, /group: railway-infrastructure-production/);
  assert(
    workflow.indexOf("- name: Wait for external checks") <
      workflow.indexOf("- name: Apply reviewed production plan")
  );
  const calls = await runGate((name, attempt) =>
    attempt === 0 ? [] : [{ status: "completed", conclusion: "success" }]
  );
  assert.deepEqual(
    [...new Set(calls.map((call) => call.workflow_id))].sort(),
    required.toSorted()
  );
  for (const call of calls) {
    assert.equal(call.head_sha, "merged-release");
    assert.equal(call.event, "dynamic");
  }
  assert.equal(
    calls.filter((call) => call.workflow_id === 255339919).length,
    2
  );
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /^ {2}push:\n {4}branches: \[master\]$/m);
  for (const [job, path] of [
    ["security-audit", "security-scan.yml"],
    ["dependency-audit", "audit.yml"],
  ]) {
    assert.match(
      ci,
      new RegExp(
        `  ${job}:\\n    if: github.event_name != 'pull_request'\\n    uses: ./\\.github/workflows/${path}`
      )
    );
    const reusable = readFileSync(`.github/workflows/${path}`, "utf8");
    assert.match(reusable, /^ {2}workflow_call:$/m);
    assert.match(reusable, /^ {2}pull_request:$/m);
    assert(!/^ {2}push:/m.test(reusable));
    assert(!reusable.includes("group: ${{ github.workflow }}"));
  }
});

const mergedPR = {
  number: 7,
  merged_at: "2026-11-13",
  merge_commit_sha: "merged-release",
  base: { ref: "master" },
  head: { sha: "reviewed-head", repo: { full_name: "fixture/fixture" } },
};

async function findPlan({
  prs,
  files = [".railway/railway.ts"],
  runs = [{ id: 99 }],
} = {}) {
  const match = workflow.match(
    / {6}- name: Find reviewed production plan\n[\s\S]*? {10}script: \|\n([\s\S]*?)(?=^ {2}railway-apply:)/m
  );
  assert(match, "CI must select the exact merged PR's plan");
  const outputs = {};
  const calls = [];
  await vm.runInNewContext(
    `(async () => {${match[1].replace(/^ {12}/gm, "")}\n})()`,
    {
      context: {
        repo: { owner: "fixture", repo: "fixture" },
        sha: "merged-release",
        payload: { repository: { full_name: "fixture/fixture" } },
      },
      core: {
        info() {},
        setOutput(name, value) {
          outputs[name] = value;
        },
      },
      github: {
        async paginate(method, args) {
          if (method === "associated") {
            assert.equal(args.commit_sha, "merged-release");
            return prs ?? [mergedPR];
          }
          assert.equal(args.pull_number, 7);
          return files.map((filename) => ({ filename }));
        },
        rest: {
          repos: { listPullRequestsAssociatedWithCommit: "associated" },
          pulls: { listFiles: "files" },
          actions: {
            async listWorkflowRuns(args) {
              calls.push(args);
              return { data: { workflow_runs: runs } };
            },
          },
        },
      },
    }
  );
  return { outputs, calls };
}

test("CI selects the successful plan for the exact merged PR head", async () => {
  const { outputs, calls } = await findPlan();
  assert.equal(outputs["run-id"], 99);
  assert.equal(calls[0].workflow_id, "railway-config.yml");
  assert.equal(calls[0].head_sha, "reviewed-head");
  assert.equal(calls[0].event, "pull_request");
  assert.equal(calls[0].status, "success");
  await assert.rejects(findPlan({ runs: [] }), /No successful plan/);
});

test("CI skips infrastructure apply for direct pushes and unrelated merges", async () => {
  assert.deepEqual((await findPlan({ prs: [] })).outputs, {});
  assert.deepEqual(
    (await findPlan({ files: ["apps/frontend/src/App.tsx"] })).outputs,
    {}
  );
  for (const merge_commit_sha of ["another-merge", null]) {
    assert.deepEqual(
      (await findPlan({ prs: [{ merged_at: "2026-11-13", merge_commit_sha }] }))
        .outputs,
      {}
    );
  }
  for (const pr of [
    { ...mergedPR, merged_at: null },
    { ...mergedPR, base: { ref: "another-branch" } },
    { ...mergedPR, head: { repo: { full_name: "fork/fixture" } } },
    { ...mergedPR, head: { repo: null } },
  ]) {
    assert.deepEqual((await findPlan({ prs: [pr] })).outputs, {});
  }
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
