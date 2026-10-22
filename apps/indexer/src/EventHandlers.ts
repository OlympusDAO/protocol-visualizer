import { indexer } from "envio";
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
  const complete = async (context: EnvioContext, number: number) => {
    const block = await getControlBlock(context, chainId, number);
    if (!block) return;
    await completeEnablementBlock(
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
  };
  // Creation boundaries run after constructor logs; a truncated replay seeds at its own start.
  for (const boundary of new Set(
    contracts.map(({ startBlock }) => Math.max(startBlock, chain.startBlock))
  )) {
    indexer.onBlock(
      {
        name: `enabler-seed-${chainId}-${boundary}`,
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
      name: `enabler-checkpoint-${chainId}`,
      where: ({ chain: candidate }) =>
        candidate.id === chainId
          ? { block: { number: { _every: 10_000 } } }
          : false,
    },
    ({ block, context }) => complete(context as EnvioContext, block.number)
  );
  indexer.onBlock(
    {
      name: `enabler-realtime-${chainId}`,
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
        name: `enabler-end-${chainId}`,
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
