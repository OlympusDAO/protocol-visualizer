import type { FunctionContext } from "../../../../packages/snapshot-artifacts/src/index";
import {
  readPinnedControlGetter,
  type ControlGetterInput,
  type ControlGetterResult,
} from "./control-reads";
import { createEffect, S } from "envio";
import { keccak256, type Address, type Hex } from "viem";

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
import type { ControlBlock } from "./control-state";
import { readPinnedBridgeConfiguration } from "./bridge-reads";
import type { BridgeReadResult } from "./bridge-config";

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

const functionContextSchema: S.Schema<FunctionContext> = S.schema({
  signature: S.string,
  notice: S.optional(S.string),
  details: S.optional(S.string),
  params: S.optional(S.record(S.string)),
  returns: S.optional(S.record(S.string)),
  source: S.optional(
    S.schema({
      url: S.string,
      codeHash: S.string,
      match: S.optional(S.union([S.schema("exact"), S.schema("code")])),
    })
  ),
});

const functionDetailsSchema = S.schema({
  name: S.string,
  selector: S.string,
  signature: S.string,
  roles: S.array(S.string),
  canonicalSignature: S.optional(S.string),
  documentation: S.optional(functionContextSchema),
});

const processedContractDataSchema: S.Schema<ProcessedContractData> = S.schema({
  roleToFunctions: S.record(S.array(S.string)),
  functionSelectors: S.record(functionDetailsSchema),
  addressGetters: S.optional(S.array(S.string)),
});

const processContractMetadataEffect = createEffect(
  {
    name: "processContractMetadataV2",
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
  async ({ input, context }) => {
    try {
      return await getPublicClient(input.chainId).readContract({
        abi: KernelAbi,
        address: input.kernelAddress,
        functionName: "getModuleForKeycode",
        args: [input.keycodeHex as Hex],
        blockNumber: input.blockNumber,
      });
    } catch (error) {
      if (!isHistoricalStateUnavailable(error)) {
        throw error;
      }

      context.cache = false;
      context.log.warn(
        `Historical getModuleForKeycode unavailable for ${input.kernelAddress} on chain ${input.chainId} at block ${input.blockNumber}; retrying at latest block`
      );

      return getPublicClient(input.chainId).readContract({
        abi: KernelAbi,
        address: input.kernelAddress,
        functionName: "getModuleForKeycode",
        args: [input.keycodeHex as Hex],
      });
    }
  }
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
  async ({ input, context }) => {
    try {
      return await getPublicClient(input.chainId).readContract({
        abi: KernelAbi,
        address: input.kernelAddress,
        functionName: "executor",
        args: [],
        ...(input.blockNumber ? { blockNumber: input.blockNumber } : {}),
      });
    } catch (error) {
      if (!input.blockNumber || !isHistoricalStateUnavailable(error)) {
        throw error;
      }

      context.cache = false;
      context.log.warn(
        `Historical executor unavailable for ${input.kernelAddress} on chain ${input.chainId} at block ${input.blockNumber}; retrying at latest block`
      );

      return getPublicClient(input.chainId).readContract({
        abi: KernelAbi,
        address: input.kernelAddress,
        functionName: "executor",
        args: [],
      });
    }
  }
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
  async ({ input, context }) => {
    try {
      return await getPublicClient(input.chainId).readContract({
        abi: RolesAdminAbi,
        address: input.rolesAdminAddress,
        functionName: "admin",
        ...(input.blockNumber ? { blockNumber: input.blockNumber } : {}),
      });
    } catch (error) {
      if (!input.blockNumber || !isHistoricalStateUnavailable(error)) {
        throw error;
      }

      context.cache = false;
      context.log.warn(
        `Historical RolesAdmin admin unavailable for ${input.rolesAdminAddress} on chain ${input.chainId} at block ${input.blockNumber}; retrying at latest block`
      );

      return getPublicClient(input.chainId).readContract({
        abi: RolesAdminAbi,
        address: input.rolesAdminAddress,
        functionName: "admin",
      });
    }
  }
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

export const readCodeHashEffect = createEffect(
  {
    name: "readCanonicalCodeHash",
    input: {
      chainId: S.number,
      address: S.address,
      blockNumber: S.bigint,
      blockHash: S.string,
    },
    output: S.optional(S.string),
    rateLimit: { calls: 25, per: "second" },
    cache: true,
  },
  async ({ input, context }) => {
    try {
      const client = getPublicClient(input.chainId);
      const before = await client.getBlock({ blockNumber: input.blockNumber });
      const code = await client.getCode({
        address: input.address,
        blockHash: input.blockHash as Hex,
        requireCanonical: true,
      });
      const after = await client.getBlock({ blockNumber: input.blockNumber });
      if (
        code &&
        code !== "0x" &&
        before.hash === input.blockHash &&
        after.hash === input.blockHash
      )
        return keccak256(code);
    } catch {
      /* Documentation stays unavailable when the pinned code cannot be verified. */
    }
    context.cache = false;
    return undefined;
  }
);

export async function getProcessedContract(
  context: EnvioContext,
  chainId: number,
  address: Address,
  name: string,
  blockNumber: bigint
): Promise<ProcessedContractData> {
  const cacheKey = `${chainId}:${normalizeAddress(address)}`;
  let pending = processedContracts.get(cacheKey);
  if (!pending) {
    pending = context
      .effect(processContractMetadataEffect, { chainId, address, name })
      .catch((error) => {
        processedContracts.delete(cacheKey);
        throw error;
      }) as Promise<ProcessedContractData>;
    processedContracts.set(cacheKey, pending);
  }
  const metadata = await pending;
  if (!Object.values(metadata.functionSelectors).some((fn) => fn.documentation))
    return metadata;
  const block = await getControlBlock(context, chainId, Number(blockNumber));
  const codeHash = block
    ? await context.effect(readCodeHashEffect, {
        chainId,
        address,
        blockNumber,
        blockHash: block.hash,
      })
    : undefined;
  return {
    ...metadata,
    functionSelectors: Object.fromEntries(
      Object.entries(metadata.functionSelectors).map(([selector, fn]) => [
        selector,
        fn.documentation?.source?.codeHash === codeHash
          ? fn
          : { ...fn, documentation: undefined },
      ])
    ),
  };
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

// Envio persists effect cache across rollbacks. Canonical hash is part of every input, not a process cache.
export const readControlGetterEffect = createEffect(
  {
    name: "readControlGetter",
    input: {
      chainId: S.number,
      address: S.address,
      blockNumber: S.bigint,
      blockHash: S.string,
      getter: S.string,
    },
    output: {
      status: S.string,
      value: S.optional(S.string),
      reason: S.optional(S.string),
      functionContext: S.optional(functionContextSchema),
      targetCode: S.optional(S.string),
    },
    rateLimit: { calls: 25, per: "second" },
    cache: true,
  },
  async ({ input, context }) => {
    const result = await readPinnedControlGetter(
      getPublicClient(input.chainId),
      input
    );
    if (result.status === "unavailable") context.cache = false;
    return result;
  }
);

export async function getControlGetter(
  context: EnvioContext,
  input: ControlGetterInput
): Promise<ControlGetterResult> {
  return (await context.effect(readControlGetterEffect, {
    ...input,
    address: normalizeAddress(input.address) as Address,
    blockHash: input.blockHash.toLowerCase(),
  })) as ControlGetterResult;
}

const readBridgeConfigurationEffect = createEffect(
  {
    name: "readBridgeConfiguration",
    input: {
      chainId: S.number,
      address: S.address,
      kind: S.union([S.schema("pool"), S.schema("bridge")]),
      blockNumber: S.bigint,
      blockHash: S.string,
      selectors: S.array(S.string),
    },
    output: {
      status: S.string,
      value: S.optional(S.string),
      reason: S.optional(S.string),
    },
    rateLimit: { calls: 10, per: "second" },
    cache: true,
  },
  async ({ input, context }) => {
    const result = await readPinnedBridgeConfiguration(
      getPublicClient(input.chainId),
      input
    );
    if (result.status === "unavailable") context.cache = false;
    return result;
  }
);

export async function getBridgeConfiguration(
  context: EnvioContext,
  input: {
    chainId: number;
    address: string;
    kind: "pool" | "bridge";
    blockNumber: bigint;
    blockHash: string;
    selectors: string[];
  }
): Promise<BridgeReadResult> {
  return (await context.effect(readBridgeConfigurationEffect, {
    ...input,
    address: input.address as Address,
  })) as BridgeReadResult;
}

// A height's header may change on rollback. Never persist a height-only header cache.
const readControlBlockEffect = createEffect(
  {
    name: "readControlBlock",
    input: { chainId: S.number, blockNumber: S.bigint },
    rateLimit: { calls: 25, per: "second" },
    output: S.optional(
      S.schema({ number: S.string, hash: S.string, timestamp: S.string })
    ),
    cache: false,
  },
  async ({ input }) => {
    try {
      const block = await getPublicClient(input.chainId).getBlock({
        blockNumber: input.blockNumber,
      });
      if (!block.hash) return undefined;
      return {
        number: input.blockNumber.toString(),
        hash: block.hash.toLowerCase(),
        timestamp: block.timestamp.toString(),
      };
    } catch {
      return undefined;
    }
  }
);

export async function getControlBlock(
  context: EnvioContext,
  chainId: number,
  blockNumber: number
): Promise<ControlBlock | undefined> {
  return context.effect(readControlBlockEffect, {
    chainId,
    blockNumber: BigInt(blockNumber),
  });
}
