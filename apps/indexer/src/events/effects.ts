import { createEffect, S } from "envio";
import type { Address, Hex } from "viem";

import { KernelAbi } from "../../abis/Kernel";
import { ModuleAbi } from "../../abis/Module";
import { PolicyAbi } from "../../abis/Policy";
import { RolesAdminAbi } from "../../abis/RolesAdmin";
import { ContractProcessor } from "../services/contracts/processor";
import type { ProcessedContractData } from "../services/contracts/types";
import type {
  EnvioContext,
  RequestedPolicyPermission,
  RequestedPolicyPermissionsResult,
} from "./types";
import { normalizeAddress } from "./ids";
import { getPublicClient, isHistoricalStateUnavailable } from "./rpc";

const contractProcessors = new Map<number, ContractProcessor>();
const processedContracts = new Map<string, Promise<ProcessedContractData>>();
const requestedPolicyPermissions = new Map<
  string,
  Promise<readonly RequestedPolicyPermission[]>
>();

const requestedPolicyPermissionSchema = S.schema({
  keycode: S.string,
  funcSelector: S.string,
});

const functionDetailsSchema = S.schema({
  name: S.string,
  selector: S.string,
  signature: S.string,
  roles: S.array(S.string),
});

const processedContractDataSchema = S.schema({
  roleToFunctions: S.record(S.array(S.string)),
  functionSelectors: S.record(functionDetailsSchema),
});

const processContractMetadataEffect = createEffect(
  {
    name: "processContractMetadata",
    input: {
      chainId: S.number,
      address: S.address,
      name: S.string,
    },
    output: processedContractDataSchema,
    rateLimit: { calls: 5, per: "second" },
    cache: true,
  },
  async ({ input }) =>
    getContractProcessor(input.chainId).processContract(
      input.address,
      input.name
    )
);

export const readPolicyPermissionsEffect = createEffect(
  {
    name: "readPolicyPermissions",
    input: {
      chainId: S.number,
      policyAddress: S.address,
      blockNumber: S.bigint,
    },
    output: {
      permissions: S.array(requestedPolicyPermissionSchema),
      usedLatestFallback: S.boolean,
    },
    rateLimit: { calls: 25, per: "second" },
    cache: true,
  },
  async ({ input, context }): Promise<RequestedPolicyPermissionsResult> => {
    try {
      const permissions = await getPublicClient(input.chainId).readContract({
        abi: PolicyAbi,
        address: input.policyAddress,
        functionName: "requestPermissions",
        args: [],
        blockNumber: input.blockNumber,
      });

      return {
        permissions: permissions.map((permission) => ({
          keycode: permission.keycode,
          funcSelector: permission.funcSelector,
        })),
        usedLatestFallback: false,
      };
    } catch (error) {
      if (!isHistoricalStateUnavailable(error)) {
        throw error;
      }

      context.cache = false;
      context.log.warn(
        `Historical requestPermissions unavailable for ${input.policyAddress} on chain ${input.chainId} at block ${input.blockNumber}; retrying at latest block`
      );

      const permissions = await getPublicClient(input.chainId).readContract({
        abi: PolicyAbi,
        address: input.policyAddress,
        functionName: "requestPermissions",
        args: [],
      });

      return {
        permissions: permissions.map((permission) => ({
          keycode: permission.keycode,
          funcSelector: permission.funcSelector,
        })),
        usedLatestFallback: true,
      };
    }
  }
);

export const readModuleKeycodeEffect = createEffect(
  {
    name: "readModuleKeycode",
    input: {
      chainId: S.number,
      moduleAddress: S.address,
      blockNumber: S.bigint,
    },
    output: {
      keycode: S.string,
      usedLatestFallback: S.boolean,
    },
    rateLimit: { calls: 25, per: "second" },
    cache: true,
  },
  async ({
    input,
    context,
  }): Promise<{ keycode: Hex; usedLatestFallback: boolean }> => {
    try {
      return {
        keycode: await getPublicClient(input.chainId).readContract({
          abi: ModuleAbi,
          address: input.moduleAddress,
          functionName: "KEYCODE",
          args: [],
          blockNumber: input.blockNumber,
        }),
        usedLatestFallback: false,
      };
    } catch (error) {
      if (!isHistoricalStateUnavailable(error)) {
        throw error;
      }

      context.cache = false;
      context.log.warn(
        `Historical KEYCODE unavailable for ${input.moduleAddress} on chain ${input.chainId} at block ${input.blockNumber}; retrying at latest block`
      );

      return {
        keycode: await getPublicClient(input.chainId).readContract({
          abi: ModuleAbi,
          address: input.moduleAddress,
          functionName: "KEYCODE",
          args: [],
        }),
        usedLatestFallback: true,
      };
    }
  }
);

export const readModuleForKeycodeEffect = createEffect(
  {
    name: "readModuleForKeycode",
    input: {
      chainId: S.number,
      kernelAddress: S.address,
      keycodeHex: S.string,
      blockNumber: S.bigint,
    },
    output: S.address,
    rateLimit: { calls: 25, per: "second" },
    cache: true,
  },
  async ({ input }) =>
    getPublicClient(input.chainId).readContract({
      abi: KernelAbi,
      address: input.kernelAddress,
      functionName: "getModuleForKeycode",
      args: [input.keycodeHex as Hex],
      blockNumber: input.blockNumber,
    })
);

const readKernelExecutorEffect = createEffect(
  {
    name: "readKernelExecutor",
    input: {
      chainId: S.number,
      kernelAddress: S.address,
      blockNumber: S.optional(S.bigint),
    },
    output: S.address,
    rateLimit: { calls: 25, per: "second" },
    cache: true,
  },
  async ({ input }) =>
    getPublicClient(input.chainId).readContract({
      abi: KernelAbi,
      address: input.kernelAddress,
      functionName: "executor",
      args: [],
      ...(input.blockNumber ? { blockNumber: input.blockNumber } : {}),
    })
);

const readRolesAdminEffect = createEffect(
  {
    name: "readRolesAdmin",
    input: {
      chainId: S.number,
      rolesAdminAddress: S.address,
      blockNumber: S.optional(S.bigint),
    },
    output: S.address,
    rateLimit: { calls: 25, per: "second" },
    cache: true,
  },
  async ({ input }) =>
    getPublicClient(input.chainId).readContract({
      abi: RolesAdminAbi,
      address: input.rolesAdminAddress,
      functionName: "admin",
      ...(input.blockNumber ? { blockNumber: input.blockNumber } : {}),
    })
);

function getContractProcessor(chainId: number): ContractProcessor {
  const processor = contractProcessors.get(chainId);
  if (processor) {
    return processor;
  }

  const newProcessor = new ContractProcessor(undefined, chainId);
  contractProcessors.set(chainId, newProcessor);

  return newProcessor;
}

export function getProcessedContract(
  context: EnvioContext,
  chainId: number,
  address: Address,
  name: string
): Promise<ProcessedContractData> {
  const cacheKey = `${chainId}:${normalizeAddress(address)}`;
  const cached = processedContracts.get(cacheKey);
  if (cached) {
    return cached;
  }

  const processedContract = context
    .effect(processContractMetadataEffect, { chainId, address, name })
    .catch((error) => {
      processedContracts.delete(cacheKey);
      throw error;
    }) as Promise<ProcessedContractData>;
  processedContracts.set(cacheKey, processedContract);

  return processedContract;
}

export function getRequestedPolicyPermissions(
  context: EnvioContext,
  chainId: number,
  policyAddress: Address,
  blockNumber: bigint
): Promise<readonly RequestedPolicyPermission[]> {
  const cacheKey = `${chainId}:${normalizeAddress(policyAddress)}:${blockNumber.toString()}`;
  const cached = requestedPolicyPermissions.get(cacheKey);
  if (cached) {
    return cached;
  }

  const permissions = context
    .effect(readPolicyPermissionsEffect, {
      chainId,
      policyAddress,
      blockNumber,
    })
    .then((result) => {
      if (result.usedLatestFallback) {
        requestedPolicyPermissions.delete(cacheKey);
      }

      return result.permissions as RequestedPolicyPermission[];
    })
    .catch((error) => {
      requestedPolicyPermissions.delete(cacheKey);
      throw error;
    });
  requestedPolicyPermissions.set(cacheKey, permissions);

  return permissions;
}

export function getKernelExecutor(
  context: EnvioContext,
  kernelAddress: Address,
  chainId: number,
  blockNumber?: bigint
): Promise<Address> {
  return context.effect(readKernelExecutorEffect, {
    chainId,
    kernelAddress,
    blockNumber,
  });
}

export function getRolesAdmin(
  context: EnvioContext,
  rolesAdminAddress: Address,
  chainId: number,
  blockNumber?: bigint
): Promise<Address> {
  return context.effect(readRolesAdminEffect, {
    chainId,
    rolesAdminAddress,
    blockNumber,
  });
}
