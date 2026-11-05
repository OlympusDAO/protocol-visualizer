import { fromHex, type Address } from "viem";

import {
  getContractName,
  getContractStartBlock,
  getContractType,
} from "../ContractNames";
import type { FunctionDetails } from "../services/contracts/types";
import type {
  ActionType,
  ContractType,
  EnvioContext,
  PolicyPermission,
} from "./types";
import {
  getProcessedContract,
  getRequestedPolicyPermissions,
  getModuleKeycode,
} from "./effects";
import { getCurrentModuleAddress } from "./modules";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function parseAction(action: number): ActionType {
  switch (action) {
    case 0:
      return "installModule";
    case 1:
      return "upgradeModule";
    case 2:
      return "activatePolicy";
    case 3:
      return "deactivatePolicy";
    case 4:
      return "changeExecutor";
    case 5:
      return "migrateKernel";
    default:
      throw new Error(`Unknown Kernel action: ${action}`);
  }
}

export function parseContractType(action: number): ContractType {
  switch (action) {
    case 0:
    case 1:
      return "MODULE";
    case 2:
    case 3:
      return "POLICY";
    case 4:
    case 5:
      return "KERNEL";
    default:
      throw new Error(
        `parseContractType: Unknown/unsupported Kernel action: ${action}`
      );
  }
}

export function parseIsEnabled(action: number): boolean {
  switch (action) {
    case 0:
    case 1:
    case 2:
    case 4:
    case 5:
      return true;
    case 3:
      return false;
    default:
      throw new Error(
        `parseIsEnabled: Unknown/unsupported Kernel action: ${action}`
      );
  }
}

export async function parseContractName(
  action: number,
  target: Address,
  chainId: number,
  blockNumber: bigint,
  context: EnvioContext,
  blockHash: string
): Promise<string> {
  if (action > 1) {
    return getContractName(target, chainId);
  }

  const knownName = getContractName(target, chainId);
  if (knownName !== "UNKNOWN") {
    return knownName;
  }

  const keycodeResult = await getModuleKeycode(
    context,
    chainId,
    target,
    blockNumber,
    blockHash
  );
  const keycode = fromHex(keycodeResult, "string").replace(/\0/g, "");
  if (!/^[A-Z]{5}$/.test(keycode)) throw new Error("Invalid module keycode");
  return keycode;
}

export async function parsePolicyFunctions(
  action: number,
  policyAddress: Address,
  policyName: string,
  blockNumber: bigint,
  chainId: number,
  context: EnvioContext
): Promise<FunctionDetails[] | undefined> {
  if (action !== 2 && action !== 3) {
    return undefined;
  }

  const contractType = getContractType(policyAddress, chainId);
  if (contractType !== "policy") {
    return undefined;
  }

  const startBlock = getContractStartBlock(policyAddress, chainId);
  if (startBlock !== undefined && blockNumber < BigInt(startBlock)) {
    return undefined;
  }

  const policyFunctions = await getProcessedContract(
    context,
    chainId,
    policyAddress,
    policyName,
    blockNumber
  );

  return Object.values(policyFunctions.functionSelectors);
}

export async function parsePolicyPermissions(
  action: number,
  kernelAddress: Address,
  target: Address,
  targetName: string,
  blockNumber: bigint,
  chainId: number,
  context: EnvioContext,
  blockHash: string
): Promise<PolicyPermission[] | undefined> {
  if (action !== 2 && action !== 3) {
    return undefined;
  }

  const contractType = getContractType(target, chainId);
  if (contractType !== "policy") {
    return undefined;
  }

  const startBlock = getContractStartBlock(target, chainId);
  if (startBlock !== undefined && blockNumber < BigInt(startBlock)) {
    return undefined;
  }

  console.log(`Parsing policy permissions for ${targetName}`);

  const permissionsResult = await getRequestedPolicyPermissions(
    context,
    chainId,
    target,
    blockNumber,
    blockHash
  );

  const permissionDetails = permissionsResult
    .filter((permission) => !!permission)
    .map((permission) => {
      const moduleKeycode = fromHex(permission.keycode, "string").replace(
        /\0/g,
        ""
      );

      return {
        moduleKeycode,
        moduleKeycodeHex: permission.keycode,
        funcSelector: permission.funcSelector,
      };
    });

  const moduleAddresses = new Map<string, Address>();
  const uniqueModules = new Map(
    permissionDetails.map(({ moduleKeycode, moduleKeycodeHex }) => [
      moduleKeycode,
      moduleKeycodeHex,
    ])
  );

  await Promise.all(
    [...uniqueModules.entries()].map(
      async ([moduleKeycode, moduleKeycodeHex]) => {
        const currentModuleAddress = await getCurrentModuleAddress(
          moduleKeycode,
          moduleKeycodeHex,
          kernelAddress,
          blockNumber,
          chainId,
          context,
          blockHash
        );
        if (!currentModuleAddress) {
          throw new Error(
            `No module found for keycode ${moduleKeycode} at block ${blockNumber}`
          );
        }

        moduleAddresses.set(moduleKeycode, currentModuleAddress);
      }
    )
  );

  const policyPermissions = await Promise.all(
    permissionDetails.map(
      async (currentResult): Promise<PolicyPermission | undefined> => {
        const moduleAddress = moduleAddresses.get(currentResult.moduleKeycode);
        if (!moduleAddress || moduleAddress === ZERO_ADDRESS) {
          throw new Error(
            `No module address found in Kernel for keycode ${currentResult.moduleKeycode} at block ${blockNumber}`
          );
        }

        const moduleProcessedData = await getProcessedContract(
          context,
          chainId,
          moduleAddress,
          currentResult.moduleKeycode,
          blockNumber
        );
        const functionDetails =
          moduleProcessedData.functionSelectors[currentResult.funcSelector];

        if (!functionDetails) {
          console.warn(
            `No function details found for keycode ${currentResult.moduleKeycode} and selector ${currentResult.funcSelector} on policy ${targetName}`
          );
          return undefined;
        }

        return {
          keycode: currentResult.moduleKeycode,
          function:
            functionDetails.canonicalSignature ?? functionDetails.signature,
          ...(functionDetails.documentation
            ? { functionContext: functionDetails.documentation }
            : {}),
        };
      }
    )
  );

  return policyPermissions.filter(
    (permission): permission is PolicyPermission => !!permission
  );
}
