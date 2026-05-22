import type { Address, Hex } from "viem";

import { contractId, currentModuleId } from "./ids";
import type {
  ContractEntity,
  CurrentModuleEntity,
  EnvioContext,
} from "./types";
import { readModuleForKeycodeEffect } from "./effects";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const currentModuleCache = new Map<string, CurrentModuleEntity>();

export async function getCurrentModuleAddress(
  keycode: string,
  keycodeHex: Hex,
  kernelAddress: Address,
  blockNumber: bigint,
  chainId: number,
  context: EnvioContext
): Promise<Address | null> {
  const id = currentModuleId(chainId, keycode);
  const cached = currentModuleCache.get(id);
  if (cached?.address) {
    return cached.address as Address;
  }

  const currentModule =
    await context.CurrentModule.get<CurrentModuleEntity>(id);
  if (currentModule?.address) {
    currentModuleCache.set(id, currentModule);
    return currentModule.address as Address;
  }

  const moduleAddress = await context.effect(readModuleForKeycodeEffect, {
    chainId,
    kernelAddress,
    keycodeHex,
    blockNumber,
  });

  if (moduleAddress === ZERO_ADDRESS) {
    return null;
  }

  const currentModuleEntity = {
    id,
    chainId,
    keycode,
    address: moduleAddress,
    lastUpdatedTimestamp: 0n,
    lastUpdatedBlockNumber: blockNumber,
  };
  currentModuleCache.set(id, currentModuleEntity);
  context.CurrentModule.set(currentModuleEntity);

  return moduleAddress;
}

export async function getPreviousModule(
  keycode: string,
  chainId: number,
  context: EnvioContext
): Promise<ContractEntity | undefined> {
  const currentModule = await context.CurrentModule.get<CurrentModuleEntity>(
    currentModuleId(chainId, keycode)
  );
  if (!currentModule) {
    return undefined;
  }

  return context.Contract.get<ContractEntity>(
    contractId(chainId, currentModule.address)
  );
}

export function setCurrentModule(
  context: EnvioContext,
  chainId: number,
  keycode: string,
  address: Address,
  timestamp: bigint,
  blockNumber: bigint
): void {
  const currentModule = {
    id: currentModuleId(chainId, keycode),
    chainId,
    keycode,
    address,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
  };

  currentModuleCache.set(currentModule.id, currentModule);
  context.CurrentModule.set(currentModule);
}
