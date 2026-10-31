import { createEffect, S } from "envio";
import type { Address, Hex } from "viem";
import type { FunctionContext } from "../../../../packages/snapshot-artifacts/src/index";
import { KernelAbi } from "../../abis/Kernel";
import { ModuleAbi } from "../../abis/Module";
import { PolicyAbi } from "../../abis/Policy";
import { RolesAdminAbi } from "../../abis/RolesAdmin";
import { getKernelConstants } from "../constants";
import { ContractProcessor } from "../services/contracts/processor";
import type { ProcessedContractData } from "../services/contracts/types";
import type { BridgeReadResult } from "./bridge-config";
import { readPinnedBridgeConfiguration } from "./bridge-reads";
import { getEffectClient } from "./call-cache";
import { emptyCodeHash, getBytecodeHash } from "./code-cache";
import {
  type ControlGetterInput,
  type ControlGetterResult,
  readHashBoundControlGetter,
} from "./control-reads";
import type { ControlBlock } from "./control-state";
import { readDeploymentGetter } from "./deployment-getters";
import type { CanonicalBlockReader } from "./deployment-facts";
import contractMetadata from "../generated/contract-metadata.json";
import { normalizeAddress } from "./ids";
import { kernelReadProof, reuseKernelRead } from "./kernel-reuse";
import {
  type DependencyReadResult,
  readPinnedModuleDependencies,
} from "./module-dependencies";
import {
  getPublicClient,
  isHistoricalStateUnavailable,
  rethrowTransientRpc,
} from "./rpc";
import type {
  EnvioContext,
  RequestedPolicyPermission,
  RequestedPolicyPermissionsResult,
} from "./types";

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

const deploymentFields = {
  chainId: S.number,
  address: S.string,
  creationBlock: S.string,
  codeHash: S.string,
  version: S.string,
  sourceUrl: S.string,
};

const processedContractDataSchema: S.Schema<ProcessedContractData> = S.schema({
  roleToFunctions: S.record(S.array(S.string)),
  functionSelectors: S.record(functionDetailsSchema),
  addressGetters: S.optional(S.array(S.string)),
  // S.schema mutates definitions; keep the shared field template intact.
  ordinaryDeployment: S.optional(S.schema({ ...deploymentFields })),
  immutableDeployment: S.optional(
    S.schema({
      ...deploymentFields,
      immutableGetters: S.record(S.string),
    })
  ),
});

const processContractMetadataEffect = createEffect(
  {
    name: "processContractMetadataV3",
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

export async function getCanonicalCodeHash(
  context: EnvioContext,
  input: Omit<ControlGetterInput, "getter">,
  readCanonicalBlock?: CanonicalBlockReader
): Promise<string | undefined> {
  const codeHash = await getBytecodeHash(
    context,
    input.chainId,
    {
      address: input.address,
      blockHash: input.blockHash as Hex,
      blockNumber: input.blockNumber,
      requireCanonical: true,
    },
    readCanonicalBlock
  );
  if (!codeHash || codeHash === emptyCodeHash) return undefined;
  const current = await readCanonicalControlBlock(
    input.chainId,
    input.blockNumber,
    readCanonicalBlock
  );
  return current?.hash === input.blockHash.toLowerCase() ? codeHash : undefined;
}

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
    ? await getCanonicalCodeHash(context, {
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
      sourceCodeHash: S.optional(S.string),
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
    const result = await readHashBoundControlGetter(
      getEffectClient(context, input.chainId),
      input,
      undefined,
      (pin) =>
        input.sourceCodeHash &&
        pin.address.toLowerCase() === input.address.toLowerCase()
          ? Promise.resolve(input.sourceCodeHash as Hex)
          : getBytecodeHash(context, input.chainId, pin)
    );
    if (result.status === "unavailable") context.cache = false;
    return result;
  }
);

export async function getControlGetter(
  context: EnvioContext,
  input: ControlGetterInput,
  observationBlock?: ControlBlock,
  readCanonicalBlock?: CanonicalBlockReader
): Promise<ControlGetterResult> {
  const normalized = {
    ...input,
    address: normalizeAddress(input.address) as Address,
    blockHash: input.blockHash.toLowerCase(),
  };
  const read = async (): Promise<ControlGetterResult> => {
    const deployment = await readDeploymentGetter(
      context,
      normalized,
      readCanonicalBlock
    );
    if (deployment) return deployment;
    const sourceCodeHash = context.VerifiedDeployment
      ? await getBytecodeHash(
          context,
          input.chainId,
          {
            address: normalized.address,
            blockHash: normalized.blockHash as Hex,
            blockNumber: input.blockNumber,
            requireCanonical: true,
          },
          readCanonicalBlock
        )
      : undefined;
    const result = (await context.effect(readControlGetterEffect, {
      ...normalized,
      ...(sourceCodeHash ? { sourceCodeHash } : {}),
    })) as ControlGetterResult;
    const contract = (
      contractMetadata as Record<string, Record<string, ProcessedContractData>>
    )[input.chainId]?.[normalized.address];
    if (
      result.status !== "success" ||
      !result.functionContext?.source ||
      !contract?.addressGetters?.includes(input.getter)
    )
      return result;
    const targetHash = await getBytecodeHash(
      context,
      input.chainId,
      {
        address: result.value as Address,
        blockNumber: input.blockNumber,
        blockHash: normalized.blockHash as Hex,
        requireCanonical: true,
      },
      readCanonicalBlock
    );
    return targetHash
      ? {
          ...result,
          targetCode: targetHash === emptyCodeHash ? "absent" : "present",
        }
      : { status: "unavailable", reason: "historical code read unavailable" };
  };
  const block =
    observationBlock ??
    (await getControlBlock(context, input.chainId, Number(input.blockNumber)));
  if (!block || block.hash !== normalized.blockHash)
    return { status: "unavailable", reason: "Canonical block changed" };
  const result = await reuseKernelRead(
    context,
    { ...normalized, block },
    read,
    async () => {
      const kernel = getKernelConstants(input.chainId).address;
      const kernelProof = kernelReadProof({
        chainId: input.chainId,
        address: kernel,
        getter: "moduleDependents:ROLES",
      });
      if (!kernelProof) return undefined;
      const code = await getBytecodeHash(
        context,
        input.chainId,
        {
          address: normalized.address,
          blockHash: normalized.blockHash as Hex,
          blockNumber: input.blockNumber,
          requireCanonical: true,
        },
        readCanonicalBlock
      );
      const [kernelCode, kernelPointer] = await Promise.all([
        getBytecodeHash(
          context,
          input.chainId,
          {
            address: kernel,
            blockHash: normalized.blockHash as Hex,
            blockNumber: input.blockNumber,
            requireCanonical: true,
          },
          readCanonicalBlock
        ),
        context.effect(readControlGetterEffect, {
          ...normalized,
          getter: "kernel",
          ...(code ? { sourceCodeHash: code } : {}),
        }) as Promise<ControlGetterResult>,
      ]);
      return kernelCode === kernelProof.codeHash &&
        kernelPointer.status === "success" &&
        kernelPointer.value === kernel.toLowerCase()
        ? code
        : undefined;
    },
    (number) =>
      readCanonicalControlBlock(
        input.chainId,
        BigInt(number),
        readCanonicalBlock
      ),
    async (result): Promise<ControlGetterResult> => {
      if (result.status !== "success" || !result.targetCode) return result;
      const hash = await getBytecodeHash(
        context,
        input.chainId,
        {
          address: result.value as Address,
          blockHash: normalized.blockHash as Hex,
          blockNumber: input.blockNumber,
          requireCanonical: true,
        },
        readCanonicalBlock
      );
      if (!hash)
        return {
          status: "unavailable",
          reason: "historical target code unavailable",
        };
      return {
        ...result,
        targetCode: hash === emptyCodeHash ? "absent" : "present",
      };
    }
  );
  return result;
}

const readModuleDependenciesEffect = createEffect(
  {
    name: "readModuleDependencies",
    input: {
      chainId: S.number,
      kernel: S.address,
      keycode: S.string,
      blockNumber: S.bigint,
      blockHash: S.string,
    },
    output: {
      status: S.string,
      module: S.optional(S.string),
      policies: S.optional(S.array(S.string)),
      reason: S.optional(S.string),
    },
    rateLimit: { calls: 10, per: "second" },
    cache: true,
  },
  async ({ input, context }) => {
    const result = await readPinnedModuleDependencies(
      getEffectClient(context, input.chainId),
      input
    );
    if (result.status === "unavailable") context.cache = false;
    return result;
  }
);
export async function getModuleDependencies(
  context: EnvioContext,
  input: {
    chainId: number;
    kernel: `0x${string}`;
    keycode: string;
    blockNumber: bigint;
    blockHash: string;
  },
  readCanonicalBlock?: CanonicalBlockReader
): Promise<DependencyReadResult> {
  const block = await readCanonicalControlBlock(
    input.chainId,
    input.blockNumber,
    readCanonicalBlock
  );
  if (!block || block.hash !== input.blockHash.toLowerCase())
    return { status: "unavailable", reason: "Canonical block changed" };
  return reuseKernelRead(
    context,
    {
      chainId: input.chainId,
      address: input.kernel,
      getter: `moduleDependents:${input.keycode}`,
      block,
    },
    async () =>
      (await context.effect(
        readModuleDependenciesEffect,
        input
      )) as DependencyReadResult,
    () =>
      getBytecodeHash(
        context,
        input.chainId,
        {
          address: input.kernel,
          blockHash: input.blockHash as Hex,
          blockNumber: input.blockNumber,
          requireCanonical: true,
        },
        readCanonicalBlock
      ),
    (number) =>
      readCanonicalControlBlock(
        input.chainId,
        BigInt(number),
        readCanonicalBlock
      )
  );
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
      getEffectClient(context, input.chainId),
      input,
      (pin) => getBytecodeHash(context, input.chainId, pin)
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
  },
  readCanonicalBlock?: CanonicalBlockReader
): Promise<BridgeReadResult> {
  const result = (await context.effect(readBridgeConfigurationEffect, {
    ...input,
    address: input.address as Address,
  })) as BridgeReadResult;
  if (
    result.status === "success" &&
    (
      await readCanonicalControlBlock(
        input.chainId,
        input.blockNumber,
        readCanonicalBlock
      )
    )?.hash !== input.blockHash.toLowerCase()
  )
    return {
      status: "unavailable",
      reason: "Canonical block changed after cached bridge observation",
    };
  return result;
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
  async ({ input }) =>
    readCanonicalControlBlock(input.chainId, input.blockNumber)
);

// Bypass the effect loader's per-batch memoization for canonical rechecks.
export async function readCanonicalControlBlock(
  chainId: number,
  blockNumber: bigint,
  readCanonicalBlock?: CanonicalBlockReader
): Promise<ControlBlock | undefined> {
  try {
    const block = await (readCanonicalBlock
      ? readCanonicalBlock(chainId, blockNumber)
      : getPublicClient(chainId).getBlock({ blockNumber }));
    if (!block.hash || block.timestamp === undefined) return undefined;
    return {
      number: blockNumber.toString(),
      hash: block.hash.toLowerCase(),
      timestamp: block.timestamp.toString(),
    };
  } catch (error) {
    rethrowTransientRpc(error);
    return undefined;
  }
}

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
