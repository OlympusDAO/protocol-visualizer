import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { arch, cpus, platform, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "docs/performance/indexer-benchmark.json";
const networks = [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532];
export function auditEnvironment(env, proxyOrigin) {
  return {
    ...env,
    ...Object.fromEntries(
      networks.map((chain) => [
        `ENVIO_RPC_URL_${chain}`,
        `${proxyOrigin}/pv/evm/${chain}`,
      ])
    ),
  };
}
const cacheEntities = new Set([
  "VerifiedDeployment",
  "KernelReadCache",
  "KernelReadEpoch",
]);
const protocol = "protocol-visualizer-indexer-benchmark-v1";
export const nativeWorkerRanges = [
  { chainId: 1, start: 26_240_000, end: 26_260_000 },
  { chainId: 42161, start: 516_540_000, end: 516_560_000 },
  { chainId: 8453, start: 52_850_000, end: 52_870_000 },
  { chainId: 10, start: 158_450_000, end: 158_470_000 },
];
const nativeProtocol = "protocol-visualizer-native-workers-v2";
const capacityProtocol = "protocol-visualizer-native-capacity-v1";
const capacitySweepProtocol = "protocol-visualizer-native-capacity-sweep-v2";
export const currentStateProtocol =
  "protocol-visualizer-robinhood-current-state-v4";
export const currentStateEntities =
  "BridgeConfiguration ChainObservation Contract ContractRelationship ContractState ControlTransition CurrentModule CurrentRoleAssignee HeartTasks KernelExecutor Role RoleAssignment".split(
    " "
  );
const getterHistoryProtocol = "protocol-visualizer-getter-history-v1";
export const getterHistoryRanges = [
  { chainId: 80094, start: 780_011, end: 1_530_001 },
];
const getterHistoryEntities =
  "ActionExecutedEvent BridgeConfiguration ChainObservation Contract ContractEvent ContractRelationship ContractState ContractStateSeed ControlTransition CurrentModule CurrentRoleAssignee HeartTasks KernelExecutor KernelExecutorEvent KernelReadCache KernelReadEpoch Role RoleAssignment RoleEvent VerifiedDeployment".split(
    " "
  );
const currentEthereumRange = [
  { chainId: 1, start: 26_240_000, end: 26_290_000 },
];
const selectedRanges = (options) =>
  options.currentState && !options.currentHoldout
    ? currentEthereumRange
    : options.getterHistory
      ? getterHistoryRanges
      : options.nativeWorkers
        ? nativeWorkerRanges
        : [{ chainId: 1, start: options.start, end: options.end }];
const queuedProtocol = "protocol-visualizer-indexer-queued-benchmark-v2";
const image = "protocol-visualizer/rpc-cache:local";
const pgImage = "postgres:17-alpine";
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class BenchmarkFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compareText(a, b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}

export const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const bytesDigest = (value) => createHash("sha256").update(value).digest("hex");
const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const pause = (ms) => new Promise((accept) => setTimeout(accept, ms));

export function parseOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      ...Object.fromEntries(
        [
          "ref",
          "runs",
          "output",
          "compare",
          "compare-ref",
          "env-file",
          "start",
          "end",
          "provider-profile",
          "oracle-ref",
          "native-workers",
          "rpc-credits",
        ].map((name) => [name, { type: "string" }])
      ),
      "install-deps": { type: "boolean", default: false },
      "queued-admission": { type: "boolean", default: false },
      "compare-capacity": { type: "boolean", default: false },
      "capacity-sweep": { type: "boolean", default: false },
      "getter-history": { type: "boolean", default: false },
      "current-state": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const currentState = values["current-state"];
  const getterHistory = values["getter-history"];
  const result = {
    currentState,
    currentHoldout: currentState && values["native-workers"] !== undefined,
    nativeWorkers:
      values["native-workers"] === undefined
        ? getterHistory || currentState
          ? 1
          : undefined
        : Number(values["native-workers"]),
    rpcCredits:
      values["rpc-credits"] === undefined
        ? getterHistory || currentState
          ? 100
          : undefined
        : Number(values["rpc-credits"]),
    compareCapacity: values["compare-capacity"],
    capacitySweep: values["capacity-sweep"],
    getterHistory,
    ref: values.ref ?? "HEAD",
    runs: Number(values.runs ?? 3),
    output: values.output ?? defaultOutput,
    compare: values.compare,
    compareRef: values["compare-ref"],
    envFile: values["env-file"],
    installDeps: values["install-deps"],
    queuedAdmission: values["queued-admission"] || currentState,
    oracleRef: values["oracle-ref"],
    start: Number(
      values.start ??
        (getterHistory ? getterHistoryRanges[0].start : 26_240_000)
    ),
    end: Number(
      values.end ?? (getterHistory ? getterHistoryRanges[0].end : 26_290_000)
    ),
    providerProfile: values["provider-profile"] ?? "unspecified",
  };
  if (
    (result.oracleRef && !currentState) ||
    (currentState &&
      (!result.oracleRef ||
        result.nativeWorkers !== 1 ||
        result.rpcCredits !== 100 ||
        result.compareCapacity ||
        result.capacitySweep ||
        values["queued-admission"] ||
        values["getter-history"])) ||
    (result.getterHistory &&
      (values["native-workers"] !== undefined ||
        values["rpc-credits"] !== undefined ||
        result.capacitySweep ||
        result.compareCapacity)) ||
    (result.nativeWorkers !== undefined &&
      (![1, 2, 4].includes(result.nativeWorkers) ||
        values.start !== undefined ||
        values.end !== undefined ||
        (result.queuedAdmission && !currentState))) ||
    (result.rpcCredits !== undefined &&
      (!result.nativeWorkers ||
        !(result.capacitySweep ? [100, 150, 200] : [50, 100]).includes(
          result.rpcCredits
        ))) ||
    (result.capacitySweep &&
      (result.nativeWorkers !== 4 ||
        ![100, 150, 200].includes(result.rpcCredits))) ||
    (result.compareCapacity && !result.compare) ||
    !Number.isSafeInteger(result.runs) ||
    result.runs < 1 ||
    result.runs > 10 ||
    !Number.isSafeInteger(result.start) ||
    !Number.isSafeInteger(result.end) ||
    result.start < 1 ||
    result.end < result.start ||
    (result.compare && result.compareRef) ||
    !/^[A-Za-z0-9][A-Za-z0-9_./~^{}@-]{0,127}$/.test(result.ref) ||
    !/^[A-Za-z0-9_.-]{1,64}$/.test(result.providerProfile)
  )
    throw new BenchmarkFailure("invalid_arguments");
  return result;
}

export function fixtureConfig(
  text,
  start,
  end,
  ranges = [{ chainId: 1, start, end }]
) {
  const parts = text.split("\nchains:\n");
  if (parts.length !== 2)
    throw new BenchmarkFailure("unsupported_chain_config");
  const sections = parts[1].split(/(?=^ {2}- id: )/m);
  const selected = ranges.map(({ chainId, start, end }) => {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start
    )
      throw new BenchmarkFailure("invalid_range");
    const matches = sections.filter(
      (section) => section.match(/^ {2}- id: (\d+)\s/)?.[1] === String(chainId)
    );
    if (matches.length !== 1)
      throw new BenchmarkFailure("missing_fixture_chain");
    const chain = matches[0];
    if (
      (chain.match(/^ {4}start_block: \d+$/gm) ?? []).length !== 1 ||
      !chain.includes(`\${ENVIO_RPC_URL_${chainId}}`) ||
      (chain.match(/^ {8}for: /gm) ?? []).length !== 1
    )
      throw new BenchmarkFailure("unsupported_fixture_config");
    return chain
      .replace(/^ {4}end_block: .*\n/gm, "")
      .replace(
        /^ {4}start_block: \d+$/m,
        `    start_block: ${start}\n    end_block: ${end}`
      )
      .replace(
        /^ {8}start_block: (\d+)$/gm,
        (_, number) => `        start_block: ${Math.max(start, Number(number))}`
      )
      .replace(/^ {8}for: .*$/m, "        for: fallback");
  });
  return `${parts[0]}\nchains:\n${selected.join("")}`;
}

export function entityDigests(name, rows) {
  const ordered = rows.toSorted((a, b) =>
    compareText(String(a.id), String(b.id))
  );
  const normalized = ordered.map((row) => {
    if (
      !["Contract", "ContractEvent"].includes(name) ||
      !Array.isArray(row.policyFunctions)
    )
      return row;
    if (row.policyFunctions.some((item) => typeof item?.selector !== "string"))
      throw new BenchmarkFailure("unrecognized_policy_functions");
    return {
      ...row,
      policyFunctions: row.policyFunctions.toSorted((a, b) =>
        compareText(a.selector, b.selector)
      ),
    };
  });
  return {
    count: rows.length,
    exact: digest(ordered),
    semantic: digest(normalized),
  };
}

export const workloadConfigHash = (config) =>
  bytesDigest(config.replace(/^full_batch_size:[^\n]*(?:\n|$)/gm, ""));

export function installedLockMatches(dependencyRoot, lock) {
  const installedLock = join(dependencyRoot, "node_modules/.pnpm/lock.yaml");
  return (
    existsSync(installedLock) &&
    readFileSync(installedLock, "utf8").trim() === lock.trim()
  );
}

export function summarize(runs) {
  const first = runs[0];
  const state = (run) =>
    Object.fromEntries(
      Object.entries(run.entities).map(([name, row]) => [
        name,
        { count: row.count, semantic: row.semantic },
      ])
    );
  return {
    runCount: runs.length,
    medianCommittedSeconds: median(runs.map((run) => run.committedSeconds)),
    medianBlocksPerSecond: median(runs.map((run) => run.blocksPerSecond)),
    medianProxyRequests: median(
      runs.map((run) =>
        Object.values(run.rpc.proxyRequests).reduce((a, b) => a + b, 0)
      )
    ),
    medianUpstreamRequests: median(
      runs.map((run) =>
        Object.values(run.rpc.upstreamRequests).reduce((a, b) => a + b, 0)
      )
    ),
    stateConsistent: runs.every(
      (run) =>
        digest(state(run)) === digest(state(first)) &&
        run.meta?.eventsProcessed === first.meta?.eventsProcessed &&
        digest(run.chainMeta ?? null) === digest(first.chainMeta ?? null)
    ),
  };
}

export function resultProblems(result) {
  const reasons = [];
  const current = result.protocol === currentStateProtocol;
  const history = result.protocol === getterHistoryProtocol;
  if (
    ![
      protocol,
      queuedProtocol,
      nativeProtocol,
      capacityProtocol,
      capacitySweepProtocol,
      getterHistoryProtocol,
      currentStateProtocol,
    ].includes(result.protocol) ||
    result.schemaVersion !== 1
  )
    reasons.push("protocol mismatch");
  if (result.status !== "success") reasons.push("incomplete or failed result");
  if (result.cleanupComplete !== true)
    reasons.push("resource cleanup incomplete");
  if (!result.inputs || result.inputFingerprint !== digest(result.inputs))
    reasons.push("stale input fingerprint");
  const workload = result.inputs?.workload;
  if (
    !workload ||
    !Number.isSafeInteger(workload.start) ||
    !Number.isSafeInteger(workload.end) ||
    workload.start < 1 ||
    workload.end < workload.start ||
    workload.chainId !== (history ? 80094 : 1) ||
    workload.checkpointInterval !== (current ? null : 10_000) ||
    workload.eventSource !== "HyperSync" ||
    workload.rpcMode !== "fallback"
  )
    reasons.push("invalid workload descriptor");
  const nativeRun = [
    nativeProtocol,
    capacityProtocol,
    capacitySweepProtocol,
    getterHistoryProtocol,
    currentStateProtocol,
  ].includes(result.protocol);
  const expectedRanges = history
    ? getterHistoryRanges
    : current && workload?.chains?.length === 1
      ? currentEthereumRange
      : nativeWorkerRanges;
  if (
    nativeRun &&
    (digest(workload?.chains ?? null) !== digest(expectedRanges) ||
      ![1, 2, 4].includes(result.treatment?.nativeWorkers) ||
      result.treatment.pgMaxConnections !==
        result.treatment.nativeWorkers * 2 ||
      !["shared", "per-chain"].includes(result.source?.storageScope) ||
      (result.treatment.nativeWorkers > 1 &&
        result.source.storageScope !== "per-chain") ||
      !/^[a-f0-9]{64}$/.test(result.source?.configHash ?? ""))
  )
    reasons.push("invalid native worker treatment");
  if (
    result.protocol === getterHistoryProtocol &&
    (result.treatment?.nativeWorkers !== 1 ||
      result.source?.storageScope !== "per-chain" ||
      workload?.start !== getterHistoryRanges[0].start ||
      workload?.end !== getterHistoryRanges[0].end)
  )
    reasons.push("invalid getter history treatment");
  if (
    result.protocol === capacitySweepProtocol &&
    result.treatment?.nativeWorkers !== 4
  )
    reasons.push("invalid capacity sweep worker treatment");
  const totalBlocks = nativeRun
    ? expectedRanges.reduce(
        (sum, range) => sum + range.end - range.start + 1,
        0
      )
    : workload?.end - workload?.start + 1;
  const fixture = result.inputs?.fixture;
  if (
    (result.protocol === queuedProtocol || current) !==
      Boolean(fixture?.queuedAdmission) ||
    (fixture?.queuedAdmission &&
      (!/^[a-f0-9]{64}$/.test(fixture.queuedAdmission.implementation ?? "") ||
        fixture.queuedAdmission.active !== 32 ||
        fixture.queuedAdmission.waiting !== 256 ||
        fixture.queuedAdmission.maxInFlight !== 1024 ||
        fixture.queuedAdmission.deadlineMilliseconds !== 8000))
  )
    reasons.push("invalid admission profile");
  if (
    !(
      result.protocol === capacitySweepProtocol
        ? [100, 150, 200]
        : result.protocol === getterHistoryProtocol || current
          ? [100]
          : result.protocol === capacityProtocol
            ? [50, 100]
            : [50]
    ).includes(fixture?.aggregateCreditsPerSecond) ||
    !Array.isArray(fixture.proxyNetworks) ||
    digest(fixture.proxyNetworks) !== digest(networks) ||
    ![fixture.erpcImageId, fixture.postgresImageId].every((value) =>
      /^sha256:[a-f0-9]{64}$/.test(value ?? "")
    )
  )
    reasons.push("invalid proxy fixture descriptor");
  if (!/^[a-f0-9]{40}$/.test(result.source?.commit ?? ""))
    reasons.push("invalid source identity");
  if (!/^[a-f0-9]{64}$/.test(result.source?.indexerInputHash ?? ""))
    reasons.push("invalid runtime input identity");
  if (
    !/^[a-f0-9]{64}$/.test(result.source?.lockfileHash ?? "") ||
    !Number.isSafeInteger(result.source?.nativeBatchSize) ||
    result.source.nativeBatchSize < 1
  )
    reasons.push("invalid source dependency or batch identity");
  if (
    !Array.isArray(result.runs) ||
    !result.runs.length ||
    result.runs.length !== result.requestedRuns
  )
    reasons.push("no complete runs");
  else {
    for (const run of result.runs) {
      if (
        (result.protocol === queuedProtocol || current) &&
        (!["requests", "capacityRetries", "exhausted"].every(
          (key) =>
            Number.isSafeInteger(run.admission?.[key]) &&
            run.admission[key] >= 0
        ) ||
          !(run.admission?.requests > 0) ||
          run.admission?.exhausted !== 0)
      )
        reasons.push("missing or exhausted admission evidence");
      if (
        nativeRun &&
        (run.chainMeta?.length !== expectedRanges.length ||
          !expectedRanges.every((range) => {
            const meta = run.chainMeta?.find(
              (row) => row.chainId === range.chainId
            );
            return (
              meta?.startBlock === range.start &&
              meta?.endBlock === range.end &&
              meta?.progressBlock === range.end &&
              meta?.isReady === true &&
              Number.isSafeInteger(meta.eventsProcessed) &&
              meta.eventsProcessed >= 0
            );
          }) ||
          !validNativeProfile(run.profile, result.treatment?.nativeWorkers))
      )
        reasons.push("incomplete native worker evidence");
      if (
        !Number.isFinite(run.committedSeconds) ||
        run.committedSeconds <= 0 ||
        !Number.isFinite(run.blocksPerSecond) ||
        run.blocksPerSecond <= 0 ||
        Math.abs(run.blocksPerSecond - totalBlocks / run.committedSeconds) >
          1e-8 ||
        run.exitCode !== 0 ||
        run.meta?.progressBlock !== result.inputs?.workload?.end ||
        run.meta?.startBlock !== result.inputs?.workload?.start ||
        run.meta?.endBlock !== result.inputs?.workload?.end ||
        run.meta?.isReady !== true ||
        !Number.isSafeInteger(run.meta?.eventsProcessed) ||
        run.meta.eventsProcessed < 0 ||
        !(run.source?.hyperSyncGetLogs > 0) ||
        run.source.rpcGetLogs !== 0 ||
        (run.rpc?.proxyRequests?.eth_getLogs ?? 0) !== 0 ||
        ["proxyRequests", "upstreamRequests"].some(
          (key) =>
            !Object.keys(run.rpc?.[key] ?? {}).length ||
            Object.values(run.rpc[key]).some(
              (value) => !Number.isFinite(value) || value < 0
            )
        ) ||
        !Object.keys(run.entities ?? {}).length
      )
        reasons.push("missing durable completion or source evidence");
      if (current) {
        const expected =
          result.source?.observationSchedule === "historical-checkpoints"
            ? getterHistoryEntities.filter((name) => !cacheEntities.has(name))
            : currentStateEntities;
        if (
          digest(Object.keys(run.entities ?? {}).toSorted()) !==
          digest(expected.toSorted())
        )
          reasons.push("incomplete current-state entity coverage");
        if (
          !["historical-checkpoints", "current-endpoint"].includes(
            result.source?.observationSchedule
          ) ||
          result.treatment?.nativeWorkers !== 1 ||
          result.inputs?.fixture?.aggregateCreditsPerSecond !== 100 ||
          run.audit?.protocol !== currentStateProtocol ||
          run.audit?.stateHash !==
            digest(
              Object.fromEntries(
                Object.entries(run.entities ?? {}).map(([name, row]) => [
                  name,
                  row.exact,
                ])
              )
            ) ||
          !run.chainMeta?.every(
            (meta) =>
              Number.isSafeInteger(run.audit?.eventCounts?.[meta.chainId]) &&
              Number.isSafeInteger(run.audit?.blockCallbacks?.[meta.chainId]) &&
              run.audit.eventCounts[meta.chainId] +
                run.audit.blockCallbacks[meta.chainId] ===
                meta.eventsProcessed
          )
        )
          reasons.push("missing current-state audit evidence");
      }
      if (result.protocol === getterHistoryProtocol) {
        if (
          digest(Object.keys(run.entities ?? {}).toSorted()) !==
          digest(getterHistoryEntities.toSorted())
        )
          reasons.push("incomplete getter history entity coverage");
        if (
          !(run.effectCalls?.readControlGetter > 0) ||
          !(run.meta?.eventsProcessed > 0)
        )
          reasons.push("missing getter history work evidence");
        if (
          getterHistoryEntities.some(
            (name) =>
              result.runs[0].entities?.[name]?.exact !==
              run.entities?.[name]?.exact
          )
        )
          reasons.push("getter history exact state differs between runs");
      }
      for (const [name, row] of Object.entries(run.entities ?? {})) {
        if (
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
          !Number.isSafeInteger(row.count) ||
          row.count < 0 ||
          !/^[a-f0-9]{64}$/.test(row.exact ?? "") ||
          !/^[a-f0-9]{64}$/.test(row.semantic ?? "")
        )
          reasons.push("invalid entity digest");
      }
    }
    try {
      const summary = summarize(result.runs);
      if (digest(summary) !== digest(result.summary))
        reasons.push("stale summary");
      if (!summary.stateConsistent) reasons.push("state differs between runs");
    } catch {
      reasons.push("malformed measurements");
    }
  }
  return reasons;
}

export function compareResults(baseline, candidate, { capacity = false } = {}) {
  const reasons = [...resultProblems(baseline), ...resultProblems(candidate)];
  if (
    baseline.protocol === currentStateProtocol ||
    candidate.protocol === currentStateProtocol
  )
    reasons.push("use the audited current-state comparison command");
  if (baseline.protocol !== candidate.protocol)
    reasons.push("protocol mismatch");
  const comparableInputs = (result) =>
    capacity
      ? {
          ...result.inputs,
          fixture: {
            ...result.inputs?.fixture,
            aggregateCreditsPerSecond:
              result.protocol === capacitySweepProtocol ? 100 : 50,
          },
        }
      : result.inputs;
  const baselineCap = baseline.inputs?.fixture?.aggregateCreditsPerSecond;
  const candidateCap = candidate.inputs?.fixture?.aggregateCreditsPerSecond;
  const validCapacityPair =
    (baseline.protocol === capacityProtocol &&
      candidate.protocol === capacityProtocol &&
      baselineCap === 50 &&
      candidateCap === 100) ||
    (baseline.protocol === capacitySweepProtocol &&
      candidate.protocol === capacitySweepProtocol &&
      [100, 150].includes(baselineCap) &&
      [150, 200].includes(candidateCap) &&
      baselineCap < candidateCap);
  if (
    capacity &&
    (!validCapacityPair ||
      digest(baseline.treatment ?? null) !==
        digest(candidate.treatment ?? null) ||
      baseline.source?.indexerInputHash !== candidate.source?.indexerInputHash)
  )
    reasons.push("invalid capacity treatment");
  if (
    digest(comparableInputs(baseline) ?? null) !==
    digest(comparableInputs(candidate) ?? null)
  )
    reasons.push("workload, runtime or fixture mismatch");
  const a = baseline.runs?.[0]?.entities ?? {};
  const b = candidate.runs?.[0]?.entities ?? {};
  const addedOrRemovedCaches = [];
  const orderingOnly = [];
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    if (!a[name] || !b[name]) {
      if (
        cacheEntities.has(name) &&
        ![
          nativeProtocol,
          capacityProtocol,
          capacitySweepProtocol,
          getterHistoryProtocol,
        ].includes(baseline.protocol)
      )
        addedOrRemovedCaches.push(name);
      else reasons.push(`entity coverage differs: ${name}`);
    } else if (
      a[name].count !== b[name].count ||
      a[name].semantic !== b[name].semantic
    ) {
      reasons.push(`entity state differs: ${name}`);
    } else if (a[name].exact !== b[name].exact) {
      if (baseline.protocol === getterHistoryProtocol)
        reasons.push(`entity exact state differs: ${name}`);
      else orderingOnly.push(name);
    }
  }
  if (
    baseline.runs?.[0]?.meta?.eventsProcessed !==
      candidate.runs?.[0]?.meta?.eventsProcessed ||
    digest(baseline.runs?.[0]?.chainMeta ?? null) !==
      digest(candidate.runs?.[0]?.chainMeta ?? null)
  )
    reasons.push("processed event counts differ");
  return {
    compatible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    addedOrRemovedCaches,
    orderingOnly,
    throughputGainPercent: reasons.length
      ? null
      : 100 *
        (candidate.summary.medianBlocksPerSecond /
          baseline.summary.medianBlocksPerSecond -
          1),
  };
}

export function writeResult(path, result) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`
  );
  let formatted = `${JSON.stringify(result, null, 2)}\n`;
  try {
    formatted = execFileSync(
      process.execPath,
      [
        join(root, "node_modules/@biomejs/biome/bin/biome"),
        "format",
        "--stdin-file-path=indexer-benchmark.json",
      ],
      {
        input: JSON.stringify(result),
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 10_000,
      }
    );
  } catch {
    // Result invalidation must work before dependencies or formatting are ready.
  }
  writeFileSync(temporary, formatted);
  renameSync(temporary, path);
}

function command(name, args, cwd = root, log, env) {
  try {
    return execFileSync(name, args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (log) appendFileSync(log, `${error.stdout ?? ""}${error.stderr ?? ""}`);
    throw new BenchmarkFailure(
      `${basename(name).replaceAll(/[^a-z0-9]/gi, "_")}_command_failed`
    );
  }
}

const git = (...args) => command("git", args).trim();
const resolveRef = (ref) =>
  git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`);

export function runtimeHash(commit) {
  const tree = git(
    "ls-tree",
    "-r",
    commit,
    "--",
    "apps/indexer",
    "packages",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml"
  );
  return bytesDigest(
    tree
      .split("\n")
      .filter((line) => {
        const path = line.split("\t")[1];
        return (
          path &&
          (!path.startsWith("apps/indexer/") ||
            /^apps\/indexer\/(src\/|abis\/|config\.yaml$|schema\.graphql$|package\.json$|tsconfig\.json$)/.test(
              path
            ))
        );
      })
      .join("\n")
  );
}

export function assertProofInputClean() {
  const paths = [
    "apps/indexer/src",
    "apps/indexer/abis",
    "apps/indexer/config.yaml",
    "apps/indexer/schema.graphql",
    "apps/indexer/package.json",
    "apps/indexer/tsconfig.json",
    "packages",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ];
  if (
    git("diff", "--name-only", "--no-ext-diff", "HEAD", "--", ...paths) ||
    git("ls-files", "--others", "--exclude-standard", "--", ...paths)
  )
    throw new BenchmarkFailure("uncommitted_audit_runtime_inputs");
}

function metric(text, name, label, allowed = /^[A-Za-z0-9_.-]{1,64}$/) {
  const values = {};
  for (const line of text.split("\n")) {
    if (!line.startsWith(`${name}{`)) continue;
    const labels = Object.fromEntries(
      [...line.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [
        match[1],
        match[2],
      ])
    );
    const key = allowed.test(labels[label] ?? "") ? labels[label] : "other";
    const value = Number(line.slice(line.lastIndexOf(" ") + 1));
    if (Number.isFinite(value) && value >= 0)
      values[key] = (values[key] ?? 0) + value;
  }
  return values;
}

export function proxyMetrics(status, text) {
  if (status < 200 || status >= 300)
    throw new BenchmarkFailure("proxy_metrics_http_failure");
  const rpc = Object.fromEntries(
    Object.entries({
      proxyRequests: "erpc_network_request_received_total",
      upstreamRequests: "erpc_upstream_request_total",
      capacityRejections: "erpc_rate_limits_total",
      failedProxyRequests: "erpc_network_failed_request_total",
      cacheHits: "erpc_cache_get_success_hit_total",
    }).map(([key, name]) => [
      key,
      metric(text, name, "category", /^eth_[A-Za-z0-9_]{1,64}$/),
    ])
  );
  if (
    !Object.keys(rpc.proxyRequests).length ||
    !Object.keys(rpc.upstreamRequests).length
  )
    throw new BenchmarkFailure("proxy_metrics_missing_required_counters");
  rpc.attemptOutcomes = metric(
    text,
    "erpc_upstream_attempt_outcome_total",
    "outcome",
    /^[a-z_]{1,64}$/
  );
  rpc.unreportedOptionalCounters = [
    "capacityRejections",
    "failedProxyRequests",
    "cacheHits",
    "attemptOutcomes",
  ].filter((key) => !Object.keys(rpc[key]).length);
  return rpc;
}

async function freePort() {
  const server = createServer();
  await new Promise((accept, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", accept)
  );
  const port = server.address().port;
  await new Promise((accept) => server.close(accept));
  return port;
}

function cleanEnv() {
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "TMP",
      "TEMP",
      "LANG",
      "LC_ALL",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "NODE_EXTRA_CA_CERTS",
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]])
  );
}

async function stopChild(child, exit) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await Promise.race([exit, pause(15_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await exit;
  }
}

async function installDependencies(snapshot, log, cancelled) {
  console.log(
    "Installing frozen dependencies in an isolated snapshot, outside timing."
  );
  const fd = openSync(log, "w", 0o600);
  const child = spawn(
    "pnpm",
    [
      "install",
      "--frozen-lockfile",
      "--store-dir",
      join(snapshot, ".pnpm-store"),
    ],
    {
      cwd: snapshot,
      env: { ...cleanEnv(), CI: "true" },
      stdio: ["ignore", fd, fd],
      detached: true,
    }
  );
  let completed;
  const exit = new Promise((accept) => {
    const finish = (code, signal) => {
      completed = { code, signal };
      accept(completed);
    };
    child.once("exit", finish);
    child.once("error", () => finish(null, "spawn_error"));
  });
  const started = performance.now();
  try {
    while (!completed) {
      if (cancelled()) throw new BenchmarkFailure("interrupted");
      if (performance.now() - started > 600_000)
        throw new BenchmarkFailure("isolated_install_timeout");
      await pause(250);
    }
    if (completed.code !== 0)
      throw new BenchmarkFailure(
        "isolated_frozen_install_failed_see_private_logs"
      );
  } finally {
    await stopChild(child, exit);
    closeSync(fd);
  }
}

async function collectRun(options, setup, runNumber, cancelled) {
  const id = `pv-indexer-benchmark-${randomUUID()}`;
  const temp = mkdtempSync(join(tmpdir(), "pv-indexer-benchmark-"));
  const logs = join(setup.logs, String(runNumber));
  mkdirSync(logs, { mode: 0o700 });
  const commandLog = join(logs, "commands.private.log");
  writeFileSync(commandLog, "", { mode: 0o600 });
  const docker = (...args) => command("docker", args, root, commandLog).trim();
  const created = [];
  let networkCreated = false;
  let database;
  let child;
  let exit;
  let spawnFailed = false;
  let logFd;
  let admission;
  try {
    if (cancelled()) throw new BenchmarkFailure("interrupted");
    const source = join(temp, "source");
    mkdirSync(source);
    command("tar", ["-xf", setup.archive, "-C", source], root, commandLog);
    for (const path of ["node_modules", "apps/indexer/node_modules"])
      symlinkSync(join(setup.dependencyRoot, path), join(source, path), "dir");
    writeFileSync(join(source, "apps/indexer/config.yaml"), setup.config);
    const password = randomUUID();
    networkCreated = true;
    docker("network", "create", id);
    const pg = `${id}-pg`;
    created.push(pg);
    docker(
      "run",
      "-d",
      "--name",
      pg,
      "--network",
      id,
      "--tmpfs",
      "/var/lib/postgresql/data",
      "-p",
      "127.0.0.1::5432",
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      "POSTGRES_DB=indexer",
      setup.pgImageId
    );
    const pgPort = Number(docker("port", pg, "5432/tcp").split(":").at(-1));
    database = setup.Postgres({
      host: "127.0.0.1",
      port: pgPort,
      username: "postgres",
      password,
      database: "indexer",
      max: 2,
      connect_timeout: 2,
      onnotice: () => {},
    });
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        await database.unsafe("SELECT 1");
        ready = true;
        break;
      } catch {
        await pause(1000);
      }
    }
    if (!ready) throw new BenchmarkFailure("postgres_not_ready");
    await database.unsafe("CREATE DATABASE rpc_cache");
    const envPath = join(temp, "erpc.env");
    const proxyEnv = Object.fromEntries(
      networks.map((chain) => [
        `UPSTREAM_RPC_URL_${chain}`,
        process.env[`UPSTREAM_RPC_URL_${chain}`],
      ])
    );
    Object.assign(proxyEnv, {
      RPC_CACHE_DATABASE_URL: `postgresql://postgres:${password}@${pg}:5432/rpc_cache`,
      RPC_CACHE_MAX_RPS: String(options.rpcCredits ?? 50),
    });
    writeFileSync(
      envPath,
      `${Object.entries(proxyEnv)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`,
      { mode: 0o600 }
    );
    const proxy = `${id}-erpc`;
    created.push(proxy);
    docker(
      "run",
      "-d",
      "--name",
      proxy,
      "--network",
      id,
      "--env-file",
      envPath,
      "-p",
      "127.0.0.1::4000",
      "-p",
      "127.0.0.1::4001",
      setup.erpcImageId
    );
    const proxyOrigin = `http://127.0.0.1:${docker("port", proxy, "4000/tcp").split(":").at(-1)}`;
    const metricsUrl = `http://127.0.0.1:${docker("port", proxy, "4001/tcp").split(":").at(-1)}/metrics`;
    ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        if (
          (
            await fetch(`${proxyOrigin}/healthcheck`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {}
      await pause(1000);
    }
    if (!ready) throw new BenchmarkFailure("proxy_not_ready");
    if (options.queuedAdmission) {
      const { queuedAdmission } = await import(
        "./benchmark-indexer-admission.mjs"
      );
      admission = await queuedAdmission(proxyOrigin);
    }
    const origin = admission?.origin ?? proxyOrigin;
    const probe = join(temp, "probe.mjs");
    const profilePath = join(temp, "profile.json");
    writeFileSync(probe, setup.probe);
    const metricsPort = await freePort();
    const env = {
      ...cleanEnv(),
      ...Object.fromEntries(
        ["ENVIO_API_TOKEN", "ETHERSCAN_API_KEY"].map((key) => [
          key,
          process.env[key],
        ])
      ),
      ENVIO_RPC_MODE: "fallback",
      ENVIO_TUI: "false",
      ENVIO_HASURA: "false",
      ENVIO_PG_HOST: "127.0.0.1",
      ENVIO_PG_PORT: String(pgPort),
      ENVIO_PG_USER: "postgres",
      ENVIO_PG_PASSWORD: password,
      ENVIO_PG_DATABASE: "indexer",
      ENVIO_PG_SSL_MODE: "false",
      ...(options.nativeWorkers
        ? {
            ENVIO_PG_MAX_CONNECTIONS: String(options.nativeWorkers * 2),
            PV_BENCHMARK_NATIVE_WORKERS: "true",
          }
        : {}),
      ENVIO_INDEXER_PORT: String(metricsPort),
      ENVIO_THROTTLE_CHAIN_METADATA_INTERVAL_MILLIS: "500",
      LOG_STRATEGY: "ecs-console",
      LOG_LEVEL: "warn",
      PV_BENCHMARK_RPC_ORIGIN: origin,
      PV_BENCHMARK_PROBE_OUTPUT: profilePath,
      ...Object.fromEntries(
        networks.map((chain) => [
          `ENVIO_RPC_URL_${chain}`,
          `${origin}/pv/evm/${chain}`,
        ])
      ),
    };
    const metadataCode = `const C=await import(${JSON.stringify(pathToFileURL(join(source, "apps/indexer/node_modules/envio/src/Config.res.mjs")).href)});const c=C.load();console.log(JSON.stringify({batchSize:c.batchSize,entities:c.userEntities.map(e=>e.name),defaultCrossChain:c.defaultCrossChain}));`;
    const metadata = JSON.parse(
      command(
        process.execPath,
        ["--input-type=module", "-e", metadataCode],
        join(source, "apps/indexer"),
        commandLog,
        env
      )
    );
    if (
      setup.source.nativeBatchSize !== null &&
      metadata.batchSize !== setup.source.nativeBatchSize
    )
      throw new BenchmarkFailure("batch_size_changed");
    setup.source.nativeBatchSize = metadata.batchSize;
    if (options.nativeWorkers)
      setup.source.storageScope = metadata.defaultCrossChain
        ? "shared"
        : "per-chain";
    const indexerLog = join(logs, "indexer.private.log");
    logFd = openSync(indexerLog, "w", 0o600);
    const started = performance.now();
    child = spawn(
      process.execPath,
      [
        "--import",
        probe,
        join(source, "apps/indexer/node_modules/envio/bin.mjs"),
        "start",
      ],
      {
        cwd: join(source, "apps/indexer"),
        env,
        stdio: ["ignore", logFd, logFd],
        detached: true,
      }
    );
    exit = new Promise((accept) => {
      child.once("exit", (code, signal) => accept({ code, signal }));
      child.once("error", () => {
        spawnFailed = true;
        accept({ code: null, signal: "spawn_error" });
      });
    });
    let meta;
    let chainMeta;
    const ranges = selectedRanges(options);
    const readMeta = () =>
      database.unsafe(
        'SELECT "chainId", "startBlock", "endBlock", "progressBlock", "eventsProcessed", "isReady" FROM _meta ORDER BY "chainId"'
      );
    const complete = () =>
      ranges.every((range) =>
        chainMeta?.some(
          (row) =>
            row.chainId === range.chainId &&
            row.progressBlock === range.end &&
            row.isReady === true
        )
      );
    let committedSeconds;
    let envioMetrics = "";
    let lastUpdate = 0;
    while (performance.now() - started < 1_200_000) {
      if (cancelled()) throw new BenchmarkFailure("interrupted");
      if (spawnFailed) throw new BenchmarkFailure("indexer_spawn_failed");
      try {
        const response = await fetch(
          `http://127.0.0.1:${metricsPort}/metrics`,
          { signal: AbortSignal.timeout(500) }
        );
        if (response.ok) envioMetrics = await response.text();
      } catch {}
      try {
        chainMeta = await readMeta();
        meta = chainMeta.find((row) => row.chainId === ranges[0].chainId);
      } catch {}
      if (complete() && committedSeconds === undefined)
        committedSeconds = (performance.now() - started) / 1000;
      if (child.exitCode !== null || child.signalCode !== null) break;
      if (
        committedSeconds !== undefined &&
        (performance.now() - started) / 1000 - committedSeconds > 15
      )
        throw new BenchmarkFailure("indexer_did_not_exit_after_commit");
      if (performance.now() - started - lastUpdate > 30_000) {
        console.log(
          `Run ${runNumber}/${options.runs}: committed ${meta?.progressBlock ?? "pending"}`
        );
        lastUpdate = performance.now() - started;
      }
      await pause(250);
    }
    if (child.exitCode === null && child.signalCode === null)
      throw new BenchmarkFailure("indexer_timeout");
    const finished = await exit;
    chainMeta = await readMeta();
    meta = chainMeta.find((row) => row.chainId === ranges[0].chainId);
    if (complete() && committedSeconds === undefined)
      committedSeconds = (performance.now() - started) / 1000;
    if (
      finished.code !== 0 ||
      !complete() ||
      meta.isReady !== true ||
      committedSeconds === undefined
    )
      throw new BenchmarkFailure("indexer_did_not_complete");
    if (admission) {
      await admission.close();
      if (admission.stats.exhausted !== 0)
        throw new BenchmarkFailure("admission_recovery_exhausted");
    }
    const metricsResponse = await fetch(metricsUrl, {
      signal: AbortSignal.timeout(3000),
    });
    const rpc = proxyMetrics(
      metricsResponse.status,
      await metricsResponse.text()
    );
    const sourceRequests = envioMetrics
      .split("\n")
      .filter((line) => line.startsWith("envio_source_request_total{"));
    const sourceEvidence = { hyperSyncGetLogs: 0, rpcGetLogs: 0 };
    for (const line of sourceRequests) {
      if (!line.includes('method="getLogs"')) continue;
      const count = Number(line.slice(line.lastIndexOf(" ") + 1));
      if (line.includes('source="HyperSync"'))
        sourceEvidence.hyperSyncGetLogs += count;
      else sourceEvidence.rpcGetLogs += count;
    }
    if (
      !sourceEvidence.hyperSyncGetLogs ||
      sourceEvidence.rpcGetLogs ||
      rpc.proxyRequests.eth_getLogs
    )
      throw new BenchmarkFailure("event_source_not_hypersync");
    const entities = {};
    const state = {};
    for (const name of metadata.entities) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw new BenchmarkFailure("invalid_entity_name");
      state[name] = await database.unsafe(`SELECT * FROM "${name}"`);
      entities[name] = entityDigests(name, state[name]);
    }
    writeFileSync(join(logs, "state.private.json"), JSON.stringify(state), {
      mode: 0o600,
    });
    const profile = readProfile(profilePath, options.nativeWorkers);
    writeFileSync(
      join(logs, "completed.private.json"),
      JSON.stringify({
        committedSeconds,
        meta,
        rpc,
        entities,
        profile,
      }),
      { mode: 0o600 }
    );
    let audit;
    if (options.oracleRef) {
      assertProofInputClean();
      console.log(
        `Run ${runNumber}/${options.runs}: independent post-timing audit`
      );
      const auditOutput = join(logs, "audit.private.json");
      const auditLog = openSync(join(logs, "audit.private.log"), "w", 0o600);
      try {
        child = spawn(
          process.execPath,
          [
            "--import",
            join(root, "apps/indexer/scripts/typescript-loader.mjs"),
            join(root, "scripts/benchmark-indexer-current.mjs"),
            "--audit",
            "--state",
            join(logs, "state.private.json"),
            "--output",
            auditOutput,
            "--source",
            source,
            "--oracle-source",
            setup.oracleSource,
            "--identity",
            JSON.stringify(setup.auditIdentity),
          ],
          {
            cwd: join(source, "apps/indexer"),
            env: auditEnvironment(env, proxyOrigin),
            stdio: ["ignore", auditLog, auditLog],
            detached: true,
          }
        );
        exit = new Promise((accept) => {
          child.once("exit", (code, signal) => accept({ code, signal }));
          child.once("error", () => {
            spawnFailed = true;
            accept({ code: null });
          });
        });
        const auditStart = performance.now();
        while (child.exitCode === null && child.signalCode === null) {
          if (
            spawnFailed ||
            cancelled() ||
            performance.now() - auditStart > 900_000
          )
            throw new BenchmarkFailure("audit_interrupted_or_timeout");
          await pause(250);
        }
        if ((await exit).code !== 0)
          throw new BenchmarkFailure("independent_audit_failed");
        audit = JSON.parse(readFileSync(auditOutput, "utf8"));
      } finally {
        closeSync(auditLog);
      }
    }
    const record = {
      committedSeconds,
      blocksPerSecond:
        ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0) /
        committedSeconds,
      ...(options.nativeWorkers ? { chainMeta } : {}),
      exitCode: finished.code,
      meta,
      source: sourceEvidence,
      rpc,
      effectWindowWaitSeconds: metric(
        envioMetrics,
        "envio_effect_queue_wait_seconds",
        "effect"
      ),
      effectCalls: metric(envioMetrics, "envio_effect_call_total", "effect"),
      entities,
      ...(admission ? { admission: { ...admission.stats } } : {}),
      ...(audit ? { audit } : {}),
      profile,
    };
    console.log(
      `Run ${runNumber}/${options.runs}: ${record.blocksPerSecond.toFixed(1)} committed blocks/s`
    );
    return record;
  } finally {
    let cleanupFailed = false;
    try {
      await stopChild(child, exit);
    } catch {
      cleanupFailed = true;
    }
    try {
      if (admission) await admission.close();
    } catch {
      cleanupFailed = true;
    }
    try {
      if (logFd !== undefined) closeSync(logFd);
    } catch {
      cleanupFailed = true;
    }
    try {
      if (database) await database.end({ timeout: 5 });
    } catch {
      cleanupFailed = true;
    }
    for (const container of created.toReversed()) {
      if (container.endsWith("-erpc")) {
        try {
          writeFileSync(
            join(logs, "erpc.private.log"),
            docker("logs", container),
            { mode: 0o600 }
          );
        } catch {}
      }
      try {
        docker("rm", "-f", container);
      } catch {
        cleanupFailed = true;
      }
    }
    if (networkCreated) {
      try {
        docker("network", "rm", id);
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      rmSync(temp, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
    setup.cleanup.failed ||= cleanupFailed;
  }
}

function validNativeProfile(profile, workers) {
  const rows = profile?.processes;
  if (
    !Array.isArray(rows) ||
    rows.length !== (workers === 1 ? 1 : workers + 1) ||
    profile.processCount !== rows.length ||
    profile.workerCount !== (workers === 1 ? 0 : workers) ||
    rows.filter((row) => row.nativeWorker === true).length !==
      profile.workerCount
  )
    return false;
  return (
    rows.every(
      (row) =>
        typeof row.nativeWorker === "boolean" &&
        [row.cpuMicroseconds?.user, row.cpuMicroseconds?.system].every(
          (n) => Number.isFinite(n) && n >= 0
        ) &&
        Number.isFinite(row.maxRssKilobytes) &&
        row.maxRssKilobytes > 0
    ) &&
    profile.cpuMicroseconds ===
      rows.reduce(
        (sum, row) =>
          sum + row.cpuMicroseconds.user + row.cpuMicroseconds.system,
        0
      ) &&
    profile.sumProcessPeakRssKilobytes ===
      rows.reduce((sum, row) => sum + row.maxRssKilobytes, 0)
  );
}

function readProfile(path, nativeWorkers) {
  if (!nativeWorkers) return JSON.parse(readFileSync(path, "utf8"));
  const prefix = `${basename(path)}.`;
  const processes = readdirSync(dirname(path))
    .filter((name) => name.startsWith(prefix))
    .map((name) => JSON.parse(readFileSync(join(dirname(path), name), "utf8")));
  const workerCount = processes.filter((row) => row.nativeWorker).length;
  if (
    workerCount !== (nativeWorkers === 1 ? 0 : nativeWorkers) ||
    processes.length !== (nativeWorkers === 1 ? 1 : nativeWorkers + 1)
  )
    throw new BenchmarkFailure("native_process_count_mismatch");
  return {
    processCount: processes.length,
    workerCount,
    cpuMicroseconds: processes.reduce(
      (sum, row) => sum + row.cpuMicroseconds.user + row.cpuMicroseconds.system,
      0
    ),
    sumProcessPeakRssKilobytes: processes.reduce(
      (sum, row) => sum + row.maxRssKilobytes,
      0
    ),
    processes,
  };
}

async function runBenchmark(options) {
  const output = resolve(root, options.output);
  const result = {
    protocol: options.currentState
      ? currentStateProtocol
      : options.getterHistory
        ? getterHistoryProtocol
        : options.capacitySweep
          ? capacitySweepProtocol
          : options.rpcCredits !== undefined
            ? capacityProtocol
            : options.nativeWorkers
              ? nativeProtocol
              : options.queuedAdmission
                ? queuedProtocol
                : protocol,
    ...(options.nativeWorkers
      ? {
          treatment: {
            nativeWorkers: options.nativeWorkers,
            pgMaxConnections: options.nativeWorkers * 2,
          },
        }
      : {}),
    schemaVersion: 1,
    status: "running",
    generatedAt: new Date().toISOString(),
    requestedRuns: options.runs,
    source: null,
    inputs: null,
    runs: [],
  };
  writeResult(output, result);
  let temporary;
  const cleanup = { failed: false };
  let cancelled = false;
  const interrupt = () => {
    cancelled = true;
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    if (options.envFile) process.loadEnvFile(resolve(options.envFile));
    const required = [
      "ENVIO_API_TOKEN",
      "ETHERSCAN_API_KEY",
      ...networks.map((chain) => `UPSTREAM_RPC_URL_${chain}`),
    ];
    const missing = required.filter((key) => !process.env[key]?.trim());
    if (missing.length) {
      result.missingInputs = missing;
      throw new BenchmarkFailure("missing_credentials");
    }
    for (const chain of networks) {
      const value = process.env[`UPSTREAM_RPC_URL_${chain}`];
      if (!/^https?:\/\/[^\s]+$/.test(value) || /[\r\n]/.test(value))
        throw new BenchmarkFailure("invalid_upstream_url");
    }
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8")
    );
    const pinnedNode = readFileSync(join(root, ".node-version"), "utf8").trim();
    const pnpm = command("pnpm", ["--version"]).trim();
    if (
      process.versions.node !== pinnedNode ||
      manifest.packageManager !== `pnpm@${pnpm}`
    )
      throw new BenchmarkFailure("activate_pinned_runtime");
    const commit = resolveRef(options.ref);
    result.source = {
      ref: options.ref,
      commit,
      indexerInputHash: runtimeHash(commit),
    };
    const lock = git("show", `${commit}:pnpm-lock.yaml`);
    result.source.lockfileHash = bytesDigest(lock);
    result.source.nativeBatchSize = null;
    if (
      !options.installDeps &&
      lock !== readFileSync(join(root, "pnpm-lock.yaml"), "utf8").trim()
    )
      throw new BenchmarkFailure(
        "ref_lockfile_differs_use_--install-deps_for_isolated_frozen_install"
      );
    if (!existsSync(join(root, "apps/indexer/node_modules/envio/bin.mjs")))
      throw new BenchmarkFailure("install_dependencies_first");
    const config = fixtureConfig(
      `${git("show", `${commit}:apps/indexer/config.yaml`)}\n`,
      options.start,
      options.end,
      selectedRanges(options)
    );
    if (
      (options.nativeWorkers > 1 || options.getterHistory) &&
      !/^disable_default_cross_chain: true$/m.test(config)
    )
      throw new BenchmarkFailure("native_storage_required");
    const handler = git("show", `${commit}:apps/indexer/src/EventHandlers.ts`);
    result.source.configHash = bytesDigest(config);
    const historical =
      /name: `control-checkpoint-\$\{chainId\}`[\s\S]{0,400}_every: 10_000/.test(
        handler
      );
    if (options.currentState) {
      if (
        !historical &&
        !(
          handler.includes("createLiveObservation") &&
          handler.includes("FULL_VERIFICATION_VERSION")
        )
      )
        throw new BenchmarkFailure("unknown_current_state_schedule");
      result.source.observationSchedule = historical
        ? "historical-checkpoints"
        : "current-endpoint";
      const functionalMetadata = JSON.parse(
        git(
          "show",
          `${commit}:apps/indexer/src/generated/contract-metadata.json`
        )
      );
      for (const contracts of Object.values(functionalMetadata))
        for (const contract of Object.values(contracts))
          for (const field of [
            "ordinaryDeployment",
            "immutableDeployment",
            "deploymentDiscovery",
          ])
            delete contract[field];
      result.source.functionalMetadataHash = digest(functionalMetadata);
      result.source.transportHash = bytesDigest(
        git("show", `${commit}:apps/indexer/src/events/rpc.ts`)
      );
    } else if (!historical)
      throw new BenchmarkFailure("checkpoint_protocol_changed");
    temporary = mkdtempSync(join(tmpdir(), "pv-indexer-benchmark-source-"));
    const archive = join(temporary, "source.tar");
    command("git", ["archive", "--format=tar", `--output=${archive}`, commit]);
    let oracleSource;
    let auditIdentity;
    if (options.oracleRef) {
      const oracleCommit = resolveRef(options.oracleRef);
      auditIdentity = {
        oracleCommit,
        oracleInputHash: runtimeHash(oracleCommit),
        proofCommit: resolveRef("HEAD"),
        proofInputHash: runtimeHash(resolveRef("HEAD")),
        implementation: bytesDigest(
          readFileSync(join(root, "scripts/benchmark-indexer-current.mjs"))
        ),
        loaderHash: bytesDigest(
          readFileSync(join(root, "apps/indexer/scripts/typescript-loader.mjs"))
        ),
        effectRuntimeHash: bytesDigest(
          readFileSync(
            join(root, "apps/indexer/scripts/fixtures/effect-runtime.mjs")
          )
        ),
      };
      if (git("show", `${oracleCommit}:pnpm-lock.yaml`) !== lock)
        throw new BenchmarkFailure("oracle_dependency_mismatch");
      const oracleArchive = join(temporary, "oracle.tar");
      oracleSource = join(temporary, "oracle");
      mkdirSync(oracleSource);
      command("git", [
        "archive",
        "--format=tar",
        `--output=${oracleArchive}`,
        oracleCommit,
      ]);
      command("tar", ["-xf", oracleArchive, "-C", oracleSource]);
      for (const path of ["node_modules", "apps/indexer/node_modules"])
        symlinkSync(join(root, path), join(oracleSource, path), "dir");
    }
    const diagnosticId = `indexer-${randomUUID()}`;
    const logs = join(root, "benchmarks", diagnosticId);
    mkdirSync(logs, { recursive: true, mode: 0o700 });
    result.diagnosticId = diagnosticId;
    let dependencyRoot = root;
    if (options.installDeps) {
      dependencyRoot = join(temporary, "dependencies");
      mkdirSync(dependencyRoot);
      command("tar", ["-xf", archive, "-C", dependencyRoot]);
      const targetManifest = JSON.parse(
        readFileSync(join(dependencyRoot, "package.json"), "utf8")
      );
      if (targetManifest.packageManager !== `pnpm@${pnpm}`)
        throw new BenchmarkFailure("target_requires_different_pnpm_runtime");
      await installDependencies(
        dependencyRoot,
        join(logs, "install.private.log"),
        () => cancelled
      );
      if (
        readFileSync(join(dependencyRoot, "pnpm-lock.yaml"), "utf8").trim() !==
        lock
      )
        throw new BenchmarkFailure("isolated_install_changed_lockfile");
      if (
        !existsSync(
          join(dependencyRoot, "apps/indexer/node_modules/envio/bin.mjs")
        )
      )
        throw new BenchmarkFailure("isolated_dependencies_missing_envio");
    }
    result.source.dependencies = options.installDeps
      ? "isolated-frozen-install"
      : "reused-matching-lockfile";
    if (!installedLockMatches(dependencyRoot, lock))
      throw new BenchmarkFailure(
        "installed_lockfile_differs_run_frozen_install_or_use_--install-deps"
      );
    const erpcImageId = command("docker", [
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      image,
    ]).trim();
    const pgImageId = command("docker", [
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      pgImage,
    ]).trim();
    if (
      ![erpcImageId, pgImageId].every((value) =>
        /^sha256:[a-f0-9]{64}$/.test(value)
      )
    )
      throw new BenchmarkFailure("invalid_image_identity");
    const require = createRequire(join(root, "apps/indexer/package.json"));
    const Postgres = require(
      require.resolve("postgres", { paths: [require.resolve("envio")] })
    );
    const probe = readFileSync(
      join(root, "scripts/benchmark-indexer-probe.mjs"),
      "utf8"
    );
    const inputs = {
      driverHash: bytesDigest(readFileSync(fileURLToPath(import.meta.url))),
      probeHash: bytesDigest(probe),
      runtime: {
        node: process.versions.node,
        pnpm,
        platform: platform(),
        arch: arch(),
        logicalCpus: cpus().length,
      },
      workload: {
        ...selectedRanges(options)[0],
        ...(options.nativeWorkers ? { chains: selectedRanges(options) } : {}),
        checkpointInterval: options.currentState ? null : 10_000,
        ...(options.currentState
          ? {
              baselineConfigHash: workloadConfigHash(
                fixtureConfig(
                  `${git("show", `${resolveRef(options.oracleRef)}:apps/indexer/config.yaml`)}\n`,
                  options.start,
                  options.end,
                  selectedRanges(options)
                )
              ),
            }
          : {
              configHash: workloadConfigHash(
                options.nativeWorkers && !options.getterHistory
                  ? config.replace(/^disable_default_cross_chain:.*\n/gm, "")
                  : config
              ),
            }),
        eventSource: "HyperSync",
        rpcMode: "fallback",
      },
      fixture: {
        erpcImageId,
        postgresImageId: pgImageId,
        aggregateCreditsPerSecond: options.rpcCredits ?? 50,
        proxyNetworks: networks,
        ...(options.queuedAdmission
          ? {
              queuedAdmission: {
                implementation: bytesDigest(
                  readFileSync(
                    join(root, "scripts/benchmark-indexer-admission.mjs")
                  )
                ),
                active: 32,
                waiting: 256,
                maxInFlight: 1024,
                deadlineMilliseconds: 8000,
              },
            }
          : {}),
      },
      providerProfile: options.providerProfile,
    };
    result.inputs = inputs;
    result.inputFingerprint = digest(inputs);
    for (let run = 1; run <= options.runs; run++) {
      result.runs.push(
        await collectRun(
          options,
          {
            archive,
            config,
            probe,
            erpcImageId,
            pgImageId,
            Postgres,
            logs,
            cleanup,
            dependencyRoot,
            source: result.source,
            oracleSource,
            auditIdentity,
          },
          run,
          () => cancelled
        )
      );
      if (cleanup.failed)
        throw new BenchmarkFailure(
          "owned_resource_cleanup_failed_see_private_logs"
        );
      writeResult(output, result);
    }
    result.summary = summarize(result.runs);
    if (!result.summary.stateConsistent)
      throw new BenchmarkFailure("state_varied_between_runs");
    result.status = "success";
    if (options.getterHistory || options.currentState) {
      const problems = resultProblems({
        ...result,
        cleanupComplete: !cleanup.failed,
      });
      if (problems.length) {
        result.validationProblems = problems;
        throw new BenchmarkFailure("getter_history_contract_failed");
      }
    }
    console.log(
      `Median: ${result.summary.medianBlocksPerSecond.toFixed(1)} committed blocks/s; ${result.summary.medianCommittedSeconds.toFixed(3)} seconds.`
    );
  } catch (error) {
    result.status = "failed";
    result.failure =
      error instanceof BenchmarkFailure
        ? error.code
        : "unexpected_failure_see_private_logs";
    process.exitCode = 1;
    console.error(`Indexer benchmark failed: ${result.failure}`);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    result.cleanupComplete = !cleanup.failed;
    writeResult(output, result);
  }
}

function comparisonReport(options) {
  const candidate = JSON.parse(
    readFileSync(resolve(root, options.output), "utf8")
  );
  let baseline;
  const stale = [];
  if (options.compareRef) {
    const commit = resolveRef(options.compareRef);
    baseline = JSON.parse(git("show", `${commit}:${defaultOutput}`));
    if (baseline.source?.indexerInputHash !== runtimeHash(commit))
      stale.push("baseline result predates runtime changes");
  } else baseline = JSON.parse(readFileSync(resolve(options.compare), "utf8"));
  if (
    baseline.source?.indexerInputHash !==
    runtimeHash(resolveRef(baseline.source?.commit ?? "invalid"))
  )
    stale.push("baseline runtime fingerprint does not match its commit");
  if (
    candidate.source?.indexerInputHash !== runtimeHash(resolveRef(options.ref))
  )
    stale.push("candidate result predates runtime changes");
  const comparison = compareResults(baseline, candidate, {
    capacity: options.compareCapacity,
  });
  if (stale.length || !comparison.compatible) {
    console.log(
      `Comparison withheld: ${[...stale, ...comparison.reasons].join("; ")}.`
    );
    process.exitCode = 1;
    return;
  }
  console.log("| Metric | Baseline | Candidate |\n| --- | ---: | ---: |");
  for (const [label, a, b] of [
    [
      "Commit",
      baseline.source.commit.slice(0, 12),
      candidate.source.commit.slice(0, 12),
    ],
    ["Runs", baseline.runs.length, candidate.runs.length],
    [
      "Aggregate RPC credits/second",
      baseline.inputs.fixture.aggregateCreditsPerSecond,
      candidate.inputs.fixture.aggregateCreditsPerSecond,
    ],
    [
      "Native batch size",
      baseline.source.nativeBatchSize,
      candidate.source.nativeBatchSize,
    ],
    [
      "Median committed seconds",
      baseline.summary.medianCommittedSeconds.toFixed(3),
      candidate.summary.medianCommittedSeconds.toFixed(3),
    ],
    [
      "Median blocks/second",
      baseline.summary.medianBlocksPerSecond.toFixed(1),
      candidate.summary.medianBlocksPerSecond.toFixed(1),
    ],
    [
      "Median proxy RPC items",
      baseline.summary.medianProxyRequests,
      candidate.summary.medianProxyRequests,
    ],
    [
      "Median upstream requests",
      baseline.summary.medianUpstreamRequests,
      candidate.summary.medianUpstreamRequests,
    ],
  ])
    console.log(`| ${label} | ${a} | ${b} |`);
  console.log(
    `\n${options.compareCapacity ? "Capacity experiment throughput" : "Throughput"} change: ${comparison.throughputGainPercent >= 0 ? "+" : ""}${comparison.throughputGainPercent.toFixed(1)}%. Shared entity values and provenance match.`
  );
  if (comparison.addedOrRemovedCaches.length)
    console.log(
      `Cache entity coverage differs: ${comparison.addedOrRemovedCaches.join(", ")}.`
    );
  if (comparison.orderingOnly.length)
    console.log(
      `Exact ordering differs only in normalized policyFunctions: ${comparison.orderingOnly.join(", ")}.`
    );
  if (baseline.runs.length < 3 || candidate.runs.length < 3)
    console.log(
      "Scout comparison: fewer than three runs; repeat before acceptance."
    );
}

export async function main(args) {
  if (args.includes("--help")) {
    console.log(
      "Finite cap sweep: --capacity-sweep --native-workers 4 --rpc-credits 100|150|200; compare ordered caps with --compare FILE --compare-capacity. This uses a separate v2 protocol."
    );
    console.log(
      "Usage: pnpm benchmark:indexer [--ref HEAD] [--runs 3] [--env-file FILE] [--output FILE] [--start BLOCK --end BLOCK] [--provider-profile LABEL] [--install-deps]\nNative worker experiment: --native-workers 1|2|4 (fixed four-chain workload; PostgreSQL connection budgets 2|4|8). Capacity profile: add --rpc-credits 50|100; compare with --compare FILE --compare-capacity.\nQueued recovery profile: --queued-admission. Current-state comparison: pnpm benchmark:indexer:current --baseline BASE_COMMIT; --oracle-ref is only supported with --current-state.\nCompare saved results without Docker or credentials: pnpm benchmark:indexer --compare-ref BRANCH | --compare FILE\nRequires pinned Node/pnpm, installed driver dependencies, prebuilt rpc-cache/Postgres images, ENVIO_API_TOKEN, ETHERSCAN_API_KEY and all nine UPSTREAM_RPC_URL_<chain> values. Matching lockfiles reuse installed dependencies; --install-deps explicitly installs frozen dependencies in an isolated snapshot before timing. Uses fresh local containers/databases and a 50-credit eRPC default; the optional local capacity profile permits 100. Private logs: benchmarks/<diagnosticId>/."
    );
    return;
  }
  let options;
  try {
    options = parseOptions(args);
  } catch {
    if (!args.some((argument) => /^--compare(?:-ref)?(?:=|$)/.test(argument))) {
      const index = args.indexOf("--output");
      const inline = args.find((argument) => argument.startsWith("--output="));
      const output =
        inline?.slice("--output=".length) ??
        (index >= 0 ? args[index + 1] : undefined) ??
        defaultOutput;
      writeResult(resolve(root, output), {
        protocol,
        schemaVersion: 1,
        status: "failed",
        failure: "invalid_arguments",
        runs: [],
      });
    }
    console.error("Invalid benchmark arguments; use --help.");
    process.exitCode = 1;
    return;
  }
  if (options.compare || options.compareRef) {
    try {
      comparisonReport(options);
    } catch {
      console.error(
        "Comparison unavailable: check result files, source refs and protocol compatibility."
      );
      process.exitCode = 1;
    }
  } else await runBenchmark(options);
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  await main(process.argv.slice(2));
