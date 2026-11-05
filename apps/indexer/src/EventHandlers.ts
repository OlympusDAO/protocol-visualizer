import { indexer } from "envio";
import {
  FULL_VERIFICATION_VERSION,
  OBSERVATION_BLOCK_INTERVAL,
} from "../../../packages/snapshot-artifacts/src/observation-constants";
import { getKernelConstants } from "./constants";
import {
  bridgeAnchorsCanonical,
  completeBridgeConfigurations,
  getBridgeContracts,
  handleBridgeConfigurationEvent,
} from "./events/bridge-config";
import { withCanonicalObservation } from "./events/canonical-observation";
import { setControlCapability } from "./events/control-state";
import {
  getBridgeConfiguration,
  getCanonicalCodeHash,
  getControlGetter,
  getModuleDependencies,
} from "./events/effects";
import {
  completeEnablementBlock,
  controlAnchorsCanonical,
  type EnablerContract,
  handleEnablementEvent,
} from "./events/enabler";
import {
  getEnablerCapability,
  getEnablerContracts,
} from "./events/enabler-contracts";
import {
  completeHeartTasks,
  getLegacyTaskContracts,
  getPeriodicTaskManagers,
  handleLegacyTaskEvent,
  handlePeriodicTaskEvent,
  heartTaskAnchorsCanonical,
  observeLegacyTaskState,
} from "./events/heart-tasks";
import { handleKernelActionExecuted } from "./events/kernel";
import { getCoreContracts, seedCoreContracts } from "./events/kernel-history";
import { createLiveObservation } from "./events/live-observation";
import {
  completeModuleDependencies,
  getModuleDependencyFields,
} from "./events/module-dependencies";
import {
  completeRelationshipBlock,
  handleAuthorityEvent,
  handleAuthorityReference,
  handleChainlinkOwnershipEvent,
  handleContractReference,
  handleOpenZeppelinOwnershipEvent,
  handleOwnershipEvent,
  handleRegistryEvent,
  handleStakingReference,
  type RelationshipField,
  relationshipAnchorsCanonical,
} from "./events/ownership";
import {
  getCcipRegistry,
  getObservedAuthorityFields,
  getObservedPoolFields,
  getRelationshipFields,
} from "./events/ownership-contracts";
import { configureOwnershipEventFields } from "./events/ownership-policy";
import {
  handleNewAdminPulled,
  handleRoleGranted,
  handleRoleRevoked,
} from "./events/roles";
import { getPublicClient } from "./events/rpc";
import type {
  EnvioContext,
  KernelActionExecutedEvent,
  NewAdminPulledEvent,
  RoleGrantedEvent,
  RoleRevokedEvent,
} from "./events/types";

for (const event of ["PeriodicTaskAdded", "PeriodicTaskRemoved"] as const) {
  indexer.onEvent(
    {
      contract: "PeriodicTaskManager",
      event,
      fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
    },
    ({ event: log, context }) =>
      handlePeriodicTaskEvent(context as EnvioContext, log, event)
  );
}
for (const event of ["Activated", "Deactivated", "Shutdown"] as const) {
  indexer.onEvent(
    {
      contract: "LegacyPeriodicTask",
      event,
      fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
    },
    ({ event: log, context }) =>
      handleLegacyTaskEvent(context as EnvioContext, log, event === "Activated")
  );
}

indexer.onEvent(
  {
    contract: "MonoCoolerReferences",
    event: "LtvOracleSet",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleContractReference(
      context as EnvioContext,
      event,
      "ltvOracle",
      event.params.oracle
    )
);
indexer.onEvent(
  {
    contract: "MonoCoolerReferences",
    event: "TreasuryBorrowerSet",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleContractReference(
      context as EnvioContext,
      event,
      "treasuryBorrower",
      event.params.treasuryBorrower
    )
);

indexer.onEvent(
  {
    contract: "Kernel",
    event: "ActionExecuted",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  async ({ event, context }) => {
    await handleKernelActionExecuted(
      event as unknown as KernelActionExecutedEvent,
      context as EnvioContext
    );
    const controlContext = context as EnvioContext;
    for (const address of [event.srcAddress, event.params.target_]) {
      await setControlCapability(
        controlContext,
        event.chainId,
        address,
        getEnablerCapability(event.chainId, address)
      );
    }
  }
);

indexer.onEvent(
  {
    contract: "IEnabler",
    event: "Enabled",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleEnablementEvent(context as EnvioContext, event, "Enabled", "v1")
);
indexer.onEvent(
  {
    contract: "IEnabler",
    event: "Disabled",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleEnablementEvent(context as EnvioContext, event, "Disabled", "v1")
);
indexer.onEvent(
  {
    contract: "IEnablerV2",
    event: "Transition",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleEnablementEvent(context as EnvioContext, event, "Transition", "v2")
);

indexer.onEvent(
  {
    contract: "Owned",
    event: "OwnershipTransferred",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) => handleOwnershipEvent(context as EnvioContext, event)
);
indexer.onEvent(
  {
    contract: "Owned",
    event: "OwnershipTransferStarted",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleOpenZeppelinOwnershipEvent(
      context as EnvioContext,
      event,
      "OwnershipTransferStarted"
    )
);
for (const action of [
  "OwnershipTransferRequested",
  "OwnershipTransferred",
] as const) {
  indexer.onEvent(
    {
      contract: "ChainlinkOwned",
      event: action,
      fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
    },
    ({ event, context }) =>
      handleChainlinkOwnershipEvent(
        context as EnvioContext,
        event,
        action,
        indexer.chains[event.chainId].TokenAdminRegistry.addresses.some(
          (address) => address.toLowerCase() === event.srcAddress.toLowerCase()
        )
          ? "registry-owner"
          : "pool-owner"
      )
  );
}
indexer.contractRegister(
  { contract: "TokenAdminRegistry", event: "PoolSet" },
  async ({ event, context }) => {
    const registry = getCcipRegistry(event.chainId);
    if (
      registry?.token === event.params.token.toLowerCase() &&
      !/^0x0{40}$/i.test(event.params.newPool)
    ) {
      context.chain.ChainlinkOwned.add(event.params.newPool);
      context.chain.CCIPTokenPool.add(event.params.newPool);
    }
  }
);
for (const action of [
  "ChainAdded",
  "ChainConfigured",
  "ChainRemoved",
  "RemotePoolAdded",
  "RemotePoolRemoved",
  "AllowListAdd",
  "AllowListRemove",
  "RouterUpdated",
] as const) {
  indexer.onEvent(
    {
      contract: "CCIPTokenPool",
      event: action,
      fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
    },
    ({ event, context }) =>
      handleBridgeConfigurationEvent(context as EnvioContext, event, "pool")
  );
}
for (const action of [
  "TrustedRemoteEVMSet",
  "TrustedRemoteEVMUnset",
  "TrustedRemoteSVMSet",
  "TrustedRemoteSVMUnset",
] as const) {
  indexer.onEvent(
    {
      contract: "CCIPBridge",
      event: action,
      fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
    },
    ({ event, context }) =>
      handleBridgeConfigurationEvent(context as EnvioContext, event, "bridge")
  );
}
for (const action of [
  "AdministratorTransferRequested",
  "AdministratorTransferred",
  "PoolSet",
] as const) {
  indexer.onEvent(
    {
      contract: "TokenAdminRegistry",
      event: action,
      fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
    },
    async ({ event, context }) => {
      const registry = getCcipRegistry(event.chainId);
      if (registry)
        await handleRegistryEvent(
          context as EnvioContext,
          event,
          action,
          registry.token
        );
    }
  );
}
indexer.contractRegister(
  { contract: "OlympusAccessControlled", event: "AuthorityUpdated" },
  async ({ event, context }) => {
    if (!/^0x0{40}$/i.test(event.params.authority))
      context.chain.OlympusAuthority.add(event.params.authority);
  }
);
indexer.onEvent(
  {
    contract: "OlympusAccessControlled",
    event: "AuthorityUpdated",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleAuthorityReference(context as EnvioContext, event)
);
indexer.onEvent(
  {
    contract: "StakedOHM",
    event: "LogStakingContractUpdated",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) => handleStakingReference(context as EnvioContext, event)
);
indexer.onEvent(
  {
    contract: "OlympusAuthority",
    event: "GovernorPushed",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleAuthorityEvent(context as EnvioContext, event, "governor", "Pushed")
);
indexer.onEvent(
  {
    contract: "OlympusAuthority",
    event: "GovernorPulled",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleAuthorityEvent(context as EnvioContext, event, "governor", "Pulled")
);
indexer.onEvent(
  {
    contract: "OlympusAuthority",
    event: "GuardianPushed",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleAuthorityEvent(context as EnvioContext, event, "guardian", "Pushed")
);
indexer.onEvent(
  {
    contract: "OlympusAuthority",
    event: "GuardianPulled",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleAuthorityEvent(context as EnvioContext, event, "guardian", "Pulled")
);
indexer.onEvent(
  {
    contract: "OlympusAuthority",
    event: "PolicyPushed",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleAuthorityEvent(context as EnvioContext, event, "policy", "Pushed")
);
indexer.onEvent(
  {
    contract: "OlympusAuthority",
    event: "PolicyPulled",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleAuthorityEvent(context as EnvioContext, event, "policy", "Pulled")
);
indexer.onEvent(
  {
    contract: "OlympusAuthority",
    event: "VaultPushed",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleAuthorityEvent(context as EnvioContext, event, "vault", "Pushed")
);
indexer.onEvent(
  {
    contract: "OlympusAuthority",
    event: "VaultPulled",
    fields: { block: ["hash", "timestamp"], transaction: ["hash"] },
  },
  ({ event, context }) =>
    handleAuthorityEvent(context as EnvioContext, event, "vault", "Pulled")
);
for (const chainId of indexer.chainIds) {
  const chain = indexer.chains[chainId];
  const coreContracts = getCoreContracts(chainId);
  const taskManagers = getPeriodicTaskManagers(chainId);
  const legacyTasks = getLegacyTaskContracts(chainId);
  const known = getEnablerContracts(chainId);
  const contracts: EnablerContract[] = [
    ...chain.IEnabler.addresses.map((address) => ({
      address,
      dialect: "v1" as const,
    })),
    ...chain.IEnablerV2.addresses.map((address) => ({
      address,
      dialect: "v2" as const,
    })),
  ].map((contract) => ({
    ...contract,
    startBlock:
      known.find(({ address }) => address === contract.address.toLowerCase())
        ?.startBlock ?? chain.startBlock,
  }));
  const knownRelationships = getRelationshipFields(chainId, chain.startBlock);
  const relationshipFields: RelationshipField[] = [];
  for (const [name, getters] of [
    ["Owned", ["owner"]],
    ["ChainlinkOwned", ["owner", "newOwner"]],
    ["OlympusAccessControlled", ["authority"]],
    ["StakedOHM", ["stakingContract"]],
    ["GovernanceOHM", ["approved"]],
    [
      "OlympusAuthority",
      [
        "governor",
        "newGovernor",
        "guardian",
        "newGuardian",
        "policy",
        "newPolicy",
        "vault",
        "newVault",
      ],
    ],
  ] as const) {
    for (const address of chain[name].addresses)
      for (const getter of getters) {
        const known = knownRelationships.find(
          (field) =>
            field.address === address.toLowerCase() && field.getter === getter
        );
        relationshipFields.push(
          known ?? {
            address,
            startBlock: chain.startBlock,
            getter,
            kind:
              name === "ChainlinkOwned"
                ? chain.TokenAdminRegistry.addresses.some(
                    (registry) =>
                      registry.toLowerCase() === address.toLowerCase()
                  )
                  ? "registry-owner"
                  : "pool-owner"
                : getter === "authority"
                  ? "authority-reference"
                  : getter === "stakingContract"
                    ? "staking-contract"
                    : getter === "approved"
                      ? "legacy-minter"
                      : getter.startsWith("new")
                        ? getter.slice(3).toLowerCase()
                        : getter,
            ...(getter === "approved"
              ? {
                  coverage:
                    "getter-only: gOHM.migrate changes approved without a change event; observed at checkpoints",
                }
              : {}),
          }
        );
      }
  }
  const registryToken = getCcipRegistry(chainId)?.token;
  if (registryToken)
    for (const address of chain.TokenAdminRegistry.addresses) {
      for (const getter of ["administrator", "newAdministrator", "getPool"]) {
        const scopedGetter = `${getter}:${registryToken}`;
        relationshipFields.push(
          knownRelationships.find(
            (field) =>
              field.address === address.toLowerCase() &&
              field.getter === scopedGetter
          ) ?? {
            address: address.toLowerCase(),
            startBlock: chain.startBlock,
            getter: scopedGetter,
            kind: getter === "getPool" ? "registered-pool" : "token-admin",
            scope: { registry: address.toLowerCase(), token: registryToken },
          }
        );
      }
    }
  for (const field of knownRelationships) {
    if (
      !relationshipFields.some(
        (existing) =>
          existing.address.toLowerCase() === field.address &&
          existing.getter === field.getter
      )
    )
      relationshipFields.push(field);
  }
  const complete = async (context: EnvioContext, number: number) => {
    const verified = await withCanonicalObservation(
      chainId,
      BigInt(number),
      async ({ block, readBlock, readCanonicalBlock }) => {
        const ownershipFields = (fields: RelationshipField[]) =>
          configureOwnershipEventFields(chainId, fields, {
            Owned: chain.Owned.addresses,
            ChainlinkOwned: chain.ChainlinkOwned.addresses,
            TokenAdminRegistry: chain.TokenAdminRegistry.addresses,
          });
        const readGetter = (address: string, getter: string) =>
          getControlGetter(
            context,
            {
              chainId,
              address: address as `0x${string}`,
              blockNumber: BigInt(number),
              blockHash: block.hash,
              getter,
            },
            block,
            readCanonicalBlock
          );
        if (
          !(await heartTaskAnchorsCanonical(
            context,
            chainId,
            block,
            taskManagers
              .filter((manager) => manager.startBlock <= number)
              .map((manager) => manager.address),
            readBlock
          ))
        )
          return;
        if (
          !(await controlAnchorsCanonical(
            context,
            chainId,
            block,
            legacyTasks
              .filter((task) => task.startBlock <= number)
              .map((task) => task.address),
            readBlock
          ))
        )
          return;
        const dependencyFields = await getModuleDependencyFields(
          context,
          chainId
        );
        if (
          !(await relationshipAnchorsCanonical(
            context,
            chainId,
            block,
            dependencyFields,
            readBlock
          ))
        )
          return;
        const observedFields = ownershipFields(
          await getObservedPoolFields(
            context,
            chainId,
            await getObservedAuthorityFields(
              context,
              chainId,
              relationshipFields
            )
          )
        );
        if (
          !(await bridgeAnchorsCanonical(
            context,
            chainId,
            block,
            getBridgeContracts(chainId, observedFields),
            readBlock
          ))
        )
          return;
        if (
          !(await relationshipAnchorsCanonical(
            context,
            chainId,
            block,
            observedFields,
            readBlock
          ))
        )
          return;
        const enabledComplete = await completeEnablementBlock(
          context,
          chainId,
          block,
          contracts,
          (address) => readGetter(address, "isEnabled"),
          readBlock
        );
        if (!enabledComplete) return;
        for (const manager of taskManagers.filter(
          (manager) => manager.startBlock <= number
        ))
          await completeHeartTasks(
            context,
            chainId,
            manager.address,
            block,
            await readGetter(manager.address, "getPeriodicTasks")
          );
        for (const task of legacyTasks.filter(
          (task) => task.startBlock <= number
        ))
          await observeLegacyTaskState(
            context,
            chainId,
            task.address,
            block,
            task.getter,
            await readGetter(task.address, task.getter)
          );
        const completed = await completeRelationshipBlock(
          context,
          chainId,
          block,
          observedFields,
          readGetter,
          readBlock
        );
        if (!completed) return;
        const expanded = ownershipFields(
          await getObservedPoolFields(
            context,
            chainId,
            await getObservedAuthorityFields(context, chainId, observedFields)
          )
        );
        if (
          expanded.length !== observedFields.length &&
          !(await completeRelationshipBlock(
            context,
            chainId,
            block,
            expanded,
            readGetter,
            readBlock
          ))
        )
          return false;
        if (
          !(await completeModuleDependencies(
            context,
            chainId,
            block,
            dependencyFields,
            (keycode) =>
              getModuleDependencies(
                context,
                {
                  chainId,
                  kernel: getKernelConstants(chainId).address,
                  keycode,
                  blockNumber: BigInt(block.number),
                  blockHash: block.hash,
                },
                readCanonicalBlock
              ),
            readBlock
          ))
        )
          return;
        await seedCoreContracts(
          context,
          chainId,
          chain.startBlock,
          block,
          coreContracts,
          async (address) =>
            Boolean(
              await getCanonicalCodeHash(
                context,
                {
                  chainId,
                  address,
                  blockNumber: BigInt(block.number),
                  blockHash: block.hash,
                },
                readCanonicalBlock
              )
            )
        );
        await completeBridgeConfigurations(
          context,
          chainId,
          block,
          getBridgeContracts(chainId, expanded),
          (contract, selectors) =>
            getBridgeConfiguration(
              context,
              {
                chainId,
                ...contract,
                selectors,
                blockNumber: BigInt(block.number),
                blockHash: block.hash,
              },
              readCanonicalBlock
            )
        );
        return true;
      }
    );
    context.ChainObservation.set({
      id: String(chainId),
      indexedThrough: verified,
      verificationVersion: FULL_VERIFICATION_VERSION,
    });
  };
  // Creation boundaries run after constructor logs; a truncated replay seeds at its own start.
  for (const boundary of new Set(
    coreContracts.map(({ startBlock }) =>
      Math.max(startBlock ?? chain.startBlock, chain.startBlock)
    )
  )) {
    if (chain.endBlock !== undefined && boundary > chain.endBlock) continue;
    indexer.onBlock(
      {
        name: `control-seed-${chainId}-${boundary}`,
        where: ({ chain: candidate }) =>
          candidate.id === chainId
            ? { block: { number: { _gte: boundary, _lte: boundary } } }
            : false,
      },
      async ({ block, context }) => {
        const born = coreContracts.filter(
          (contract) =>
            Math.max(
              contract.startBlock ?? chain.startBlock,
              chain.startBlock
            ) === boundary
        );
        await withCanonicalObservation(
          chainId,
          BigInt(block.number),
          async ({ block, readCanonicalBlock }) => {
            await seedCoreContracts(
              context as EnvioContext,
              chainId,
              chain.startBlock,
              block,
              born,
              async (address) =>
                Boolean(
                  await getCanonicalCodeHash(
                    context as EnvioContext,
                    {
                      chainId,
                      address,
                      blockNumber: BigInt(block.number),
                      blockHash: block.hash,
                    },
                    readCanonicalBlock
                  )
                )
            );
            return true;
          }
        );
      }
    );
  }
  if (chain.endBlock === undefined) {
    indexer.onBlock(
      {
        name: `control-realtime-${chainId}`,
        where: ({ chain: candidate }) =>
          candidate.id === chainId
            ? { block: { number: { _every: OBSERVATION_BLOCK_INTERVAL } } }
            : false,
      },
      createLiveObservation(
        () => getPublicClient(chainId).getBlockNumber({ cacheTime: 0 }),
        (context, number) => complete(context as EnvioContext, number)
      )
    );
  }
  if (chain.endBlock !== undefined) {
    indexer.onBlock(
      {
        name: `control-end-${chainId}`,
        where: ({ chain: candidate }) =>
          candidate.id === chainId
            ? {
                block: {
                  number: { _gte: chain.endBlock, _lte: chain.endBlock },
                },
              }
            : false,
      },
      ({ block, context }) => complete(context as EnvioContext, block.number)
    );
  }
}

indexer.onEvent(
  {
    contract: "OlympusRoles",
    event: "RoleGranted",
  },
  ({ event, context }) =>
    handleRoleGranted(
      event as unknown as RoleGrantedEvent,
      context as EnvioContext
    )
);

indexer.onEvent(
  {
    contract: "OlympusRoles",
    event: "RoleRevoked",
  },
  async ({ event, context }) => {
    await handleRoleRevoked(
      event as unknown as RoleRevokedEvent,
      context as EnvioContext
    );
  }
);

indexer.onEvent(
  {
    contract: "RolesAdmin",
    event: "NewAdminPulled",
  },
  async ({ event, context }) => {
    await handleNewAdminPulled(
      event as unknown as NewAdminPulledEvent,
      context as EnvioContext
    );
  }
);
