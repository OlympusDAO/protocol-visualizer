import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  currentStateProtocol,
  currentStateEntities,
  digest,
  entityDigests,
  resultProblems,
  runtimeHash,
  summarize,
  writeResult,
} from "./benchmark-indexer.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/indexer/package.json"));
const viemManifest = require.resolve("viem/package.json");
const viem = await import(
  pathToFileURL(
    resolve(dirname(viemManifest), require(viemManifest).exports["."].import)
  ).href
);
const yaml = require(
  require.resolve("yaml", { paths: [require.resolve("envio")] })
);
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const load = (directory, path) =>
  import(pathToFileURL(join(directory, path)).href);
const same = (a, b, message = "unexplained current-state difference") =>
  assert.equal(digest(a), digest(b), message);
const equal = (a, b) =>
  a === undefined || b === undefined ? a === b : digest(a) === digest(b);
const zero = `0x${"0".repeat(40)}`;
export const isEvmRevert = (error) =>
  error instanceof viem.BaseError &&
  error.walk(
    (cause) => cause instanceof viem.ContractFunctionRevertedError
  ) instanceof viem.ContractFunctionRevertedError;
export function executorSeedBlock(row, constants, start, events) {
  if (BigInt(row.lastUpdatedBlockNumber) >= BigInt(start)) return null;
  assert.equal(
    String(row.lastUpdatedBlockNumber),
    String(constants.creationBlockNumber)
  );
  assert.equal(
    String(row.lastUpdatedTimestamp),
    String(constants.creationTimestamp)
  );
  assert.equal(row.kernel.toLowerCase(), constants.address.toLowerCase());
  assert(
    !events.some(
      (event) =>
        event.address.toLowerCase() === row.kernel.toLowerCase() &&
        event.event === "ActionExecuted" &&
        Number(event.args.action_) === 4
    ),
    "executor seed survived an observed change"
  );
  return String(row.lastUpdatedBlockNumber);
}
export function scheduledBlockCount(registrations, chain) {
  return registrations.reduce((total, registration) => {
    const start = registration.startBlock ?? chain.start_block;
    const end = Math.min(
      registration.endBlock ?? chain.end_block,
      chain.end_block
    );
    assert(
      Number.isSafeInteger(registration.interval) && registration.interval > 0
    );
    return (
      total +
      (end < start ? 0 : Math.floor((end - start) / registration.interval) + 1)
    );
  }, 0);
}
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const implementationHash = hash(fileURLToPath(import.meta.url));
const tableHashes = (state) =>
  Object.fromEntries(
    Object.entries(state).map(([name, rows]) => [
      name,
      entityDigests(name, rows).exact,
    ])
  );
const key = (row) => `${row.chainId}:${row.id}`;
const removed =
  "ActionExecutedEvent ContractEvent KernelExecutorEvent RoleEvent ContractStateSeed".split(
    " "
  );

function subscriptions(config, chainId) {
  const chain = config.chains.find((row) => row.id === chainId),
    entries = [];
  for (const contract of chain.contracts) {
    const definition = config.contracts.find(
      (row) => row.name === contract.name
    );
    for (const address of [contract.address].flat())
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
  return entries;
}

/** Fresh baseline readers bypass all candidate effects and reusable entity facts. */
export async function auditCurrent(options) {
  assert.equal(options.identity.implementation, implementationHash);
  assert.equal(runtimeHash("HEAD"), options.identity.proofInputHash);
  const state = json(options.state),
    config = yaml.parse(
      readFileSync(join(options.source, "apps/indexer/config.yaml"), "utf8")
    );
  const native = (name) =>
    import(
      new URL(`./src/${name}.res.mjs`, pathToFileURL(require.resolve("envio")))
    );
  const [Config, Handlers] = await Promise.all([
    native("Config"),
    native("HandlerRegister"),
  ]);
  const nativeConfig = Config.load();
  Handlers.startRegistration(nativeConfig);
  await load(options.source, "apps/indexer/src/EventHandlers.ts");
  const registrations = Handlers.finishRegistration(nativeConfig);
  const { getPublicClient, rethrowTransientRpc } = await load(
    root,
    "apps/indexer/src/events/rpc.ts"
  );
  const { readPinnedControlGetter } = await load(
    options.oracleSource,
    "apps/indexer/src/events/control-reads.ts"
  );
  const { readPinnedModuleDependencies } = await load(
    options.oracleSource,
    "apps/indexer/src/events/module-dependencies.ts"
  );
  const { readPinnedBridgeConfiguration } = await load(
    options.oracleSource,
    "apps/indexer/src/events/bridge-reads.ts"
  );
  const { getKernelConstants, getRolesAdminConstants } = await load(
    options.oracleSource,
    "apps/indexer/src/constants.ts"
  );
  const headers = new Map(),
    reads = new Map(),
    events = [],
    ends = [],
    observations = [],
    coverage = [],
    stateObservations = [],
    initializationSeeds = [];
  let rpcFailure;
  const block = (chain, number) => {
    const id = `${chain}:${number}`;
    if (!headers.has(id))
      headers.set(
        id,
        getPublicClient(chain)
          .getBlock({ blockNumber: BigInt(number) })
          .then((row) => ({
            number: String(row.number),
            hash: row.hash.toLowerCase(),
            timestamp: String(row.timestamp),
          }))
      );
    return headers.get(id);
  };
  const canonical = async (chain, at) => {
    same(
      { number: at.number, hash: at.hash, timestamp: at.timestamp },
      await block(chain, at.number),
      "orphaned or malformed observation"
    );
  };
  const codeReads = new Map();
  const oracleClient = (chain) => ({
    ...getPublicClient(chain),
    readContract: async (args) => {
      try {
        return await getPublicClient(chain).readContract(args);
      } catch (error) {
        try {
          rethrowTransientRpc(error);
        } catch (transient) {
          rpcFailure = transient;
        }
        throw error;
      }
    },
    getBlock: async ({ blockNumber }) => {
      const at = await block(chain, blockNumber);
      return {
        hash: at.hash,
        number: BigInt(at.number),
        timestamp: BigInt(at.timestamp),
      };
    },
    getCode: (pin) => {
      const id = `${chain}:${pin.address.toLowerCase()}:${pin.blockHash}`;
      if (!codeReads.has(id))
        codeReads.set(id, getPublicClient(chain).getCode(pin));
      return codeReads.get(id);
    },
  });
  const dependency = (chain, code, at) => {
    const id = `dependency:${chain}:${code}:${at.hash}`;
    if (!reads.has(id))
      reads.set(
        id,
        readPinnedModuleDependencies(oracleClient(chain), {
          chainId: chain,
          kernel: getKernelConstants(chain).address,
          keycode: code,
          blockNumber: BigInt(at.number),
          blockHash: at.hash,
        })
      );
    return reads.get(id);
  };
  const getter = async (chain, address, name, at) => {
    if (name.startsWith("moduleDependents:")) {
      const result = await dependency(chain, name.split(":")[1], at);
      assert.equal(result.status, "success", "incomplete dependency oracle");
      return {
        status: "success",
        value: result.policies.includes(address) ? result.module : zero,
        policies: result.policies,
      };
    }
    const id = `${chain}:${address}:${name}:${at.hash}`;
    if (!reads.has(id))
      reads.set(
        id,
        readPinnedControlGetter(oracleClient(chain), {
          chainId: chain,
          address,
          getter: name,
          blockNumber: BigInt(at.number),
          blockHash: at.hash,
        })
      );
    return reads.get(id);
  };
  const visit = async (chain, value) => {
    if (!value || typeof value !== "object") return;
    if ("number" in value && "hash" in value && "timestamp" in value) {
      await canonical(chain, value);
      return;
    }
    for (const item of Object.values(value)) await visit(chain, item);
  };
  for (const chain of config.chains) {
    const chainId = chain.id,
      client = getPublicClient(chainId),
      end = await block(chainId, chain.end_block),
      rows = (name) =>
        (state[name] ?? []).filter((row) => row.chainId === chainId);
    ends.push({ chainId, ...end });
    same(
      rows("ChainObservation")[0]?.indexedThrough,
      end,
      "missing exact endpoint observation"
    );
    for (const name of currentStateEntities)
      for (const row of rows(name)) await visit(chainId, row);
    let entries = subscriptions(config, chainId),
      raw = [],
      previousCount = entries.length;
    // Bounded closure for the two production dynamic registration kinds.
    for (let round = 0; round < 4; round++) {
      const addresses = [...new Set(entries.map((row) => row.address))],
        topics = [...new Set(entries.map((row) => row.topic))];
      raw = [];
      for (let from = chain.start_block; from <= chain.end_block; from += 5000)
        raw.push(
          ...(await client.request({
            method: "eth_getLogs",
            params: [
              {
                fromBlock: viem.numberToHex(from),
                toBlock: viem.numberToHex(
                  Math.min(chain.end_block, from + 4999)
                ),
                address: addresses,
                topics: [topics],
              },
            ],
          }))
        );
      const logs = raw
        .flatMap((log) =>
          entries
            .filter(
              (entry) =>
                entry.address === log.address.toLowerCase() &&
                entry.topic === log.topics[0] &&
                BigInt(log.blockNumber) >= BigInt(entry.from)
            )
            .map((entry) => ({
              chainId,
              contract: entry.contract,
              event: entry.event.name,
              address: entry.address,
              blockNumber: String(BigInt(log.blockNumber)),
              blockHash: log.blockHash,
              transactionHash: log.transactionHash,
              logIndex: Number(BigInt(log.logIndex)),
              data: log.data,
              topics: log.topics,
              args: viem.decodeEventLog({
                abi: [entry.event],
                data: log.data,
                topics: log.topics,
              }).args,
            }))
        )
        .sort(
          (a, b) =>
            Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) ||
            a.logIndex - b.logIndex ||
            a.contract.localeCompare(b.contract)
        );
      for (const log of logs) {
        let names = [],
          address;
        if (log.event === "AuthorityUpdated") {
          names = ["OlympusAuthority"];
          address = log.args.authority;
        }
        if (log.event === "PoolSet") {
          const { getCcipRegistry } = await load(
            root,
            "apps/indexer/src/events/ownership-contracts.ts"
          );
          if (
            log.args.token.toLowerCase() === getCcipRegistry(chainId)?.token
          ) {
            names = ["ChainlinkOwned", "CCIPTokenPool"];
            address = log.args.newPool;
          }
        }
        if (address && address.toLowerCase() !== zero)
          for (const name of names) {
            if (
              entries.some(
                (row) =>
                  row.contract === name && row.address === address.toLowerCase()
              )
            )
              continue;
            for (const item of config.contracts.find((row) => row.name === name)
              .events) {
              const event = viem.parseAbiItem(`event ${item.event}`);
              entries.push({
                contract: name,
                address: address.toLowerCase(),
                from: Number(log.blockNumber),
                event,
                topic: viem.toEventSelector(event),
              });
            }
          }
      }
      if (entries.length === previousCount) {
        events.push(...logs);
        break;
      }
      previousCount = entries.length;
      assert(round < 3, "dynamic event closure did not converge");
    }
    const { getRelationshipFields, getCcipRegistry } = await load(
      root,
      "apps/indexer/src/events/ownership-contracts.ts"
    );
    const { configureOwnershipEventFields } = await load(
      root,
      "apps/indexer/src/events/ownership-policy.ts"
    );
    const { getCoreContracts } = await load(
      root,
      "apps/indexer/src/events/kernel-history.ts"
    );
    const { getEnablerContracts } = await load(
      root,
      "apps/indexer/src/events/enabler-contracts.ts"
    );
    const { getPeriodicTaskManagers, getLegacyTaskContracts } = await load(
      root,
      "apps/indexer/src/events/heart-tasks.ts"
    );
    const { getBridgeContracts, ccipSelectors } = await load(
      root,
      "apps/indexer/src/events/bridge-config.ts"
    );
    const planned = getRelationshipFields(chainId, chain.start_block).filter(
      (field) => field.startBlock <= chain.end_block
    );
    const extraGetters = {
      Owned: ["owner"],
      ChainlinkOwned: ["owner", "newOwner"],
      OlympusAccessControlled: ["authority"],
      StakedOHM: ["stakingContract"],
      GovernanceOHM: ["approved"],
      OlympusAuthority: [
        "governor",
        "newGovernor",
        "guardian",
        "newGuardian",
        "policy",
        "newPolicy",
        "vault",
        "newVault",
      ],
    };
    for (const entry of entries)
      for (const name of extraGetters[entry.contract] ?? []) {
        if (
          planned.some(
            (field) => field.address === entry.address && field.getter === name
          )
        )
          continue;
        planned.push({
          address: entry.address,
          getter: name,
          startBlock: entry.from,
          kind:
            entry.contract === "ChainlinkOwned"
              ? entry.address === getCcipRegistry(chainId)?.address
                ? "registry-owner"
                : "pool-owner"
              : name,
        });
      }
    const fields = configureOwnershipEventFields(
      chainId,
      planned,
      Object.fromEntries(
        ["Owned", "ChainlinkOwned", "TokenAdminRegistry"].map((name) => [
          name,
          [
            ...new Set(
              entries
                .filter((entry) => entry.contract === name)
                .map((entry) => entry.address)
            ),
          ],
        ])
      )
    );
    const expectedRelationships = new Set(
      fields.map((field) => `${field.address}:${field.getter}`)
    );
    const core = getCoreContracts(chainId).filter(
      (contract) =>
        (contract.startBlock ?? chain.start_block) <= chain.end_block
    );
    for (const contract of core)
      if (
        await client.getCode({
          address: contract.address,
          blockHash: end.hash,
          requireCanonical: true,
        })
      )
        assert(
          rows("Contract").some((row) => row.address === contract.address),
          "missing configured core contract"
        );
    const codes = new Set(
      core
        .filter(
          (contract) =>
            contract.contractType === "MODULE" &&
            /^[A-Z]{5}$/.test(contract.name)
        )
        .map((contract) => contract.name)
    );
    for (const log of events.filter(
      (log) =>
        log.chainId === chainId &&
        log.contract === "Kernel" &&
        [0, 1].includes(Number(log.args.action_))
    )) {
      const code = viem.hexToString(
        await client.readContract({
          address: log.args.target_,
          abi: viem.parseAbi(["function KEYCODE() view returns(bytes5)"]),
          functionName: "KEYCODE",
          blockHash: log.blockHash,
          requireCanonical: true,
        })
      );
      codes.add(code);
      assert(
        rows("CurrentModule").some((row) => row.keycode === code),
        "missing event-derived module mapping"
      );
    }
    for (const code of codes) {
      const result = await dependency(chainId, code, end);
      assert.equal(
        result.status,
        "success",
        "missing required dependency scan"
      );
      for (const address of result.policies)
        expectedRelationships.add(`${address}:moduleDependents:${code}`);
      same(
        rows("ContractRelationship")
          .filter(
            (row) =>
              row.getter === `moduleDependents:${code}` && row.value !== zero
          )
          .map((row) => row.subject)
          .toSorted(),
        result.policies.toSorted(),
        "incomplete dependency inventory"
      );
    }
    for (const expected of expectedRelationships)
      assert(
        rows("ContractRelationship").some(
          (row) => `${row.subject}:${row.getter}` === expected
        ),
        `missing expected relationship: ${expected}`
      );
    coverage.push({
      chainId,
      relationships: [...expectedRelationships].sort(),
      keycodes: [...codes].sort(),
    });
    const managers = getPeriodicTaskManagers(chainId).filter(
      (manager) => manager.startBlock <= chain.end_block
    );
    same(
      rows("HeartTasks")
        .map((row) => row.address)
        .sort(),
      managers.map((row) => row.address).sort(),
      "incomplete task inventory"
    );
    const requiredControls = [
      ...getEnablerContracts(chainId),
      ...getLegacyTaskContracts(chainId),
    ].filter((row) => row.startBlock <= chain.end_block);
    for (const contract of requiredControls)
      assert(
        rows("ContractState").some(
          (row) => row.address === contract.address && row.enabled !== null
        ),
        "missing readable enablement state"
      );
    const bridges = getBridgeContracts(chainId, fields).filter(
      (row) => row.startBlock <= chain.end_block
    );
    same(
      rows("BridgeConfiguration")
        .map((row) => row.address)
        .sort(),
      bridges.map((row) => row.address).sort(),
      "incomplete bridge inventory"
    );
    const chainEvents = events.filter((log) => log.chainId === chainId);
    if (chainEvents.some((log) => log.contract === "Kernel")) {
      assert(
        rows("Contract").some(
          (row) =>
            row.address === getKernelConstants(chainId).address &&
            row.contractType === "KERNEL"
        )
      );
      assert.equal(rows("KernelExecutor").length, 1, "missing Kernel executor");
    }
    if (
      chainEvents.some((log) =>
        ["RoleGranted", "RoleRevoked", "NewAdminPulled"].includes(log.event)
      )
    ) {
      assert.equal(
        rows("CurrentRoleAssignee").filter((row) => row.role === "RolesAdmin")
          .length,
        1,
        "missing RolesAdmin observation"
      );
      assert(rows("Role").some((row) => row.role === "RolesAdmin"));
    }
    for (const log of events.filter((log) => log.chainId === chainId)) {
      if (["RoleGranted", "RoleRevoked"].includes(log.event)) {
        const role = viem.hexToString(log.args.role_).replace(/\0/g, "");
        assert(rows("Role").some((row) => row.role === role));
        assert(
          rows("RoleAssignment").some(
            (row) =>
              row.role === role && row.assignee === log.args.addr_.toLowerCase()
          ),
          "missing role observation"
        );
      }
      const registryEvent = [
        "AdministratorTransferRequested",
        "AdministratorTransferred",
        "PoolSet",
      ].includes(log.event);
      const relevantRegistry =
        registryEvent &&
        log.args.token?.toLowerCase() === getCcipRegistry(chainId)?.token;
      const controlEvent =
        [
          "OwnershipTransferred",
          "OwnershipTransferRequested",
          "OwnershipTransferStarted",
          "AuthorityUpdated",
          "LogStakingContractUpdated",
          "LtvOracleSet",
          "TreasuryBorrowerSet",
          "GovernorPushed",
          "GovernorPulled",
          "GuardianPushed",
          "GuardianPulled",
          "PolicyPushed",
          "PolicyPulled",
          "VaultPushed",
          "VaultPulled",
          "PeriodicTaskAdded",
          "PeriodicTaskRemoved",
          "Activated",
          "Deactivated",
          "Shutdown",
          "Transition",
        ].includes(log.event) ||
        (log.contract === "IEnabler" &&
          ["Enabled", "Disabled"].includes(log.event)) ||
        relevantRegistry ||
        log.contract === "CCIPTokenPool";
      if (controlEvent)
        assert(
          rows("ControlTransition").some(
            (row) =>
              row.transactionHash === log.transactionHash &&
              row.logIndex === log.logIndex &&
              row.address === log.address
          ),
          "configured control event missing its transition"
        );
    }
    for (const row of rows("ControlTransition")) {
      const matches = events.filter(
        (log) =>
          log.chainId === chainId &&
          log.transactionHash === row.transactionHash &&
          log.logIndex === row.logIndex &&
          log.address === row.address
      );
      assert(
        matches.length > 0,
        "transition missing from canonical event manifest"
      );
      assert(
        matches.every(
          (log) =>
            log.blockNumber === row.blockNumber &&
            log.blockHash === row.blockHash
        )
      );
    }
    const relationships = rows("ContractRelationship");
    for (let offset = 0; offset < relationships.length; offset += 8) {
      await Promise.all(
        relationships.slice(offset, offset + 8).map(async (row) => {
          const result = await getter(chainId, row.subject, row.getter, end);
          const policy = fields.find(
            (field) =>
              field.address === row.subject && field.getter === row.getter
          )?.eventPolicy;
          if (policy) {
            const code = await oracleClient(chainId).getCode({
              address: row.subject,
              blockHash: end.hash,
              requireCanonical: true,
            });
            assert.equal(viem.keccak256(code ?? "0x"), policy.codeHash);
          }
          if (result.status !== "success") {
            // This field deliberately reports event knowledge, never a verified private value.
            assert.equal(
              row.getter,
              "newOwner",
              "unavailable required endpoint getter"
            );
            assert(
              entries.some(
                (entry) =>
                  entry.contract === "ChainlinkOwned" &&
                  entry.address === row.subject
              )
            );
            assert.equal(row.verification.outcome, "unavailable");
            await assert.rejects(
              client.readContract({
                address: row.subject,
                abi: viem.parseAbi([
                  "function newOwner() view returns (address)",
                ]),
                functionName: "newOwner",
                blockHash: end.hash,
                requireCanonical: true,
              }),
              isEvmRevert,
              "getterless exception requires an actual EVM revert"
            );
            const changes = events.filter(
              (log) =>
                log.chainId === chainId &&
                log.address === row.subject &&
                ["OwnershipTransferRequested", "OwnershipTransferred"].includes(
                  log.event
                )
            );
            const last = changes.at(-1);
            if (last)
              assert.equal(
                row.value,
                last.event === "OwnershipTransferred"
                  ? zero
                  : last.args.to.toLowerCase()
              );
            else
              assert.equal(
                row.value,
                null,
                "private nominee stays unknown without an observed nomination"
              );
            observations.push({
              key: key(row),
              getterless: true,
              policy,
              value: row.value,
            });
            return;
          }
          assert.equal(
            row.value,
            result.value,
            "current relationship differs from fresh endpoint getter"
          );
          assert.equal(row.verification.getterValue, result.value);
          assert(["match", "unperformed"].includes(row.verification.outcome));
          if (rows("ChainObservation")[0].verificationVersion === 1)
            same(
              row.verification.block,
              end,
              "candidate read did not verify the endpoint"
            );
          if (row.verification.block) {
            const observed = await getter(
              chainId,
              row.subject,
              row.getter,
              row.verification.block
            );
            assert.equal(observed.status, "success");
            assert.equal(observed.value, row.verification.getterValue);
          }
          if (row.seed) {
            const seeded = await getter(
              chainId,
              row.subject,
              row.getter,
              row.seed
            );
            assert.equal(seeded.status, "success");
            const original = rows("ContractStateSeed").find(
              (seed) =>
                seed.address === row.subject &&
                seed.getter === row.getter &&
                seed.boundary.hash === row.seed.hash
            );
            if (original) assert.equal(seeded.value, original.value);
          }
          if (row.targetCode) {
            const code = await client.getCode({
              address: row.value,
              blockHash: end.hash,
              requireCanonical: true,
            });
            assert.equal(row.targetCode, code ? "present" : "absent");
          }
          const targetCode = (await oracleClient(chainId).getCode({
            address: row.value,
            blockHash: end.hash,
            requireCanonical: true,
          }))
            ? "present"
            : "absent";
          observations.push({
            key: key(row),
            policy,
            targetCode,
            value: result.value,
            verification: row.verification.block,
            seed: row.seed,
          });
        })
      );
    }
    for (const code of new Set(
      rows("ContractRelationship")
        .filter((row) => row.kind === "module-dependency")
        .map((row) => row.getter.split(":")[1])
    )) {
      const selected = rows("ContractRelationship").filter(
        (row) => row.getter === `moduleDependents:${code}` && row.value !== zero
      );
      const fresh = await getter(
        chainId,
        selected[0]?.subject ?? zero,
        `moduleDependents:${code}`,
        end
      );
      same(
        fresh.policies.toSorted(),
        selected.map((row) => row.subject).toSorted(),
        "incomplete dependency inventory"
      );
    }
    for (const row of rows("ContractState")) {
      if (row.enabled === null) {
        assert.notEqual(row.enablerCapability, "supported");
        continue;
      }
      const result = await getter(
        chainId,
        row.address,
        row.enablementGetter ?? "isEnabled",
        end
      );
      assert.equal(result.status, "success");
      assert.equal(
        row.enablementGetter === "isShutdown"
          ? result.value === "false"
          : result.value === "true",
        row.enabled
      );
      assert.equal(result.value, row.verification.getterValue);
      if (row.seed) {
        const seeded = await getter(
          chainId,
          row.address,
          row.enablementGetter ?? "isEnabled",
          row.seed
        );
        assert.equal(seeded.status, "success");
        const original = rows("ContractStateSeed").find(
          (seed) =>
            seed.address === row.address &&
            seed.getter === (row.enablementGetter ?? "isEnabled") &&
            seed.boundary.hash === row.seed.hash
        );
        if (original) assert.equal(seeded.value, original.value);
      }
      stateObservations.push({
        table: "ContractState",
        key: key(row),
        seed: row.seed,
        verification: row.verification.block,
        value: result.value,
      });
      assert.equal(row.verification.outcome, "match");
      same(row.verification.block, end);
    }
    for (const row of rows("HeartTasks")) {
      const result = await getter(
        chainId,
        row.address,
        "getPeriodicTasks",
        end
      );
      assert.equal(result.status, "success");
      same(
        JSON.parse(result.value),
        row.tasks.map(({ address, selector }) => ({ address, selector }))
      );
      same(JSON.parse(result.value), JSON.parse(row.verification.getterValue));
      for (const task of row.tasks) {
        assert(
          Object.keys(task).every((key) =>
            ["address", "selector", "signature"].includes(key)
          ),
          "unknown task annotation"
        );
        if (task.signature)
          assert.equal(viem.toFunctionSelector(task.signature), task.selector);
      }
      if (row.seed) {
        const seeded = await getter(
          chainId,
          row.address,
          "getPeriodicTasks",
          row.seed
        );
        assert.equal(seeded.status, "success");
        const original = rows("ContractStateSeed").find(
          (seed) =>
            seed.address === row.address &&
            seed.getter === "getPeriodicTasks" &&
            seed.boundary.hash === row.seed.hash
        );
        if (original) assert.equal(seeded.value, original.value);
      }
      stateObservations.push({
        table: "HeartTasks",
        key: key(row),
        seed: row.seed,
        verification: row.verification.block,
        value: result.value,
      });
      same(row.verification.block, end);
    }
    const bridgeSelectors = new Set(ccipSelectors);
    for (const log of events.filter((log) => log.chainId === chainId)) {
      const selector =
        log.args.remoteChainSelector ?? log.args.dstChainSelector;
      if (selector !== undefined) bridgeSelectors.add(String(selector));
    }
    for (const row of rows("BridgeConfiguration").sort((a, b) =>
      a.kind === b.kind ? 0 : a.kind === "pool" ? -1 : 1
    )) {
      const result = await readPinnedBridgeConfiguration(
        oracleClient(chainId),
        {
          chainId,
          address: row.address,
          kind: row.kind,
          selectors: [...bridgeSelectors].sort(),
          blockNumber: BigInt(end.number),
          blockHash: end.hash,
        }
      );
      assert.equal(result.status, "success");
      const fresh = JSON.parse(result.value);
      same(fresh, row.configuration);
      same(row.verification.block, end);
      for (const route of fresh.routes) bridgeSelectors.add(route.selector);
      const expectedSelectors = [
        ...new Set(
          events
            .filter(
              (log) => log.chainId === chainId && log.address === row.address
            )
            .flatMap((log) => {
              const selector =
                log.args.remoteChainSelector ?? log.args.dstChainSelector;
              return selector === undefined ? [] : [String(selector)];
            })
        ),
      ].sort();
      same(
        row.selectors,
        expectedSelectors,
        "bridge selector observations differ from events"
      );
    }
    for (const row of rows("Contract").filter(
      (row) =>
        row.contractType === "POLICY" &&
        ["installed", "never-installed"].includes(row.kernelHistory)
    )) {
      const active = await client.readContract({
        address: getKernelConstants(chainId).address,
        abi: viem.parseAbi([
          "function isPolicyActive(address) view returns(bool)",
        ]),
        functionName: "isPolicyActive",
        args: [row.address],
        blockHash: end.hash,
        requireCanonical: true,
      });
      assert.equal(active, row.isEnabled);
    }
    for (const row of rows("CurrentRoleAssignee")) {
      assert.equal(row.role, "RolesAdmin");
      const admin = await client.readContract({
        address: getRolesAdminConstants(chainId).address,
        abi: viem.parseAbi(["function admin() view returns(address)"]),
        functionName: "admin",
        blockHash: end.hash,
        requireCanonical: true,
      });
      assert.equal(admin.toLowerCase(), row.assignee);
    }
    const assignments = rows("RoleAssignment").filter(
      (row) => row.role !== "RolesAdmin"
    );
    const rolesAddress = assignments.length
      ? await client.readContract({
          address: getKernelConstants(chainId).address,
          abi: viem.parseAbi([
            "function getModuleForKeycode(bytes5) view returns(address)",
          ]),
          functionName: "getModuleForKeycode",
          args: [viem.stringToHex("ROLES", { size: 5 })],
          blockHash: end.hash,
          requireCanonical: true,
        })
      : undefined;
    for (const row of rows("RoleAssignment").filter(
      (row) => row.role !== "RolesAdmin"
    )) {
      assert(
        rolesAddress && rolesAddress.toLowerCase() !== zero,
        "role observations require the endpoint ROLES module"
      );
      const granted = await client.readContract({
        address: rolesAddress,
        abi: viem.parseAbi([
          "function hasRole(address,bytes32) view returns(bool)",
        ]),
        functionName: "hasRole",
        args: [row.assignee, viem.stringToHex(row.role, { size: 32 })],
        blockHash: end.hash,
        requireCanonical: true,
      });
      assert.equal(granted, row.isGranted);
    }
    for (const row of rows("KernelExecutor")) {
      const seededAt = executorSeedBlock(
        row,
        getKernelConstants(chainId),
        chain.start_block,
        chainEvents
      );
      const at = seededAt ? await block(chainId, seededAt) : end;
      const result = await client.readContract({
        address: row.kernel,
        abi: viem.parseAbi(["function executor() view returns(address)"]),
        functionName: "executor",
        blockHash: at.hash,
        requireCanonical: true,
      });
      assert.equal(result.toLowerCase(), row.executor.toLowerCase());
      if (seededAt) {
        const endpoint = await client.readContract({
          address: row.kernel,
          abi: viem.parseAbi(["function executor() view returns(address)"]),
          functionName: "executor",
          blockHash: end.hash,
          requireCanonical: true,
        });
        initializationSeeds.push({
          table: "KernelExecutor",
          key: key(row),
          block: at,
          configuredTimestamp: String(row.lastUpdatedTimestamp),
          value: result.toLowerCase(),
          endpoint: { block: end, value: endpoint.toLowerCase() },
          endpointVerified: false,
          rowHash: digest(row),
        });
      }
    }
    for (const row of rows("CurrentModule")) {
      const result = await client.readContract({
        address: getKernelConstants(chainId).address,
        abi: viem.parseAbi([
          "function getModuleForKeycode(bytes5) view returns(address)",
        ]),
        functionName: "getModuleForKeycode",
        args: [viem.stringToHex(row.keycode, { size: 5 })],
        blockHash: end.hash,
        requireCanonical: true,
      });
      assert.equal(result.toLowerCase(), row.address);
    }
  }
  for (const event of events)
    assert.equal(
      (await block(event.chainId, event.blockNumber)).hash,
      event.blockHash,
      "noncanonical manifest event"
    );
  for (const [id, opening] of headers) {
    const [chain, number] = id.split(":");
    const after = await getPublicClient(Number(chain)).getBlock({
      blockNumber: BigInt(number),
    });
    assert.equal(
      after.hash,
      (await opening).hash,
      "canonicality changed during audit"
    );
  }
  if (rpcFailure) throw rpcFailure;
  return {
    protocol: currentStateProtocol,
    identity: options.identity,
    stateHash: digest(tableHashes(state)),
    ends,
    eventCount: events.length,
    eventCounts: Object.fromEntries(
      config.chains.map((chain) => [
        chain.id,
        new Set(
          events
            .filter((event) => event.chainId === chain.id)
            .map((event) => `${event.blockHash}:${event.logIndex}`)
        ).size,
      ])
    ),
    blockCallbacks: Object.fromEntries(
      config.chains.map((chain) => [
        chain.id,
        scheduledBlockCount(
          registrations[chain.id].onBlockRegistrations,
          chain
        ),
      ])
    ),
    manifestHash: digest(events),
    events,
    observations: observations.sort((a, b) => a.key.localeCompare(b.key)),
    coverage,
    stateObservations,
    initializationSeeds,
  };
}

export function compareCurrentStates(base, head, a, b) {
  same(
    Object.keys(head).toSorted(),
    currentStateEntities.toSorted(),
    "candidate must contain exactly 12 current entities"
  );
  same(
    Object.keys(base).toSorted(),
    [...currentStateEntities, ...removed].toSorted(),
    "baseline must retain all 17 Robinhood entities"
  );
  for (const [state, audit] of [
    [base, a],
    [head, b],
  ]) {
    assert.equal(audit.protocol, currentStateProtocol);
    assert.equal(audit.stateHash, digest(tableHashes(state)));
    assert.equal(audit.manifestHash, digest(audit.events));
    assert.equal(audit.observations.length, state.ContractRelationship.length);
    const observed = new Map(audit.observations.map((row) => [row.key, row]));
    same(
      [...observed.keys()].sort(),
      state.ContractRelationship.map(key).sort(),
      "incomplete oracle receipts"
    );
    for (const row of state.ContractRelationship) {
      const proof = observed.get(key(row));
      if (!proof.getterless) {
        assert.equal(proof.value, row.value);
        same(proof.verification, row.verification.block);
        same(proof.seed, row.seed);
      } else assert.equal(row.verification.outcome, "unavailable");
    }
    for (const plan of audit.coverage)
      for (const expected of plan.relationships)
        assert(
          state.ContractRelationship.some(
            (row) =>
              row.chainId === plan.chainId &&
              `${row.subject}:${row.getter}` === expected
          ),
          "missing independently expected relationship"
        );
  }
  same(a.coverage, b.coverage);
  same(a.initializationSeeds, b.initializationSeeds);
  same(a.ends, b.ends);
  same(a.manifestHash, b.manifestHash);
  same(a.eventCounts, b.eventCounts);
  const accepted = [];
  for (const name of currentStateEntities) {
    const before = new Map(base[name].map((row) => [key(row), row])),
      after = new Map(head[name].map((row) => [key(row), row]));
    same(
      [...before.keys()].sort(),
      [...after.keys()].sort(),
      `identity set differs: ${name}`
    );
    for (const [id, old] of before) {
      const next = after.get(id),
        normalized = structuredClone(next);
      for (const field of new Set([
        ...Object.keys(old),
        ...Object.keys(next),
      ])) {
        if (equal(old[field], next[field])) continue;
        if (name === "ChainObservation" && field === "verificationVersion") {
          assert.equal(old[field], undefined);
          assert.equal(next[field], 1);
        } else if (
          ["ContractState", "HeartTasks"].includes(name) &&
          field === "seed"
        ) {
          const proof = b.stateObservations.find(
            (row) => row.table === name && row.key === id
          );
          assert(proof);
          same(proof.seed, next.seed);
          same(next.seed, next.verification.block);
          assert.equal(next.verification.outcome, "match");
        } else if (
          name === "ContractRelationship" &&
          ["seed", "provenance", "verification"].includes(field)
        ) {
          const proof = b.observations.find((row) => row.key === id);
          assert(proof, "missing observation receipt");
          if (proof.getterless) {
            assert(a.observations.find((row) => row.key === id)?.getterless);
            assert.equal(field, "provenance");
            assert.equal(old.value, null);
            assert.equal(next.value, null);
            assert.equal(old.seed, null);
            assert.equal(next.seed, null);
            assert.equal(old.lastChange, null);
            assert.equal(next.lastChange, null);
            same(next.provenance, next.verification.block);
            const endpoint = b.ends.find((row) => row.chainId === next.chainId);
            assert(endpoint);
            same(next.provenance, {
              number: endpoint.number,
              hash: endpoint.hash,
              timestamp: endpoint.timestamp,
            });
            assert.equal(next.verification.outcome, "unavailable");
          }
          if (field === "provenance") {
            assert.equal(old.lastChange, null);
            assert.equal(next.lastChange, null);
            same(next.provenance, next.verification.block);
          }
          if (field === "seed" && next.seed !== null)
            same(next.seed, next.verification.block);
          if (field === "verification") {
            assert.equal(next.verification.outcome, "match");
            assert.equal(next.verification.getterValue, old.value);
            const allowed = [
              "outcome",
              "block",
              "getterValue",
              "reason",
              "eventReplay",
            ];
            for (const item of [old.verification, next.verification])
              assert(
                Object.keys(item).every((field) => allowed.includes(field)),
                "unknown verification field"
              );
            assert(["match", "unperformed"].includes(old.verification.outcome));
            if (!equal(old.verification.reason, next.verification.reason)) {
              assert.equal(next.verification.reason, undefined);
              assert.equal(
                old.verification.reason,
                "Current value is derived from verified ownership events; retained RPC fields describe the last actual read."
              );
            }
            if (
              !equal(
                old.verification.eventReplay,
                next.verification.eventReplay
              )
            ) {
              assert(
                next.verification.eventReplay,
                "unknown event proof change"
              );
              if (!old.verification.eventReplay) {
                same(next.verification.eventReplay, {
                  ...proof.policy,
                  block: next.verification.block,
                });
              } else {
                const before = { ...old.verification.eventReplay },
                  after = { ...next.verification.eventReplay };
                delete before.block;
                delete after.block;
                same(before, after);
                same(
                  next.verification.eventReplay.block,
                  next.verification.block
                );
              }
            }
          }
        } else if (name === "ContractRelationship" && field === "coverage") {
          const proof = b.observations.find((row) => row.key === id);
          if (proof?.getterless && !proof.policy) {
            assert(a.observations.find((row) => row.key === id)?.getterless);
            assert.equal(next.getter, "newOwner");
            assert.equal(
              old.coverage,
              "Pending owner is event-only: no public getter; earlier nominations are unknown until a transfer request or acceptance is replayed."
            );
            assert.equal(next.coverage, null);
            assert.equal(next.seed, null);
            const latest = b.events
              .filter(
                (event) =>
                  event.chainId === next.chainId &&
                  event.address === next.subject &&
                  event.contract === "ChainlinkOwned" &&
                  [
                    "OwnershipTransferred",
                    "OwnershipTransferRequested",
                  ].includes(event.event)
              )
              .at(-1);
            assert(latest);
            same(
              {
                number: latest.blockNumber,
                hash: latest.blockHash,
                transactionHash: latest.transactionHash,
                logIndex: latest.logIndex,
              },
              {
                number: next.lastChange?.number,
                hash: next.lastChange?.hash,
                transactionHash: next.lastChange?.transactionHash,
                logIndex: next.lastChange?.logIndex,
              }
            );
          } else {
            assert(proof?.policy);
            assert.equal(
              next.coverage,
              "Source/runtime-verified ownership events maintain this value after its initial canonical getter verification."
            );
          }
        } else if (name === "ContractRelationship" && field === "targetCode") {
          const proof = b.observations.find((row) => row.key === id);
          assert.equal(old.targetCode, null);
          assert.equal(next.targetCode, proof.targetCode);
        } else if (name === "ControlTransition" && field === "previousValue") {
          same(Object.keys(old.previousValue), ["address"]);
          same(Object.keys(next.previousValue), ["address"]);
          assert.equal(next.previousValue.address, null);
          assert.match(old.previousValue.address, /^0x[0-9a-f]{40}$/);
          const log = b.events.find(
            (event) =>
              event.chainId === next.chainId &&
              event.transactionHash === next.transactionHash &&
              event.logIndex === next.logIndex &&
              event.address === next.address
          );
          assert(log);
          if (
            log.contract === "TokenAdminRegistry" &&
            log.event === "AdministratorTransferRequested"
          ) {
            const getter = `newAdministrator:${log.args.token.toLowerCase()}`;
            assert.equal(next.kind, `relationship:${getter}`);
            assert.equal(next.value.address, log.args.newAdmin.toLowerCase());
            const relationship = base.ContractRelationship.find(
              (row) =>
                row.chainId === old.chainId &&
                row.subject === old.address &&
                row.getter === getter
            );
            assert(relationship);
            const proof = a.observations.find(
              (row) => row.key === key(relationship)
            );
            assert(proof && !proof.getterless);
            const seed = base.ContractStateSeed.find(
              (row) =>
                row.chainId === old.chainId &&
                row.address === old.address &&
                row.getter === getter &&
                equal(row.boundary, proof.seed)
            );
            assert(
              seed && BigInt(seed.boundary.number) < BigInt(old.blockNumber)
            );
            assert.equal(seed.value, old.previousValue.address);
          } else {
            assert(
              ["OwnershipTransferred", "OwnershipTransferRequested"].includes(
                log.event
              )
            );
            assert.equal(
              (log.args.from ?? log.args.previousOwner)?.toLowerCase(),
              old.previousValue.address
            );
          }
          assert(
            !base.ControlTransition.some(
              (row) =>
                row.chainId === old.chainId &&
                row.address === old.address &&
                row.kind === old.kind &&
                (BigInt(row.blockNumber) < BigInt(old.blockNumber) ||
                  (row.blockNumber === old.blockNumber &&
                    row.logIndex < old.logIndex))
            )
          );
        } else if (name === "Contract" && field === "policyFunctions") {
          same(
            entityDigests(name, [old]).semantic,
            entityDigests(name, [next]).semantic
          );
        } else assert.fail(`unexplained difference: ${name}.${field}`);
        accepted.push({ table: name, id, field });
        normalized[field] = old[field];
      }
      same(normalized, old, `unexplained row difference: ${name}`);
    }
  }
  return accepted;
}

const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
const ref = (value) =>
  git("rev-parse", "--verify", "--end-of-options", `${value}^{commit}`);
const stateFor = (result) => {
  assert.match(result.diagnosticId, /^indexer-[a-f0-9-]+$/);
  const state = json(
    join(root, "benchmarks", result.diagnosticId, "1/state.private.json")
  );
  same(
    tableHashes(state),
    Object.fromEntries(
      Object.entries(result.runs[0].entities).map(([name, row]) => [
        name,
        row.exact,
      ])
    )
  );
  return state;
};
export function checkCurrentPair(baseline, candidate) {
  for (const result of [baseline, candidate]) {
    assert.deepEqual(resultProblems(result), []);
    assert.equal(
      result.source.indexerInputHash,
      runtimeHash(result.source.commit)
    );
  }
  same(baseline.inputs, candidate.inputs);
  same(baseline.treatment, candidate.treatment);
  same(baseline.source.nativeBatchSize, candidate.source.nativeBatchSize);
  same(baseline.source.lockfileHash, candidate.source.lockfileHash);

  for (const result of [baseline, candidate]) {
    assert.equal(
      result.runs[0].audit.identity.implementation,
      implementationHash
    );
    assert.equal(
      result.runs[0].audit.identity.oracleCommit,
      baseline.source.commit
    );
  }
  same(baseline.runs[0].audit.identity, candidate.runs[0].audit.identity);
  const expectedProof = ref("HEAD");
  for (const result of [baseline, candidate]) {
    const identity = result.runs[0].audit.identity;
    assert.equal(identity.proofInputHash, runtimeHash(identity.proofCommit));
    assert.equal(identity.proofInputHash, runtimeHash(expectedProof));
    assert.equal(identity.oracleInputHash, runtimeHash(baseline.source.commit));
    assert.equal(
      identity.loaderHash,
      hash(join(root, "apps/indexer/scripts/typescript-loader.mjs"))
    );
    assert.equal(
      identity.effectRuntimeHash,
      hash(join(root, "apps/indexer/scripts/fixtures/effect-runtime.mjs"))
    );
  }
  assert.equal(baseline.source.observationSchedule, "historical-checkpoints");
  assert.equal(candidate.source.observationSchedule, "current-endpoint");
  const changes = compareCurrentStates(
    stateFor(baseline),
    stateFor(candidate),
    baseline.runs[0].audit,
    candidate.runs[0].audit
  );
  same(
    baseline.runs[0].chainMeta.map(
      ({ eventsProcessed, ...progress }) => progress
    ),
    candidate.runs[0].chainMeta.map(
      ({ eventsProcessed, ...progress }) => progress
    )
  );
  return changes;
}
async function campaignWork(options) {
  const baseline = ref(options.baseline),
    candidate = ref(options.candidate ?? "HEAD");
  const directory = join(root, "benchmarks", `current-state-${randomUUID()}`);
  mkdirSync(directory, { mode: 0o700 });
  const files = { baseline: [], candidate: [] };
  const order = options.scout
    ? ["baseline"]
    : [
        "baseline",
        "candidate",
        "candidate",
        "baseline",
        "baseline",
        "candidate",
      ];
  for (const side of order) {
    const output = join(directory, `${side}-${files[side].length + 1}.json`),
      log = openSync(`${output}.log`, "w", 0o600);
    console.log(
      `Current-state ${options.scout ? "qualification" : "trial"}: ${side} ${files[side].length + 1}`
    );
    try {
      const child = spawn(
        process.execPath,
        [
          "--",
          join(root, "scripts/benchmark-indexer.mjs"),
          "--current-state",
          ...(options.profile === "four-chain"
            ? ["--native-workers", "1"]
            : []),
          "--ref",
          side === "baseline" ? baseline : candidate,
          "--oracle-ref",
          baseline,
          "--runs",
          "1",
          "--env-file",
          options["env-file"],
          "--provider-profile",
          options["provider-profile"] ?? "unspecified",
          "--output",
          output,
        ],
        { cwd: root, stdio: ["ignore", log, log] }
      );
      const cancel = () => child.kill("SIGTERM");
      process.on("SIGINT", cancel);
      process.on("SIGTERM", cancel);
      let code;
      try {
        code = await new Promise((done, reject) => {
          child.once("exit", done);
          child.once("error", reject);
        });
      } finally {
        process.off("SIGINT", cancel);
        process.off("SIGTERM", cancel);
      }
      assert.equal(code, 0, `replay failed; retained ${output}`);
    } finally {
      closeSync(log);
    }
    const result = json(output);
    assert.deepEqual(resultProblems(result), []);
    files[side].push(output);
    if (files.baseline.length && files.candidate.length)
      checkCurrentPair(
        json(files.baseline.at(-1)),
        json(files.candidate.at(-1))
      );
  }
  if (options.scout) {
    writeResult(
      resolve(
        root,
        options.output ??
          "docs/performance/indexer-current-state-comparison.json"
      ),
      {
        protocol: currentStateProtocol,
        status: "qualified",
        generatedAt: new Date().toISOString(),
        baseline,
        rawFile: {
          path: files.baseline[0].slice(root.length + 1),
          sha256: hash(files.baseline[0]),
        },
      }
    );
    console.log(`Qualified baseline: ${files.baseline[0]}`);
    return;
  }
  const aggregate = (paths) => {
    const results = paths.map(json),
      value = structuredClone(results[0]);
    for (const result of results) {
      same(result.inputs, value.inputs);
      same(result.source, value.source);
      same(result.runs[0].entities, value.runs[0].entities);
      same(result.runs[0].audit.manifestHash, value.runs[0].audit.manifestHash);
      same(result.runs[0].audit.identity, value.runs[0].audit.identity);
    }
    value.requestedRuns = 3;
    value.runs = results.map((result) => result.runs[0]);
    value.summary = summarize(value.runs);
    return value;
  };
  const a = aggregate(files.baseline),
    b = aggregate(files.candidate),
    gain =
      100 *
      (a.summary.medianCommittedSeconds / b.summary.medianCommittedSeconds - 1);
  const accepted =
    options.profile === "four-chain"
      ? gain >= -5
      : gain >= 10 &&
        Math.max(...b.runs.map((run) => run.committedSeconds)) <
          Math.min(...a.runs.map((run) => run.committedSeconds));
  const output = {
    protocol: currentStateProtocol,
    status: accepted ? "accepted" : "target-not-met",
    generatedAt: new Date().toISOString(),
    profile: options.profile ?? "ethereum",
    baseline: baseline,
    candidate: candidate,
    samples: 3,
    inputs: a.inputs,
    baselineSummary: a.summary,
    candidateSummary: b.summary,
    workCounts: {
      canonicalLogs: a.runs[0].audit.eventCounts,
      baselineBlockCallbacks: a.runs[0].audit.blockCallbacks,
      candidateBlockCallbacks: b.runs[0].audit.blockCallbacks,
    },
    initializationSeeds: a.runs[0].audit.initializationSeeds,
    throughputGainPercent: gain,
    rawFiles: Object.fromEntries(
      Object.entries(files).map(([side, paths]) => [
        side,
        paths.map((path) => ({
          path: path.slice(root.length + 1),
          sha256: hash(path),
        })),
      ])
    ),
    caveats: [
      "Audited getter/state equivalence with separately disclosed initialization seeds; deliberately fewer historical observations, block callbacks and archive records.",
      "Local cold bounded replays; no live nine-chain or provider billing claim.",
      "Oracle RPC runs after timing and is excluded from measured request counts.",
      "Pre-window Kernel executor initialization records are checked at creation and retained exactly; their endpoint executor and configured timestamp discrepancies are disclosed separately, not certified as current state.",
    ],
  };
  writeResult(
    resolve(
      root,
      options.output ?? "docs/performance/indexer-current-state-comparison.json"
    ),
    output
  );
  console.log(
    `${accepted ? "Accepted" : "Target not met"}: ${gain.toFixed(2)}% throughput change`
  );
}
async function campaign(options) {
  const output = resolve(
    root,
    options.output ?? "docs/performance/indexer-current-state-comparison.json"
  );
  writeResult(output, {
    protocol: currentStateProtocol,
    status: "running",
    generatedAt: new Date().toISOString(),
  });
  try {
    await campaignWork(options);
  } catch (error) {
    writeResult(output, {
      protocol: currentStateProtocol,
      status: "failed",
      generatedAt: new Date().toISOString(),
      failure: "current-state campaign failed; inspect private diagnostics",
    });
    throw error;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      ...Object.fromEntries(
        [
          "state",
          "source",
          "oracle-source",
          "identity",
          "output",
          "baseline",
          "candidate",
          "env-file",
          "provider-profile",
          "profile",
        ].map((name) => [name, { type: "string" }])
      ),
      audit: { type: "boolean" },
      scout: { type: "boolean" },
    },
  });
  try {
    if (values.audit) {
      const result = await auditCurrent({
        ...values,
        oracleSource: values["oracle-source"],
        identity: JSON.parse(values.identity),
      });
      writeFileSync(
        values.output,
        JSON.stringify(result, (_, value) =>
          typeof value === "bigint" ? String(value) : value
        ),
        { mode: 0o600 }
      );
    } else {
      assert(
        values.baseline && values["env-file"],
        "--baseline and --env-file are required"
      );
      assert([undefined, "ethereum", "four-chain"].includes(values.profile));
      await campaign(values);
    }
  } catch (error) {
    if (!values.audit)
      writeResult(
        resolve(
          root,
          values.output ??
            "docs/performance/indexer-current-state-comparison.json"
        ),
        {
          protocol: currentStateProtocol,
          status: "failed",
          generatedAt: new Date().toISOString(),
          failure: "current-state campaign failed; inspect private diagnostics",
        }
      );
    if (values.audit) console.error(error);
    else
      console.error(
        "Current-state benchmark failed; retain private diagnostics and inspect the first failure."
      );
    process.exitCode = 1;
  }
}
