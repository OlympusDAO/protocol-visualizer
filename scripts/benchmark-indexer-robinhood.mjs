import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  digest,
  entityDigests,
  resultProblems,
  runtimeHash,
  summarize,
  writeResult,
} from "./benchmark-indexer.mjs";
import { compareAuditedStates } from "./benchmark-indexer-equivalence.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fileHash = (path) =>
  createHash("sha256")
    .update(readFileSync(join(root, path)))
    .digest("hex");
export const acceptanceHash = () =>
  digest(
    [
      "scripts/benchmark-indexer.mjs",
      "scripts/benchmark-indexer-probe.mjs",
      "scripts/benchmark-indexer-admission.mjs",
      "scripts/benchmark-indexer-audit.mjs",
      "scripts/benchmark-indexer-equivalence.mjs",
      "scripts/benchmark-indexer-robinhood.mjs",
      "apps/indexer/scripts/typescript-loader.mjs",
      "apps/indexer/scripts/fixtures/effect-runtime.mjs",
    ].map((path) => [path, fileHash(path)])
  );
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 30000,
  }).trim();
const resolveRef = (ref) =>
  git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`);
const stateFor = (run) => {
  assert.match(run.diagnosticId, /^indexer-[a-f0-9-]+$/);
  const state = json(
    join(root, "benchmarks", run.diagnosticId, "1/state.private.json")
  );
  assert.equal(
    digest(Object.keys(state).toSorted()),
    digest(Object.keys(run.entities).toSorted())
  );
  for (const [name, rows] of Object.entries(state))
    assert.equal(digest(entityDigests(name, rows)), digest(run.entities[name]));
  return state;
};

export function checkPair(
  baseline,
  candidate,
  expected = {
    baseline: resolveRef("feat/robinhood-chain"),
    candidate: resolveRef("HEAD"),
  }
) {
  assert.equal(
    baseline.source.commit,
    expected.baseline,
    "stale baseline revision"
  );
  assert.equal(
    candidate.source.indexerInputHash,
    runtimeHash(expected.candidate),
    "stale candidate runtime"
  );
  for (const result of [baseline, candidate]) {
    assert.equal(
      result.acceptanceHash,
      acceptanceHash(),
      "stale acceptance implementation"
    );
    assert.deepEqual(resultProblems(result), []);
    assert.equal(result.requestedRuns, 3);
    assert.equal(
      result.source.indexerInputHash,
      runtimeHash(result.source.commit)
    );
    result.runs.forEach(stateFor);
  }
  assert.equal(
    baseline.source.nativeBatchSize,
    candidate.source.nativeBatchSize
  );
  assert.equal(baseline.source.lockfileHash, candidate.source.lockfileHash);
  const events = baseline.runs[0].meta.eventsProcessed;
  for (const result of [baseline, candidate])
    for (const run of result.runs)
      assert.equal(run.meta.eventsProcessed, events);
  assert.deepEqual(
    baseline.runs.map((run) => run.trialIndex),
    [1, 4, 5]
  );
  assert.deepEqual(
    candidate.runs.map((run) => run.trialIndex),
    [2, 3, 6]
  );
  const inputs = [baseline, candidate].map((result) => {
    const input = structuredClone(result.inputs);
    delete input.workload.configHash;
    return input;
  });
  assert.equal(digest(inputs[0]), digest(inputs[1]));
  const representatives = [baseline, candidate].map((result) => {
    const run = result.runs.findLast((run) => run.audit);
    assert.ok(run, "missing independent audit");
    assert.equal(run.audit.identity.oracleCommit, baseline.source.commit);
    assert.equal(
      run.audit.identity.oracleInputHash,
      baseline.source.indexerInputHash
    );
    assert.equal(
      run.audit.identity.proofInputHash,
      candidate.source.indexerInputHash
    );
    assert.equal(run.audit.measuredConfigHash, result.source.configHash);
    assert.equal(
      run.audit.identity.implementation,
      fileHash("scripts/benchmark-indexer-audit.mjs")
    );
    assert.equal(
      run.audit.identity.loaderHash,
      fileHash("apps/indexer/scripts/typescript-loader.mjs")
    );
    assert.equal(
      run.audit.identity.effectRuntimeHash,
      fileHash("apps/indexer/scripts/fixtures/effect-runtime.mjs")
    );
    return { state: stateFor(run), audit: run.audit };
  });
  const equivalence = compareAuditedStates(
    representatives[0].state,
    representatives[1].state,
    representatives[0].audit,
    representatives[1].audit
  );
  const oldTime = baseline.summary.medianCommittedSeconds;
  const newTime = candidate.summary.medianCommittedSeconds;
  return {
    equivalence,
    throughputGainPercent: 100 * (oldTime / newTime - 1),
    timeReductionPercent: 100 * (1 - newTime / oldTime),
  };
}

function aggregate(records, fingerprint) {
  const first = records[0];
  for (const record of records) {
    assert.deepEqual(resultProblems(record), []);
    assert.equal(record.inputFingerprint, first.inputFingerprint);
    assert.equal(digest(record.source), digest(first.source));
  }
  const runs = records.map((record) => ({
    ...record.runs[0],
    diagnosticId: record.diagnosticId,
    trialIndex: record.trialIndex,
    startedAt: record.generatedAt,
  }));
  return {
    ...first,
    requestedRuns: runs.length,
    runs,
    summary: summarize(runs),
    acceptanceHash: fingerprint,
  };
}

export async function main(args) {
  const { values } = parseArgs({
    args,
    options: {
      baseline: { type: "string", default: "feat/robinhood-chain" },
      candidate: { type: "string", default: "HEAD" },
      "env-file": { type: "string" },
      "provider-profile": { type: "string", default: "local-private" },
      "output-prefix": {
        type: "string",
        default: "docs/performance/indexer-benchmark-robinhood",
      },
      check: { type: "boolean", default: false },
    },
  });
  const prefix = resolve(root, values["output-prefix"]);
  const output = `${prefix}-comparison.json`;
  const report = {
    protocol: "protocol-visualizer-robinhood-comparison-v2",
    status: "running",
    generatedAt: new Date().toISOString(),
    acceptanceHash: acceptanceHash(),
    runOrder: [
      "baseline",
      "candidate",
      "candidate",
      "baseline",
      "baseline",
      "candidate",
    ],
  };
  writeResult(output, report);
  let child;
  let envPath;
  let cancelled = false;
  const interrupt = () => {
    cancelled = true;
    child?.kill("SIGINT");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const expected = {
      baseline: resolveRef(values.baseline),
      candidate: resolveRef(values.candidate),
    };
    if (!values.check) {
      for (const side of ["baseline", "candidate"])
        writeResult(`${prefix}-${side}.json`, {
          protocol: "protocol-visualizer-indexer-queued-benchmark-v2",
          status: "running",
          runs: [],
          requestedRuns: 3,
        });
      assert.ok(values["env-file"], "missing private environment file");
      const refs = expected;
      const directory = join(root, "benchmarks", `robinhood-${randomUUID()}`);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      envPath = join(directory, "env.private");
      writeFileSync(envPath, readFileSync(resolve(values["env-file"])), {
        mode: 0o600,
      });
      const records = { baseline: [], candidate: [] };
      for (const [index, side] of report.runOrder.entries()) {
        if (cancelled) throw new Error("interrupted");
        console.log(
          `Matched trial ${index + 1}/6: ${side} ${refs[side].slice(0, 7)}`
        );
        const path = join(directory, `${index + 1}.json`);
        const argv = [
          join(root, "scripts/benchmark-indexer.mjs"),
          "--ref",
          refs[side],
          "--runs",
          "1",
          "--queued-admission",
          "--env-file",
          envPath,
          "--provider-profile",
          values["provider-profile"],
          "--output",
          path,
        ];
        if (report.runOrder.lastIndexOf(side) === index)
          argv.push("--oracle-ref", refs.baseline);
        child = spawn(process.execPath, argv, { cwd: root, stdio: "inherit" });
        const exit = await new Promise((accept) => {
          child.once("exit", (code) => accept(code));
          child.once("error", () => accept(null));
        });
        child = undefined;
        if (exit !== 0) throw new Error("trial_failed");
        records[side].push({ ...json(path), trialIndex: index + 1 });
      }
      for (const side of ["baseline", "candidate"])
        writeResult(
          `${prefix}-${side}.json`,
          aggregate(records[side], report.acceptanceHash)
        );
    }
    const baseline = json(`${prefix}-baseline.json`);
    const candidate = json(`${prefix}-candidate.json`);
    assert.equal(
      report.acceptanceHash,
      acceptanceHash(),
      "acceptance implementation changed during measurement"
    );
    Object.assign(report, checkPair(baseline, candidate, expected), {
      status: "success",
      baseline: baseline.source,
      candidate: candidate.source,
      baselineSummary: baseline.summary,
      candidateSummary: candidate.summary,
    });
    console.log(
      `Accepted: ${report.throughputGainPercent.toFixed(1)}% higher throughput; ${report.timeReductionPercent.toFixed(1)}% less time.`
    );
  } catch {
    report.status = "failed";
    report.failure = "matched_replay_or_acceptance_failed";
    console.error(
      "Matched benchmark failed; no speedup percentage is accepted. Inspect the private trial/audit diagnostics."
    );
    process.exitCode = 1;
  } finally {
    if (envPath) {
      try {
        unlinkSync(envPath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          report.status = "failed";
          report.failure = "private_input_cleanup_failed";
          process.exitCode = 1;
        }
      }
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    writeResult(output, report);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv.slice(2));
