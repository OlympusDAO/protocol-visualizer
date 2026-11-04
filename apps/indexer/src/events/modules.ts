import type { Address, Hex } from "viem";

import { contractId, currentModuleId } from "./ids";
import type {
  ContractEntity,
  CurrentModuleEntity,
  EnvioContext,
} from "./types";
import { getModuleForKeycode } from "./effects";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export async function getCurrentModuleAddress(
  keycode: string,
  keycodeHex: Hex,
  kernelAddress: Address,
  blockNumber: bigint,
  chainId: number,
  context: EnvioContext,
  blockHash: string
): Promise<Address | null> {
  const id = currentModuleId(chainId, keycode);
  const currentModule =
    await context.CurrentModule.get<CurrentModuleEntity>(id);
  if (currentModule?.address) {
    return currentModule.address as Address;
  }

  const moduleAddress = await getModuleForKeycode(
    context,
    chainId,
    kernelAddress,
    keycodeHex,
    blockNumber,
    blockHash
  );

  if (moduleAddress === ZERO_ADDRESS) {
    return null;
  }

  const currentModuleEntity = {
    id,
    keycode,
    address: moduleAddress,
    lastUpdatedTimestamp: 0n,
    lastUpdatedBlockNumber: blockNumber,
  };
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
    keycode,
    address,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
  };

  context.CurrentModule.set(currentModule);
}
