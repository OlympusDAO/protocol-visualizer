import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const script = readFileSync(".github/workflows/audit-comment.yml", "utf8")
  .split("          script: |\n")[1]
  .replace(/^ {12}/gm, "");
const candidate = {
  number: 7,
  state: "open",
  head: { repo: { id: 42 }, ref: "fork-feature", sha: "audited-head" },
};

async function comment({
  fork = false,
  stale = false,
  advanceDuringLookup = false,
  closeDuringLookup = false,
  candidates = [candidate],
  existing = false,
  clean = false,
  report,
  size = 100,
} = {}) {
  const calls = [];
  const failures = [];
  let currentHead = stale ? "new-head" : "audited-head";
  let currentState = "open";
  const result = report ?? {
    advisories: {
      one: { severity: "moderate", module_name: "fixture", title: "Finding" },
    },
  };
  await vm.runInNewContext(`(async () => {${script}\n})()`, {
    require(name) {
      assert.equal(name, "fs");
      return {
        statSync: () => ({ size }),
        readFileSync: () => JSON.stringify(clean ? { advisories: {} } : result),
      };
    },
    process: {
      env: {
        AUDIT_RESULT_PATH: "fixture",
        AUDIT_CONCLUSION: clean ? "success" : "failure",
        WORKFLOW_RUN_URL: "https://github.com/fixture/repo/actions/runs/1",
      },
    },
    context: {
      repo: { owner: "fixture", repo: "repo" },
      payload: {
        workflow_run: {
          head_sha: "audited-head",
          head_repository: { id: 42, owner: { login: "fork-owner" } },
          head_branch: "fork-feature",
          pull_requests: fork ? [] : [{ number: 7 }],
        },
      },
    },
    core: { setFailed: (message) => failures.push(message), info() {} },
    github: {
      async paginate(method, args) {
        assert.equal(args.per_page, 100);
        if (method === "heads") {
          assert.equal(args.owner, "fixture");
          assert.equal(args.repo, "repo");
          assert.equal(args.state, "all");
          assert.equal(args.head, "fork-owner:fork-feature");
          assert(!Object.hasOwn(args, "commit_sha"));
          calls.push("heads");
          return candidates;
        }
        assert.equal(method, "comments");
        calls.push("comments");
        if (advanceDuringLookup) currentHead = "new-head";
        if (closeDuringLookup) currentState = "closed";
        return existing
          ? [
              ...Array.from({ length: 100 }, (_, id) => ({
                id,
                user: { type: "User" },
                body: "discussion",
              })),
              { id: 109, user: { type: "Bot" }, body: "<!-- pnpm-audit -->" },
            ]
          : [];
      },
      rest: {
        pulls: {
          list: "heads",
          async get(args) {
            assert.equal(args.pull_number, 7);
            calls.push("fresh-head");
            return {
              data: { state: currentState, head: { sha: currentHead } },
            };
          },
        },
        issues: {
          listComments: "comments",
          async createComment(args) {
            calls.push({ mutation: "create", ...args });
          },
          async updateComment(args) {
            calls.push({ mutation: "update", ...args });
          },
          async deleteComment(args) {
            calls.push({ mutation: "delete", ...args });
          },
        },
      },
    },
  });
  return { calls, failures };
}

test("fork audit resolves its PR through the native head query and verifies the fresh head", async () => {
  const { calls, failures } = await comment({ fork: true });
  assert.deepEqual(failures, []);
  assert.deepEqual(calls.slice(0, 3), ["heads", "comments", "fresh-head"]);
  assert.equal(calls.at(-1).mutation, "create");
  assert.equal(calls.at(-1).issue_number, 7);
});

test("fork fallback rejects wrong candidates PRs and selects only one matching open fork head", async () => {
  const wrong = [
    {
      ...candidate,
      number: 8,
      state: "closed",
      head: { ...candidate.head, sha: "closed-other-head" },
    },
    { ...candidate, number: 9, head: { ...candidate.head, repo: { id: 99 } } },
    {
      ...candidate,
      number: 10,
      head: { ...candidate.head, ref: "other-branch" },
    },
    {
      ...candidate,
      number: 11,
      head: { ...candidate.head, sha: "other-head" },
    },
  ];
  const mixed = await comment({
    fork: true,
    candidates: [...wrong, candidate],
  });
  assert.deepEqual(mixed.failures, []);
  assert.equal(mixed.calls.at(-1).issue_number, 7);
  for (const candidates of [
    wrong,
    [candidate, { ...candidate, number: 12 }],
    [candidate, { ...candidate, number: 13, state: "closed" }],
  ]) {
    const result = await comment({ fork: true, candidates });
    assert.deepEqual(result.failures, [
      "Expected exactly one pull request for the audit run",
    ]);
    assert.deepEqual(result.calls, ["heads"]);
  }
});

test("stale audits cannot create, update or delete PR comments", async () => {
  for (const options of [
    {},
    { existing: true },
    { existing: true, clean: true },
  ]) {
    const { calls, failures } = await comment({ ...options, stale: true });
    assert.deepEqual(failures, []);
    assert.deepEqual(calls, ["comments", "fresh-head"]);
    const advanced = await comment({ ...options, advanceDuringLookup: true });
    assert.deepEqual(advanced.failures, []);
    assert.deepEqual(advanced.calls, ["comments", "fresh-head"]);
    const closed = await comment({ ...options, closeDuringLookup: true });
    assert.deepEqual(closed.failures, []);
    assert.deepEqual(closed.calls, ["comments", "fresh-head"]);
  }
  const update = (await comment({ existing: true })).calls.at(-1);
  assert.equal(update.mutation, "update");
  assert.equal(update.comment_id, 109, "find the marker beyond 100 comments");
  const cleanup = (await comment({ existing: true, clean: true })).calls.at(-1);
  assert.equal(cleanup.mutation, "delete");
  assert.equal(
    cleanup.comment_id,
    109,
    "clean up the marker beyond 100 comments"
  );
});

test("advisory fields neutralize all backticks before bounded single-line code spans", async () => {
  const { calls } = await comment({
    report: {
      advisories: {
        hostile: {
          severity: "high",
          module_name: "pkg``\\![image](https://evil.invalid)\n@everyone",
          title:
            "<img src=x>\r\n[link](https://evil.invalid) `**bold**` @owner www.evil.invalid " +
            "!".repeat(500),
        },
      },
    },
  });
  const body = calls.at(-1).body;
  const line = body.split("\n").find((value) => value.startsWith("- `high`:"));
  assert(line);
  assert.equal(
    line.match(/`/g).length,
    6,
    "only three code-span delimiter pairs remain"
  );
  const fields = [...line.matchAll(/`([^`]*)`/g)].map((match) => match[1]);
  assert.equal(fields[0], "high");
  assert.equal(fields[1], "pkg''\\![image](https://evil.invalid) @everyone");
  assert(
    fields[2].startsWith(
      "<img src=x> [link](https://evil.invalid) '**bold**' @owner"
    )
  );
  assert(fields[1].length <= 80 && fields[2].length <= 120);
  assert(fields.every((field) => !/[\r\n\u2028\u2029]/.test(field)));
  assert(
    body.includes(
      "[View audit run](https://github.com/fixture/repo/actions/runs/1)"
    )
  );
});

test("the existing artifact size limit still blocks comment mutations", async () => {
  const { calls, failures } = await comment({ size: 1024 * 1024 + 1 });
  assert.deepEqual(failures, ["Audit result exceeds the 1 MiB safety limit"]);
  assert.deepEqual(calls, []);
});
