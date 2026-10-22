import { indexer } from "envio";
import {
  getRelationshipFields,
  getObservedAuthorityFields,
} from "./events/ownership-contracts";
import {
  handleOwnershipEvent,
  handleAuthorityEvent,
  handleAuthorityReference,
  handleStakingReference,
  completeRelationshipBlock,
  relationshipAnchorsCanonical,
  type RelationshipField,
} from "./events/ownership";
import {
  getEnablerCapability,
  getEnablerContracts,
} from "./events/enabler-contracts";
import {
  handleEnablementEvent,
  completeEnablementBlock,
  type EnablerContract,
} from "./events/enabler";
import { getControlBlock, getControlGetter } from "./events/effects";
import { setControlCapability } from "./events/control-state";

import { handleKernelActionExecuted } from "./events/kernel";
import {
  handleNewAdminPulled,
  handleRoleGranted,
  handleRoleRevoked,
} from "./events/roles";
import type {
  EnvioContext,
  KernelActionExecutedEvent,
  NewAdminPulledEvent,
  RoleGrantedEvent,
  RoleRevokedEvent,
} from "./events/types";

indexer.onEvent(
  {
    contract: "Kernel",
    event: "ActionExecuted",
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
  const knownRelationships = getRelationshipFields(chainId);
  const relationshipFields: RelationshipField[] = [];
  for (const [name, getters] of [
    ["Owned", ["owner"]],
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
              getter === "authority"
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
  const complete = async (context: EnvioContext, number: number) => {
    const block = await getControlBlock(context, chainId, number);
    if (!block) return;
    const observedFields = await getObservedAuthorityFields(
      context,
      chainId,
      relationshipFields
    );
    if (
      !(await relationshipAnchorsCanonical(
        context,
        chainId,
        block,
        observedFields,
        (number) => getControlBlock(context, chainId, Number(number))
      ))
    )
      return;
    const enabledComplete = await completeEnablementBlock(
      context,
      chainId,
      block,
      contracts,
      (address) =>
        getControlGetter(context, {
          chainId,
          address: address as `0x${string}`,
          blockNumber: BigInt(number),
          blockHash: block.hash,
          getter: "isEnabled",
        }),
      (number) => getControlBlock(context, chainId, Number(number))
    );
    if (!enabledComplete) return;
    await completeRelationshipBlock(
      context,
      chainId,
      block,
      observedFields,
      (address, getter) =>
        getControlGetter(context, {
          chainId,
          address: address as `0x${string}`,
          blockNumber: BigInt(number),
          blockHash: block.hash,
          getter,
        }),
      (number) => getControlBlock(context, chainId, Number(number))
    );
  };
  // Creation boundaries run after constructor logs; a truncated replay seeds at its own start.
  for (const boundary of new Set(
    [...contracts, ...relationshipFields].map(({ startBlock }) =>
      Math.max(startBlock, chain.startBlock)
    )
  )) {
    indexer.onBlock(
      {
        name: `control-seed-${chainId}-${boundary}`,
        where: ({ chain: candidate }) =>
          candidate.id === chainId
            ? { block: { number: { _gte: boundary, _lte: boundary } } }
            : false,
      },
      ({ block, context }) => complete(context as EnvioContext, block.number)
    );
  }
  indexer.onBlock(
    {
      name: `control-checkpoint-${chainId}`,
      where: ({ chain: candidate }) =>
        candidate.id === chainId
          ? { block: { number: { _every: 10_000 } } }
          : false,
    },
    ({ block, context }) => complete(context as EnvioContext, block.number)
  );
  indexer.onBlock(
    {
      name: `control-realtime-${chainId}`,
      where: ({ chain: candidate }) =>
        candidate.id === chainId
          ? { block: { number: { _every: 100 } } }
          : false,
    },
    async ({ block, context }) => {
      if (context.chain.isRealtime)
        await complete(context as EnvioContext, block.number);
    }
  );
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
