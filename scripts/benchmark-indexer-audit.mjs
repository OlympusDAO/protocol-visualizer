import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as pause } from "node:timers/promises";
import {
  digest,
  fixtureConfig,
  runtimeHash,
  assertProofInputClean,
} from "./benchmark-indexer.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/indexer/package.json"));
const viem = require("viem");
const yaml = require(
  require.resolve("yaml", { paths: [require.resolve("envio")] })
);
const zero = `0x${"0".repeat(40)}`;
export const getterless = [
  "1:0xa5588e518ce5ee0e4628c005e4edabd5e87de3ad:newOwner",
  "1:0xb22764f98dd05c789929716d677382df22c05cb6:newOwner",
];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const load = (directory, path) =>
  import(pathToFileURL(join(directory, path)).href);
const same = (a, b) => assert.equal(digest(a), digest(b));
const implementationHash = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex");
async function proofAvailable(read) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      if (
        ![429, 500, 502, 503, 504].includes(error.status) &&
        !["TypeError", "TimeoutError", "AbortError"].includes(error.name)
      )
        throw error;
    }
    if (attempt < 2) await pause(1000 * (attempt + 1));
  }
  throw new Error(
    "verification source proof unavailable after bounded recovery"
  );
}

export function subscriptions(config) {
  const chain = config.chains.find((chain) => chain.id === 1);
  const entries = [];
  for (const contract of chain.contracts) {
    const definition = config.contracts.find(
      (item) => item.name === contract.name
    );
    for (const address of [contract.address].flat()) {
      for (const item of definition.events ?? []) {
        const event = viem.parseAbiItem(`event ${item.event}`);
        entries.push({
          address: address.toLowerCase(),
          from: Math.max(
            chain.start_block,
            contract.start_block ?? chain.start_block
          ),
          contract: contract.name,
          event,
          topic: viem.toEventSelector(event),
        });
      }
    }
  }
  return entries;
}

export async function audit(options) {
  assertProofInputClean();
  assert.equal(runtimeHash("HEAD"), options.identity.proofInputHash);
  for (const [field, path] of [
    ["loaderHash", "apps/indexer/scripts/typescript-loader.mjs"],
    ["effectRuntimeHash", "apps/indexer/scripts/fixtures/effect-runtime.mjs"],
  ]) {
    assert.equal(
      options.identity[field],
      createHash("sha256")
        .update(readFileSync(join(root, path)))
        .digest("hex")
    );
  }
  assert.equal(options.identity.implementation, implementationHash);
  const state = readJson(options.state);
  const measuredConfig = readFileSync(
    join(options.source, "apps/indexer/config.yaml"),
    "utf8"
  );
  const config = yaml.parse(measuredConfig);
  const chain = config.chains.find((chain) => chain.id === 1);
  const start = chain.start_block;
  const end = chain.end_block;
  assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end));
  const configs = [options.oracleSource, root].map((directory) =>
    yaml.parse(
      fixtureConfig(
        readFileSync(join(directory, "apps/indexer/config.yaml"), "utf8"),
        start,
        end
      )
    )
  );
  assert.ok(
    configs.some((expected) => digest(expected) === digest(config)),
    "measured config mismatch"
  );
  const added =
    "OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)";
  const reduced = structuredClone(configs[1]);
  const owned = reduced.contracts.find((item) => item.name === "Owned");
  assert.equal(owned.events.filter((item) => item.event === added).length, 1);
  owned.events = owned.events.filter((item) => item.event !== added);
  same(configs[0], reduced);
  for (const directory of [options.oracleSource, root]) {
    const handler = readFileSync(
      join(directory, "apps/indexer/src/EventHandlers.ts"),
      "utf8"
    );
    assert.equal((handler.match(/indexer\.onBlock\(/g) ?? []).length, 4);
    assert.deepEqual(
      [...handler.matchAll(/_every: ([\d_]+)/g)].map((m) => m[1]),
      ["10_000", "100"]
    );
    for (const name of ["seed", "checkpoint", "realtime", "end"])
      assert.ok(handler.includes(`name: \`control-${name}-`));
  }
  const { getPublicClient } = await load(
    root,
    "apps/indexer/src/events/rpc.ts"
  );
  // Transport recovery only: base readers never enter indexer effects/entities.
  const client = getPublicClient(1);
  const headers = new Map();
  const block = async (number) => {
    const key = String(number);
    if (!headers.has(key))
      headers.set(
        key,
        client.getBlock({ blockNumber: BigInt(number) }).then((header) => ({
          number: header.number.toString(),
          hash: header.hash.toLowerCase(),
          timestamp: header.timestamp.toString(),
        }))
      );
    return headers.get(key);
  };
  const canonical = async (value) => {
    assert.match(value.hash, /^0x[0-9a-f]{64}$/);
    same(
      { number: value.number, hash: value.hash, timestamp: value.timestamp },
      await block(value.number)
    );
  };
  const current = await block(end);
  same(state.ChainObservation[0].indexedThrough, current);
  const visit = async (value) => {
    if (!value || typeof value !== "object") return;
    if (
      Object.hasOwn(value, "number") &&
      Object.hasOwn(value, "hash") &&
      Object.hasOwn(value, "timestamp")
    ) {
      await canonical(value);
      return;
    }
    for (const item of Object.values(value)) await visit(item);
  };
  await visit(state);

  const sets = configs.map(subscriptions);
  const all = sets.flat();
  const addresses = [...new Set(all.map((item) => item.address))];
  const topics = [...new Set(all.map((item) => item.topic))];
  const raw = [];
  for (let from = start; from <= end; from += 5000) {
    raw.push(
      ...(await client.request({
        method: "eth_getLogs",
        params: [
          {
            fromBlock: viem.numberToHex(from),
            toBlock: viem.numberToHex(Math.min(end, from + 4999)),
            address: addresses,
            topics: [topics],
          },
        ],
      }))
    );
  }
  raw.sort(
    (a, b) =>
      Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) ||
      Number(BigInt(a.logIndex) - BigInt(b.logIndex))
  );
  const manifests = sets.map((entries) =>
    raw.flatMap((log) =>
      entries
        .filter(
          (item) =>
            item.address === log.address.toLowerCase() &&
            item.topic === log.topics[0] &&
            BigInt(log.blockNumber) >= BigInt(item.from)
        )
        .map((item) => ({
          contract: item.contract,
          event: item.event.name,
          address: item.address,
          blockNumber: BigInt(log.blockNumber).toString(),
          blockHash: log.blockHash,
          transactionHash: log.transactionHash,
          logIndex: Number(BigInt(log.logIndex)),
          topics: log.topics,
          data: log.data,
          args: viem.decodeEventLog({
            abi: [item.event],
            data: log.data,
            topics: log.topics,
          }).args,
        }))
    )
  );
  same(manifests[0], manifests[1]);
  const logs = manifests[1];
  const { getCcipRegistry } = await load(
    root,
    "apps/indexer/src/events/ownership-contracts.ts"
  );
  const registry = getCcipRegistry(1);
  assert.equal(
    logs.filter((log) => log.event === "OwnershipTransferStarted").length,
    0
  );
  // ponytail: reject effective dynamic registrations; irrelevant registry tokens do not register pools.
  assert.equal(
    logs.filter(
      (log) =>
        (log.event === "AuthorityUpdated" &&
          log.args.authority.toLowerCase() !== zero) ||
        (log.event === "PoolSet" &&
          log.args.token.toLowerCase() === registry.token.toLowerCase() &&
          log.args.newPool.toLowerCase() !== zero)
    ).length,
    0
  );
  for (const log of logs)
    assert.equal((await block(log.blockNumber)).hash, log.blockHash);
  const kernelLogs = logs.filter((log) => log.contract === "Kernel");
  const actions = [
    "installModule",
    "upgradeModule",
    "activatePolicy",
    "deactivatePolicy",
    "changeExecutor",
    "migrateKernel",
  ];
  const nativeActions = state.ActionExecutedEvent.filter(
    (row) =>
      BigInt(row.blockNumber) >= BigInt(start) &&
      BigInt(row.blockNumber) <= BigInt(end)
  );
  const actionProjection = (row) => ({
    kernel: row.kernel.toLowerCase(),
    transactionHash: row.transactionHash,
    logIndex: row.logIndex,
    blockNumber: row.blockNumber,
    action: row.action,
    target: row.target.toLowerCase(),
  });
  same(
    nativeActions
      .map(actionProjection)
      .toSorted((a, b) => a.logIndex - b.logIndex),
    kernelLogs
      .map((log) => ({
        kernel: log.address,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        action: actions[Number(log.args.action_)],
        target: log.args.target_.toLowerCase(),
      }))
      .toSorted((a, b) => a.logIndex - b.logIndex)
  );
  for (const log of logs.filter((item) => item.contract !== "Kernel")) {
    if (
      log.contract === "TokenAdminRegistry" &&
      log.args.token &&
      log.args.token.toLowerCase() !== registry.token.toLowerCase()
    )
      continue;
    assert.ok(
      ["OwnershipTransferRequested", "AdministratorTransferRequested"].includes(
        log.event
      ),
      "unimplemented event audit"
    );
    const matches = state.ControlTransition.filter(
      (row) =>
        row.transactionHash === log.transactionHash &&
        row.logIndex === log.logIndex
    );
    assert.equal(matches.length, 1);
    const transition = matches[0];
    assert.equal(transition.address, log.address);
    assert.equal(transition.blockHash, log.blockHash);
    assert.equal(transition.blockNumber, log.blockNumber);
    assert.equal(
      transition.value.address,
      (log.args.to ?? log.args.newAdmin).toLowerCase()
    );
  }
  assert.equal(
    state.ControlTransition.filter(
      (row) =>
        BigInt(row.blockNumber) >= BigInt(start) &&
        BigInt(row.blockNumber) <= BigInt(end)
    ).length,
    logs.filter(
      (log) =>
        log.contract !== "Kernel" &&
        !(
          log.contract === "TokenAdminRegistry" &&
          log.args.token &&
          log.args.token.toLowerCase() !== registry.token.toLowerCase()
        )
    ).length
  );

  const { readPinnedControlGetter } = await load(
    options.oracleSource,
    "apps/indexer/src/events/control-reads.ts"
  );
  const { readPinnedModuleDependencies } = await load(
    options.oracleSource,
    "apps/indexer/src/events/module-dependencies.ts"
  );
  const { getKernelConstants } = await load(
    root,
    "apps/indexer/src/constants.ts"
  );
  const { getImmutableDeployment, getOrdinaryDeployment, getDeploymentFact } =
    await load(root, "apps/indexer/src/events/deployment-facts.ts");
  const { reuseKernelRead, kernelReadProof } = await load(
    root,
    "apps/indexer/src/events/kernel-reuse.ts"
  );
  const { getOwnershipEventPolicy, policyCoversGetter } = await load(
    root,
    "apps/indexer/src/events/ownership-policy.ts"
  );
  const { makeEffectRuntime } = await load(
    root,
    "apps/indexer/scripts/fixtures/effect-runtime.mjs"
  );
  const { fetchVerifiedContract } = await load(
    root,
    "apps/indexer/src/services/contracts/abi.ts"
  );
  const runtime = await makeEffectRuntime();
  const context = { effect: (effect, input) => runtime.effect(effect, input) };
  for (const [name, rows] of Object.entries(state)) {
    const map = new Map(rows.map((row) => [row.id, row]));
    context[name] = {
      get: async (id) => map.get(id),
      set: () => {
        throw new Error("audit_must_not_seed_entities");
      },
    };
  }
  const kernel = getKernelConstants(1).address.toLowerCase();
  const getterReads = new Map();
  const getter = async (address, name, at) => {
    const key = `${address}:${name}:${at.hash}`;
    if (!getterReads.has(key))
      getterReads.set(
        key,
        readPinnedControlGetter(client, {
          chainId: 1,
          address,
          getter: name,
          blockNumber: BigInt(at.number),
          blockHash: at.hash,
        })
      );
    return getterReads.get(key);
  };
  const dependencies = new Map();
  const dependency = async (keycode, at) => {
    const key = `${keycode}:${at.hash}`;
    if (!dependencies.has(key))
      dependencies.set(
        key,
        readPinnedModuleDependencies(client, {
          kernel,
          keycode,
          blockNumber: BigInt(at.number),
          blockHash: at.hash,
        })
      );
    const result = await dependencies.get(key);
    assert.equal(result.status, "success");
    return result;
  };
  const codeHashes = new Map();
  const codeHash = async (address) => {
    if (!codeHashes.has(address))
      codeHashes.set(
        address,
        client
          .request({
            method: "eth_getCode",
            params: [
              address,
              { blockHash: current.hash, requireCanonical: true },
            ],
          })
          .then((code) => {
            assert.ok(
              typeof code === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(code),
              "invalid code observation"
            );
            return viem.keccak256(code);
          })
      );
    return codeHashes.get(address);
  };
  const deployments = new Map();
  const ownershipCoverage = async (row) => {
    const policy = getOwnershipEventPolicy(1, row.subject);
    if (!policy || !policyCoversGetter(policy, row.getter)) return undefined;
    const required =
      policy.profile === "chainlink-token-admin-registry"
        ? [
            "OwnershipTransferred",
            "OwnershipTransferRequested",
            "AdministratorTransferred",
            "AdministratorTransferRequested",
            "PoolSet",
          ]
        : policy.profile === "solmate-owned"
          ? ["OwnershipTransferred"]
          : [];
    assert.ok(required.length, "unimplemented ownership audit profile");
    for (const event of required)
      assert.ok(
        sets[1].some(
          (item) => item.address === row.subject && item.event.name === event
        )
      );
    assert.equal(await codeHash(row.subject), policy.codeHash);
    return policy;
  };
  const observations = [];
  for (const row of state.ContractRelationship) {
    const at = row.verification?.block;
    assert.ok(at, "missing getter verification block");
    let fresh;
    let observed;
    let proof;
    let targetCode;
    const coverageProof = await ownershipCoverage(row);
    if (row.getter.startsWith("moduleDependents:")) {
      const keycode = row.getter.split(":")[1];
      const result = await dependency(keycode, current);
      fresh = result.policies.includes(row.subject) ? result.module : zero;
      const prior = await dependency(keycode, at);
      observed = prior.policies.includes(row.subject) ? prior.module : zero;
    } else {
      const result = await getter(row.subject, row.getter, current);
      if (getterless.includes(row.id)) {
        assert.equal(result.status, "unavailable");
        assert.equal(
          result.reason,
          "Pending owner has no public getter; only replayed transfer requests establish the nominee."
        );
        assert.equal(row.verification.outcome, "unavailable");
        const verified = await proofAvailable(() =>
          fetchVerifiedContract(1, row.subject)
        );
        assert.equal(verified.address.toLowerCase(), row.subject);
        assert.equal(String(verified.chainId), "1");
        assert.ok(["match", "exact_match"].includes(verified.runtimeMatch));
        const runtimeHash = viem.keccak256(
          verified.runtimeBytecode.onchainBytecode
        );
        assert.equal(runtimeHash, await codeHash(row.subject));
        const abi = verified.metadata.output.abi;
        assert.ok(
          abi.some((item) => item.type === "function" && item.name === "owner")
        );
        assert.equal(
          abi.filter(
            (item) =>
              item.type === "fallback" ||
              (item.type === "function" &&
                ["newOwner", "pendingOwner"].includes(item.name))
          ).length,
          0
        );
        for (const [path, item] of Object.entries(verified.metadata.sources)) {
          assert.equal(
            viem.keccak256(viem.stringToHex(verified.sources[path].content)),
            item.keccak256
          );
        }
        assert.ok(
          Object.values(verified.sources).some((source) =>
            /address\s+private\s+\w*[Pp]ending[Oo]wner\s*;/.test(source.content)
          )
        );
        let reverted = false;
        try {
          await client.call({
            to: row.subject,
            data: viem.toFunctionSelector("newOwner()"),
            blockHash: current.hash,
            requireCanonical: true,
          });
        } catch (error) {
          const seen = new Set();
          for (
            let cause = error;
            cause && !seen.has(cause) && seen.size < 16;
            cause = cause.cause
          ) {
            seen.add(cause);
            if (cause.code === 3 || cause.name === "ExecutionRevertedError")
              reverted = true;
          }
        }
        assert.ok(
          reverted,
          "private getter exception must be a verified EVM revert"
        );
        let nominee = null;
        for (const log of logs.filter((log) => log.address === row.subject)) {
          if (log.event === "OwnershipTransferRequested")
            nominee = log.args.to.toLowerCase();
          if (log.event === "OwnershipTransferred") nominee = zero;
        }
        assert.equal(row.value, nominee);
        observations.push({
          id: row.id,
          kind: "getterless",
          value: nominee,
          coverageProof,
          getterlessProof: {
            codeHash: runtimeHash,
            sourceHash: digest(verified.metadata.sources),
            noFallback: true,
            reverted: true,
          },
        });
        continue;
      }
      assert.equal(result.status, "success", `oracle failed ${row.id}`);
      fresh = result.value;
      targetCode =
        (await codeHash(fresh)) === viem.keccak256("0x") ? "absent" : "present";
      const prior = await getter(row.subject, row.getter, at);
      assert.equal(prior.status, "success");
      observed = prior.value;
    }
    assert.equal(fresh, row.value, `current value differs ${row.id}`);
    assert.equal(
      observed,
      row.verification.getterValue,
      `recorded read differs ${row.id}`
    );
    if (row.targetCode) assert.equal(row.targetCode, targetCode);
    const policy = coverageProof;
    if (row.verification.eventReplay) {
      assert.ok(
        BigInt(at.number) >= BigInt(start),
        "ownership anchor precedes log manifest"
      );
      const replay = row.verification.eventReplay;
      assert.ok(policy && policyCoversGetter(policy, row.getter));
      same(policy, {
        profile: replay.profile,
        version: replay.version,
        codeHash: replay.codeHash,
      });
      same(at, replay.block);
      let replayed = observed;
      const stream = logs.filter(
        (log) =>
          log.address === row.subject &&
          BigInt(log.blockNumber) > BigInt(at.number)
      );
      for (const log of stream) {
        const args = log.args;
        if (row.getter === "owner" && log.event === "OwnershipTransferred")
          replayed = args.newOwner ?? args.to;
        const token = row.getter.split(":")[1];
        if (args.token && args.token.toLowerCase() !== token) continue;
        if (
          row.getter.startsWith("administrator:") &&
          log.event === "AdministratorTransferred"
        )
          replayed = args.newAdmin;
        if (row.getter.startsWith("newAdministrator:")) {
          if (log.event === "AdministratorTransferRequested")
            replayed = args.newAdmin;
          if (log.event === "AdministratorTransferred") replayed = zero;
        }
        if (row.getter.startsWith("getPool:") && log.event === "PoolSet")
          replayed = args.newPool;
      }
      assert.equal(replayed.toLowerCase(), row.value);
      proof = { kind: "ownership", block: at, policy };
    } else if (BigInt(at.number) < BigInt(end)) {
      const address = row.getter.startsWith("moduleDependents:")
        ? kernel
        : row.subject;
      const kernelProof = kernelReadProof({
        chainId: 1,
        address,
        getter: row.getter,
      });
      const cacheId =
        kernelProof &&
        `1:${kernelProof.address}:${kernelProof.codeHash}:${row.getter}:v1`;
      if (
        cacheId &&
        state.KernelReadCache?.some((item) => item.id === cacheId)
      ) {
        assert.ok(
          BigInt(at.number) >= BigInt(start),
          "Kernel anchor precedes log manifest"
        );
        assert.equal(await codeHash(address), kernelProof.codeHash);
        assert.equal(
          kernelLogs.filter(
            (log) => BigInt(log.blockNumber) > BigInt(at.number)
          ).length,
          0
        );
        const result = await reuseKernelRead(
          context,
          { chainId: 1, address, getter: row.getter, block: current },
          async () => {
            throw new Error("kernel_fact_ineligible");
          },
          () => codeHash(address),
          block
        );
        assert.equal(result.status, "success");
        same(result.verifiedAt, at);
        if (row.getter.startsWith("moduleDependents:")) {
          const actual = await dependency(row.getter.split(":")[1], current);
          same(result.policies, actual.policies);
          assert.equal(result.module, actual.module);
        } else assert.equal(result.value, row.value);
        proof = {
          kind: "kernel",
          block: at,
          cacheId,
          codeHash: kernelProof.codeHash,
        };
      } else {
        if (!deployments.has(address))
          deployments.set(
            address,
            proofAvailable(async () =>
              getImmutableDeployment(
                context,
                {
                  chainId: 1,
                  address,
                  blockNumber: BigInt(end),
                  blockHash: current.hash,
                },
                await codeHash(address)
              )
            )
          );
        const descriptor = await deployments.get(address);
        assert.ok(descriptor, "missing immutable proof");
        const fact = await getDeploymentFact(
          context,
          {
            chainId: 1,
            address,
            blockNumber: BigInt(end),
            blockHash: current.hash,
            data: viem.toFunctionSelector(`${row.getter}()`),
          },
          descriptor
        );
        assert.ok(fact?.data, "immutable lifetime proof failed");
        same(fact.verifiedAt, at);
        assert.equal(`0x${fact.data.slice(-40)}`, row.value);
        assert.equal(descriptor.codeHash, await codeHash(address));
        proof = { kind: "immutable", block: at, descriptor };
      }
    }
    observations.push({
      id: row.id,
      kind: "readable",
      value: fresh,
      observed,
      targetCode,
      proof,
      coverageProof,
    });
  }
  for (const keycode of new Set(
    state.ContractRelationship.filter(
      (row) => row.kind === "module-dependency"
    ).map((row) => row.getter.split(":")[1])
  )) {
    const result = await dependency(keycode, current);
    same(
      result.policies.toSorted(),
      state.ContractRelationship.filter(
        (row) =>
          row.getter === `moduleDependents:${keycode}` && row.value !== zero
      )
        .map((row) => row.subject)
        .toSorted()
    );
  }
  const seedObservations = [];
  for (const seed of state.ContractStateSeed) {
    let value;
    if (seed.getter.startsWith("moduleDependents:")) {
      const result = await dependency(seed.getter.split(":")[1], seed.boundary);
      value = result.policies.includes(seed.address) ? result.module : zero;
    } else {
      const result = await getter(seed.address, seed.getter, seed.boundary);
      assert.equal(result.status, "success", `seed oracle failed ${seed.id}`);
      value = result.value;
    }
    assert.equal(value, seed.value, `seed value differs ${seed.id}`);
    seedObservations.push({ id: seed.id, value, boundary: seed.boundary });
  }
  for (const row of state.VerifiedDeployment ?? []) {
    const descriptor = await proofAvailable(async () =>
      getOrdinaryDeployment(
        context,
        {
          chainId: 1,
          address: row.address,
          blockNumber: BigInt(end),
          blockHash: current.hash,
        },
        await codeHash(row.address)
      )
    );
    assert.ok(descriptor, "deployment descriptor missing");
    const fact = await getDeploymentFact(
      context,
      {
        chainId: 1,
        address: row.address,
        blockNumber: BigInt(end),
        blockHash: current.hash,
      },
      descriptor
    );
    assert.ok(fact, "deployment lifetime audit failed");
    assert.equal(row.codeHash, fact.codeHash);
    assert.equal(row.creationBlock, fact.verifiedAt.number);
    assert.equal(row.creationHash, fact.verifiedAt.hash);
    assert.equal(row.version, descriptor.version);
    assert.equal(row.codeHash, await codeHash(row.address));
  }
  if (state.KernelReadEpoch?.length) {
    assert.equal(state.KernelReadEpoch.length, 1);
    const last = kernelLogs.at(-1);
    assert.ok(last, "unexplained Kernel epoch");
    assert.equal(
      state.KernelReadEpoch[0].epoch,
      `${last.blockHash}:${last.transactionHash}:${last.logIndex}`
    );
    assert.equal(
      state.KernelReadEpoch[0].migrated,
      kernelLogs.some((log) => Number(log.args.action_) === 5)
    );
  }
  for (const cache of state.KernelReadCache ?? []) {
    const parts = cache.id.split(":");
    const address = parts[1];
    const name = parts.slice(3, -1).join(":");
    const proof = kernelReadProof({ chainId: 1, address, getter: name });
    assert.ok(proof, "unknown Kernel cache implementation");
    assert.equal(await codeHash(address), proof.codeHash);
    const result = await reuseKernelRead(
      context,
      { chainId: 1, address, getter: name, block: current },
      async () => {
        throw new Error("ineligible Kernel cache");
      },
      () => codeHash(address),
      block
    );
    assert.equal(result.status, "success");
    assert.ok(BigInt(cache.verifiedAt.number) >= BigInt(start));
    assert.equal(
      kernelLogs.filter(
        (log) => BigInt(log.blockNumber) > BigInt(cache.verifiedAt.number)
      ).length,
      0
    );
    if (name.startsWith("moduleDependents:")) {
      const prior = await dependency(name.split(":")[1], cache.verifiedAt);
      same(result.policies, prior.policies);
      assert.equal(result.module, prior.module);
    } else {
      const prior = await getter(address, name, cache.verifiedAt);
      assert.equal(prior.status, "success");
      assert.equal(result.value, prior.value);
    }
  }
  for (const [number, opening] of headers) {
    const after = await client.getBlock({ blockNumber: BigInt(number) });
    assert.equal(after.hash, (await opening).hash);
  }
  assert.equal(
    (await client.getBlock({ blockNumber: BigInt(end) })).hash,
    current.hash
  );
  assertProofInputClean();
  assert.equal(runtimeHash("HEAD"), options.identity.proofInputHash);
  return {
    protocol: "protocol-visualizer-robinhood-oracle-v2",
    identity: options.identity,
    measuredConfigHash: createHash("sha256")
      .update(measuredConfig)
      .digest("hex"),
    validatedDeployments: state.VerifiedDeployment?.length ?? 0,
    validatedKernelFacts: state.KernelReadCache?.length ?? 0,
    stateHash: digest(state),
    start,
    end,
    current,
    manifest: {
      hash: digest(logs),
      logCount: logs.length,
      addedTopicLogs: 0,
      dynamicRegistrations: 0,
      ignoredRegistryLogs: logs.filter(
        (log) =>
          log.contract === "TokenAdminRegistry" &&
          log.args.token &&
          log.args.token.toLowerCase() !== registry.token.toLowerCase()
      ).length,
    },
    observations,
    seedObservations,
    canonicalBlocks: await Promise.all(headers.values()),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: Object.fromEntries(
      ["state", "output", "source", "oracle-source", "identity"].map((name) => [
        name,
        { type: "string" },
      ])
    ),
  });
  try {
    const result = await audit({
      ...values,
      oracleSource: values["oracle-source"],
      identity: JSON.parse(values.identity),
    });
    writeFileSync(values.output, JSON.stringify(result), { mode: 0o600 });
    console.log(
      `Audited ${result.observations.length} relationships and ${result.manifest.logCount} canonical logs`
    );
  } catch (error) {
    // Private diagnostics contain assertions; provider-authored errors stay out of public artifacts.
    console.error(error);
    process.exitCode = 1;
  }
}
