import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const required = [255339919, "audit.yml"];

async function runGate(
  response,
  checks = [{ status: "completed", conclusion: "success" }],
  statuses = []
) {
  const match = workflow.match(
    / {6}- name: Wait for external checks\n[\s\S]*? {10}script: \|\n([\s\S]*?)(?=^ {6}- name:)/m
  );
  assert(match, "production apply must wait for merge CI");
  const calls = [];
  const attempts = new Map();
  let statusReads = 0;
  const script = match[1].replace(/^ {12}/gm, "");
  await vm.runInNewContext(`(async () => {${script}\n})()`, {
    process: { env: { MERGE_COMMIT_SHA: "merged-release" } },
    context: { repo: { owner: "fixture", repo: "fixture" }, runId: 42 },
    core: { info() {} },
    setTimeout(resolve) {
      resolve();
    },
    github: {
      async paginate(method, args) {
        assert.equal(args.ref, "merged-release");
        if (method === "statuses")
          return typeof statuses === "function"
            ? statuses(statusReads++)
            : statuses;
        return checks;
      },
      rest: {
        checks: { listForRef() {} },
        repos: { listCommitStatusesForRef: "statuses" },
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
  assert.match(apply, /^ {6}statuses: read$/m);
  const needs = apply.match(/^\s+needs:\s*\[([\s\S]*?)\]/m)?.[1];
  assert(needs, "production apply must declare its deployment gates");
  assert.deepEqual(
    needs
      .split(",")
      .map((job) => job.trim())
      .filter(Boolean)
      .sort(),
    [
      "check",
      "build",
      "indexer-typecheck",
      "monitor-tests",
      "security-audit",
      "railway-plan",
    ].sort()
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
    assert.equal(
      call.event,
      call.workflow_id === "audit.yml" ? "push" : "dynamic"
    );
  }
  assert.equal(
    calls.filter((call) => call.workflow_id === 255339919).length,
    2
  );
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /^ {2}push:\n {4}branches: \[master\]$/m);
  for (const [job, path] of [["security-audit", "security-scan.yml"]]) {
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
  const audit = readFileSync(".github/workflows/audit.yml", "utf8");
  assert.match(audit, /^ {2}push:\n {4}branches: \[master\]$/m);
  assert(!audit.includes("workflow_call:"));
  assert(!ci.includes("uses: ./.github/workflows/audit.yml"));
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
  const planWorkflow = readFileSync(
    ".github/workflows/railway-config.yml",
    "utf8"
  );
  for (const file of ["mise.toml", "mise.lock"]) {
    assert(planWorkflow.includes(`      - "${file}"`));
    assert.equal((await findPlan({ files: [file] })).outputs["run-id"], 99);
  }
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
  for (const workflow of required)
    for (const conclusion of ["failure", "cancelled", "skipped"]) {
      await assert.rejects(
        runGate((name) => [
          {
            status: "completed",
            conclusion: name === workflow ? conclusion : "success",
          },
        ]),
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
    runGate((name) =>
      name === "audit.yml"
        ? []
        : [{ status: "completed", conclusion: "success" }]
    ),
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

test("production apply blocks failed or pending external commit statuses", async () => {
  const codeql = () => [{ status: "completed", conclusion: "success" }];
  for (const state of ["failure", "error", "pending"]) {
    await assert.rejects(
      runGate(codeql, undefined, [
        { context: "security/snyk (Olympus DAO)", state },
      ]),
      state === "pending" ? /Timed out/ : /security\/snyk/
    );
  }
  const calls = await runGate(codeql, undefined, (attempt) => [
    {
      context: "security/snyk (Olympus DAO)",
      state: attempt === 0 ? "pending" : "success",
    },
  ]);
  assert.equal(calls.length, required.length * 2);
});

test("production apply uses the newest status per context and excludes downstream deployments", async () => {
  const codeql = () => [{ status: "completed", conclusion: "success" }];
  await runGate(codeql, undefined, [
    { context: "security/snyk (Olympus DAO)", state: "success" },
    { context: "security/snyk (Olympus DAO)", state: "failure" },
    { context: "protocol-visualizer - snapshot-publisher", state: "pending" },
    { context: "protocol-visualizer - snapshot-monitor", state: "failure" },
  ]);
  await assert.rejects(
    runGate(codeql, undefined, [
      { context: "security/snyk (Olympus DAO)", state: "pending" },
      { context: "security/snyk (Olympus DAO)", state: "success" },
    ]),
    /Timed out/
  );
});

async function verifyPlan({
  environmentId = "production",
  sourceTree = "merged-iac-tree",
  branchHead = "merged-release",
  kind = "railway.config.plan",
  version = 1,
  changeSet = { version: 1, changes: [] },
} = {}) {
  const match = workflow.match(
    / {6}- name: Verify production plan target\n[\s\S]*? {10}script: \|\n([\s\S]*?)(?=^ {6}- name:)/m
  );
  assert(match);
  await vm.runInNewContext(
    `(async () => {${match[1].replace(/^ {12}/gm, "")}\n})()`,
    {
      process: {
        env: {
          PLAN_PATH: "reviewed-plan",
          RAILWAY_ENVIRONMENT_ID: "production",
        },
      },
      context: {
        repo: { owner: "fixture", repo: "fixture" },
        sha: "merged-release",
      },
      require(name) {
        if (name === "fs")
          return {
            readFileSync(path) {
              assert.equal(path, "reviewed-plan");
              return JSON.stringify({
                environmentId,
                sourceTree,
                kind,
                version,
                changeSet,
              });
            },
          };
        assert.equal(name, "child_process");
        return {
          execFileSync(command, args) {
            assert.equal(command, "git");
            assert.equal(JSON.stringify(args), '["rev-parse","HEAD:.railway"]');
            return "merged-iac-tree\n";
          },
        };
      },
      github: {
        rest: {
          repos: {
            async getBranch(args) {
              assert.equal(args.branch, "master");
              return { data: { commit: { sha: branchHead } } };
            },
          },
        },
      },
    }
  );
}

test("production apply rejects plans from a different environment or merged IaC tree", async () => {
  await verifyPlan();
  await assert.rejects(verifyPlan({ environmentId: "preview" }), /environment/);
  for (const sourceTree of [null, "older-iac-tree"])
    await assert.rejects(verifyPlan({ sourceTree }), /merged IaC tree/);
});

test("automatic apply blocks existing main DB image transitions but permits normal unrelated changes", async () => {
  const sourceUpdate = {
    kind: "resource.update",
    address: "database.Postgres",
    field: "source",
    before: {
      type: "image",
      image: "ghcr.io/railwayapp-templates/postgres-ssl:16",
    },
    after: {
      type: "image",
      image: "ghcr.io/railwayapp-templates/postgres-ssl:18@sha256:fixture",
    },
    severity: "safe",
    deployEffect: "deploy",
  };
  const check = (changes) => verifyPlan({ changeSet: { version: 1, changes } });
  await assert.rejects(
    check([sourceUpdate]),
    /separately approved manual reset/
  );
  await assert.rejects(
    check([{ ...sourceUpdate, before: null }]),
    /manual reset/
  );
  await assert.rejects(check([{ ...sourceUpdate, after: {} }]), /manual reset/);
  await check([{ ...sourceUpdate, address: "service.frontend" }]);
  await check([{ ...sourceUpdate, field: "deploy", before: {}, after: {} }]);
  await check([{ ...sourceUpdate, before: sourceUpdate.after }]);
  await check([
    {
      kind: "resource.create",
      address: "database.Postgres",
      resource: { source: sourceUpdate.after },
    },
  ]);
  for (const changeSet of [
    null,
    {},
    { version: 2, changes: [] },
    { version: 1, changes: [null] },
  ])
    await assert.rejects(verifyPlan({ changeSet }), /saved plan/i);
  await assert.rejects(verifyPlan({ kind: "unknown" }), /saved plan/i);
  await assert.rejects(verifyPlan({ version: 2 }), /saved plan/i);
});

test("production apply rejects an older queued release after master advances", async () => {
  await assert.rejects(verifyPlan({ branchHead: "newer-release" }), /advanced/);
  assert(
    workflow.indexOf("- name: Verify production plan target") <
      workflow.indexOf("- name: Apply reviewed production plan")
  );
});

async function checkNativeApplyResult(
  result,
  { exitCode = 0, raw, error } = {}
) {
  const script = workflow.match(
    / {6}- name: Apply reviewed production plan\n[\s\S]*? {10}script: \|\n([\s\S]*)$/m
  )?.[1];
  assert(script, "the existing CI native apply step must check its result");
  const privateMarker = "fixture-private-output-do-not-log";
  const logs = [];
  try {
    await vm.runInNewContext(
      `(async () => {${script.replace(/^ {12}/gm, "")}\n})()`,
      {
        process: {
          env: {
            RAILWAY_API_TOKEN: "fixture-only",
            RUNNER_TEMP: "/fixture-private",
          },
        },
        core: {
          info(message) {
            logs.push(message);
          },
        },
        require(name) {
          assert.equal(name, "child_process");
          return {
            spawnSync(command, args, options) {
              assert.equal(command, "railway");
              assert.equal(
                JSON.stringify(args),
                JSON.stringify([
                  "config",
                  "apply",
                  "--environment",
                  "production",
                  "--plan",
                  "/fixture-private/railway-plan/railway-plan.json",
                  "--yes",
                  "--json",
                ])
              );
              assert.equal(
                JSON.stringify(options.stdio),
                '["ignore","pipe","pipe"]'
              );
              return {
                status: exitCode,
                error,
                stdout:
                  raw ?? JSON.stringify({ ...result, outputs: privateMarker }),
                stderr: privateMarker,
              };
            },
          };
        },
      }
    );
    assert.equal(logs.length, 1);
  } catch (failure) {
    assert(!failure.message.includes(privateMarker));
    throw failure;
  } finally {
    assert(logs.every((message) => !message.includes(privateMarker)));
  }
}

test("native CI apply requires applied/noop result and every change, never exit zero or raw output", async () => {
  for (const status of ["applied", "noop"])
    await checkNativeApplyResult({
      status,
      changes: [{ status: "applied" }, { status: "noop" }],
    });
  await checkNativeApplyResult({ status: "noop", changes: [] });
  for (const status of [
    "failed",
    "partially_applied",
    "applying",
    "staged",
    "unknown",
    null,
  ]) {
    await assert.rejects(
      checkNativeApplyResult({ status, changes: [] }),
      /did not report applied\/noop/
    );
    await assert.rejects(
      checkNativeApplyResult({ status: "applied", changes: [{ status }] }),
      /did not report applied\/noop/
    );
  }
  for (const result of [
    {},
    { status: "applied" },
    { status: "applied", changes: {} },
    { status: "applied", changes: [null] },
  ])
    await assert.rejects(
      checkNativeApplyResult(result),
      /did not report applied\/noop/
    );
  await assert.rejects(
    checkNativeApplyResult(
      {},
      { raw: "not JSON fixture-private-output-do-not-log" }
    ),
    /malformed JSON/
  );
  await assert.rejects(
    checkNativeApplyResult({ status: "applied", changes: [] }, { exitCode: 7 }),
    /Native Railway apply failed/
  );
  await assert.rejects(
    checkNativeApplyResult({}, { error: { code: "ENOENT" } }),
    /Native Railway apply failed/
  );
  const runbook = readFileSync("docs/railway-self-hosting.md", "utf8");
  for (const text of [
    "`applied`",
    "`noop`",
    "`partially_applied`",
    "read-only plan",
    "HTTP/TCP",
  ])
    assert(runbook.includes(text));
});
