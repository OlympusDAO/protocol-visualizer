import { createEffect, type EvmOnEventContext, indexer, S } from "envio";
import {
  createPublicClient,
  fallback,
  fromHex,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";

import { KernelAbi } from "../abis/Kernel";
import { ModuleAbi } from "../abis/Module";
import { PolicyAbi } from "../abis/Policy";
import { RolesAdminAbi } from "../abis/RolesAdmin";
import {
  getContractName,
  getContractStartBlock,
  getContractType,
  getContractVersion,
} from "./ContractNames";
import {
  ChainId,
  getKernelConstants,
  getRolesAdminConstants,
} from "./constants";
import { ContractProcessor } from "./services/contracts/processor";
import {
  type FunctionDetails,
  type ProcessedContractData,
  ROLE_ROLES_ADMIN,
} from "./services/contracts/types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type EnvioContext = EvmOnEventContext & {
  ActionExecutedEvent: EntityStore;
  Contract: EntityStore;
  ContractEvent: EntityStore;
  CurrentModule: EntityStore;
  CurrentRoleAssignee: EntityStore;
  KernelExecutor: EntityStore;
  KernelExecutorEvent: EntityStore;
  Role: EntityStore;
  RoleAssignment: EntityStore;
  RoleEvent: EntityStore;
};

type EntityStore = {
  get: <T>(id: string) => Promise<T | undefined>;
  set: (entity: Record<string, unknown>) => void;
};

type RequestedPolicyPermission = {
  keycode: Hex;
  funcSelector: Hex;
};

type RequestedPolicyPermissionsResult = {
  permissions: RequestedPolicyPermission[];
  usedLatestFallback: boolean;
};

type PolicyPermission = {
  keycode: string;
  function: string;
};

type BaseEvent = {
  chainId: number;
  block: { number: number; timestamp: number };
  transaction: { hash: string };
  logIndex: number;
  srcAddress: Address;
};

type KernelActionExecutedEvent = BaseEvent & {
  params: { action_: bigint; target_: Address };
};

type RoleGrantedEvent = BaseEvent & {
  params: { role_: Hex; addr_: Address };
};

type RoleRevokedEvent = BaseEvent & {
  params: { role_: Hex; addr_: Address };
};

type NewAdminPulledEvent = BaseEvent & {
  params: { newAdmin_: Address };
};

type ContractType = "KERNEL" | "MODULE" | "POLICY";
type ActionType =
  | "installModule"
  | "upgradeModule"
  | "activatePolicy"
  | "deactivatePolicy"
  | "changeExecutor"
  | "migrateKernel";

type ContractEntity = {
  id: string;
  chainId: number;
  address: string;
  lastUpdatedTimestamp: bigint;
  lastUpdatedBlockNumber: bigint;
  name: string;
  version?: string;
  contractType: ContractType;
  isEnabled: boolean;
  policyPermissions?: unknown;
  policyFunctions?: unknown;
};

type CurrentModuleEntity = {
  id: string;
  chainId: number;
  keycode: string;
  address: string;
  lastUpdatedTimestamp: bigint;
  lastUpdatedBlockNumber: bigint;
};

type CurrentRoleAssigneeEntity = {
  id: string;
  chainId: number;
  role: string;
  assignee: string;
  assigneeName: string;
  lastUpdatedTimestamp: bigint;
  lastUpdatedBlockNumber: bigint;
};

const contractProcessors = new Map<number, ContractProcessor>();
const processedContracts = new Map<string, Promise<ProcessedContractData>>();
const requestedPolicyPermissions = new Map<
  string,
  Promise<readonly RequestedPolicyPermission[]>
>();
const publicClients = new Map<number, PublicClient<Transport>>();
const currentModuleCache = new Map<string, CurrentModuleEntity>();

const DEFAULT_RPC_URLS: Record<number, string> = {
  [ChainId.Mainnet]: "https://eth.llamarpc.com",
  [ChainId.Base]: "https://base.llamarpc.com",
  [ChainId.Berachain]: "https://rpc.berachain.com",
  [ChainId.Optimism]: "https://optimism.llamarpc.com",
  [ChainId.Sepolia]: "https://ethereum-sepolia-rpc.publicnode.com",
};

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function contractId(chainId: number, address: string): string {
  return `${chainId}:${normalizeAddress(address)}`;
}

function contractEventId(
  chainId: number,
  transactionHash: string,
  logIndex: number,
  action: ActionType,
  address: string
): string {
  return `${chainId}:${transactionHash}:${logIndex}:${action}:${normalizeAddress(
    address
  )}`;
}

function actionExecutedEventId(
  chainId: number,
  kernel: string,
  transactionHash: string,
  logIndex: number
): string {
  return `${chainId}:${normalizeAddress(kernel)}:${transactionHash}:${logIndex}`;
}

function kernelExecutorId(chainId: number, kernel: string): string {
  return `${chainId}:${normalizeAddress(kernel)}`;
}

function kernelExecutorEventId(
  chainId: number,
  kernel: string,
  transactionHash: string,
  logIndex: number
): string {
  return `${chainId}:${normalizeAddress(kernel)}:${transactionHash}:${logIndex}`;
}

function roleId(chainId: number, role: string): string {
  return `${chainId}:${role}`;
}

function roleAssignmentId(
  chainId: number,
  role: string,
  assignee: string
): string {
  return `${chainId}:${role}:${normalizeAddress(assignee)}`;
}

function roleEventId(
  chainId: number,
  role: string,
  transactionHash: string,
  logIndex: number,
  assignee: string
): string {
  return `${chainId}:${role}:${transactionHash}:${logIndex}:${normalizeAddress(
    assignee
  )}`;
}

function currentModuleId(chainId: number, keycode: string): string {
  return `${chainId}:${keycode}`;
}

function currentRoleAssigneeId(chainId: number, role: string): string {
  return `${chainId}:${role}`;
}

function getRpcUrls(chainId: number): string[] {
  const urls = [
    process.env[`ENVIO_RPC_URL_${chainId}`],
    process.env[`ENVIO_RPC_URL_FALLBACK_${chainId}`],
    DEFAULT_RPC_URLS[chainId],
  ].filter((url): url is string => !!url);

  if (urls.length === 0) {
    throw new Error(`RPC URL not found for chain ${chainId}`);
  }

  return urls;
}

function getPublicClient(chainId: number): PublicClient<Transport> {
  const cached = publicClients.get(chainId);
  if (cached) {
    return cached;
  }

  const transports = getRpcUrls(chainId).map((url) =>
    http(url, { batch: true })
  );
  const transport =
    transports.length === 1 ? transports[0]! : fallback(transports);
  const client = createPublicClient({ transport });
  publicClients.set(chainId, client);

  return client;
}

function isHistoricalStateUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("historical state") &&
    error.message.toLowerCase().includes("not available")
  );
}

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

const readPolicyPermissionsEffect = createEffect(
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

const readModuleKeycodeEffect = createEffect(
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

const readModuleForKeycodeEffect = createEffect(
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

function getProcessedContract(
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

function getRequestedPolicyPermissions(
  context: EnvioContext,
  chainId: number,
  policyAddress: Address,
  blockNumber: bigint
): Promise<readonly RequestedPolicyPermission[]> {
  const cacheKey = `${chainId}:${normalizeAddress(policyAddress)}`;
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

function parseAction(action: number): ActionType {
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

function parseContractType(action: number): ContractType {
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

function parseIsEnabled(action: number): boolean {
  switch (action) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return false;
    default:
      throw new Error(
        `parseIsEnabled: Unknown/unsupported Kernel action: ${action}`
      );
  }
}

async function parseContractName(
  action: number,
  target: Address,
  chainId: number,
  blockNumber: bigint,
  context: EnvioContext
): Promise<string> {
  if (action > 1) {
    return getContractName(target, chainId);
  }

  const knownName = getContractName(target, chainId);
  if (knownName !== "UNKNOWN") {
    return knownName;
  }

  try {
    const { keycode: keycodeResult } = await context.effect(
      readModuleKeycodeEffect,
      {
        chainId,
        moduleAddress: target,
        blockNumber,
      }
    );

    const keycode = fromHex(keycodeResult as Hex, "string").replace(/\0/g, "");
    console.log(`Keycode for ${target}: ${keycode}`);

    return keycode;
  } catch (error) {
    console.error(`Failed to read KEYCODE from module at ${target}:`, error);
    return "UNKNOWN";
  }
}

async function parsePolicyFunctions(
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
    policyName
  );

  return Object.values(policyFunctions.functionSelectors);
}

async function parsePolicyPermissions(
  action: number,
  kernelAddress: Address,
  target: Address,
  targetName: string,
  blockNumber: bigint,
  chainId: number,
  context: EnvioContext
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
    blockNumber
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
          context
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
          currentResult.moduleKeycode
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
          function: functionDetails.signature,
        };
      }
    )
  );

  return policyPermissions.filter(
    (permission): permission is PolicyPermission => !!permission
  );
}

async function getCurrentModuleAddress(
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

async function getKernelExecutor(
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

async function getRolesAdmin(
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

async function getPreviousModule(
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

function setCurrentModule(
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

function setRole(context: EnvioContext, chainId: number, role: string): void {
  context.Role.set({
    id: roleId(chainId, role),
    chainId,
    role,
  });
}

async function ensureKernelSeeded(
  context: EnvioContext,
  chainId: number
): Promise<void> {
  const constants = getKernelConstants(chainId);
  const id = contractId(chainId, constants.address);
  const existing = await context.Contract.get(id);
  if (existing) {
    return;
  }

  const timestamp = BigInt(constants.creationTimestamp);
  const blockNumber = BigInt(constants.creationBlockNumber);
  const initialExecutor = await getKernelExecutor(
    context,
    constants.address,
    chainId
  );

  context.ActionExecutedEvent.set({
    id: actionExecutedEventId(
      chainId,
      constants.address,
      constants.creationTransactionHash,
      0
    ),
    chainId,
    kernel: constants.address,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    timestamp,
    blockNumber,
    action: "migrateKernel",
    target: constants.address,
  });

  context.ContractEvent.set({
    id: contractEventId(
      chainId,
      constants.creationTransactionHash,
      0,
      "migrateKernel",
      constants.address
    ),
    chainId,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    action: "migrateKernel",
    address: constants.address,
    timestamp,
    blockNumber,
    name: "Kernel",
    contractType: "KERNEL",
    isEnabled: true,
  });

  context.Contract.set({
    id,
    chainId,
    address: constants.address,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    name: "Kernel",
    contractType: "KERNEL",
    isEnabled: true,
  });

  context.KernelExecutor.set({
    id: kernelExecutorId(chainId, constants.address),
    chainId,
    kernel: constants.address,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    executor: initialExecutor,
  });

  context.KernelExecutorEvent.set({
    id: kernelExecutorEventId(
      chainId,
      constants.address,
      constants.creationTransactionHash,
      0
    ),
    chainId,
    kernel: constants.address,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    timestamp,
    blockNumber,
    executor: initialExecutor,
  });
}

async function ensureRolesAdminSeeded(
  context: EnvioContext,
  chainId: number
): Promise<void> {
  const constants = getRolesAdminConstants(chainId);
  const id = currentRoleAssigneeId(chainId, ROLE_ROLES_ADMIN);
  const existing = await context.CurrentRoleAssignee.get(id);
  if (existing) {
    return;
  }

  const timestamp = BigInt(constants.creationTimestamp);
  const blockNumber = BigInt(constants.creationBlockNumber);
  const initialAdmin = await getRolesAdmin(context, constants.address, chainId);
  const assigneeName = getContractName(initialAdmin, chainId);

  context.RoleEvent.set({
    id: roleEventId(
      chainId,
      ROLE_ROLES_ADMIN,
      constants.creationTransactionHash,
      0,
      initialAdmin
    ),
    chainId,
    role: ROLE_ROLES_ADMIN,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    assignee: initialAdmin,
    timestamp,
    blockNumber,
    assigneeName,
    isGranted: true,
  });

  context.RoleAssignment.set({
    id: roleAssignmentId(chainId, ROLE_ROLES_ADMIN, initialAdmin),
    chainId,
    role: ROLE_ROLES_ADMIN,
    assignee: initialAdmin,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    assigneeName,
    isGranted: true,
  });

  context.CurrentRoleAssignee.set({
    id,
    chainId,
    role: ROLE_ROLES_ADMIN,
    assignee: initialAdmin,
    assigneeName,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
  });

  setRole(context, chainId, ROLE_ROLES_ADMIN);
}

async function handleKernelActionExecuted(
  event: KernelActionExecutedEvent,
  context: EnvioContext
): Promise<void> {
  const envioContext = context;
  const chainId = event.chainId;
  await ensureKernelSeeded(envioContext, chainId);

  const actionInt = Number(event.params.action_);
  const target = event.params.target_;
  const timestamp = BigInt(event.block.timestamp);
  const blockNumber = BigInt(event.block.number);
  const action = parseAction(actionInt);
  const contractType = parseContractType(actionInt);
  const contractName = await parseContractName(
    actionInt,
    target,
    chainId,
    blockNumber,
    envioContext
  );
  const contractVersion = getContractVersion(target, chainId) ?? undefined;
  const previousContract =
    action === "upgradeModule"
      ? await getPreviousModule(contractName, chainId, envioContext)
      : undefined;

  console.log(
    `Chain ${chainId}: Processing action ${action} on target ${target} at block ${event.block.number}`
  );

  envioContext.ActionExecutedEvent.set({
    id: actionExecutedEventId(
      chainId,
      event.srcAddress,
      event.transaction.hash,
      event.logIndex
    ),
    chainId,
    kernel: event.srcAddress,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    timestamp,
    blockNumber,
    action,
    target,
  });

  if (contractType !== "KERNEL") {
    const [policyPermissions, policyFunctions, existingContract] =
      await Promise.all([
        parsePolicyPermissions(
          actionInt,
          event.srcAddress,
          target,
          contractName,
          blockNumber,
          chainId,
          envioContext
        ),
        parsePolicyFunctions(
          actionInt,
          target,
          contractName,
          blockNumber,
          chainId,
          envioContext
        ),
        envioContext.Contract.get<ContractEntity>(contractId(chainId, target)),
      ]);

    if (action === "upgradeModule") {
      if (!previousContract) {
        throw new Error(
          `No previous contract found for keycode ${contractName}`
        );
      }

      envioContext.ContractEvent.set({
        id: contractEventId(
          chainId,
          event.transaction.hash,
          event.logIndex,
          action,
          previousContract.address
        ),
        chainId,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
        action,
        address: previousContract.address,
        timestamp,
        blockNumber,
        name: previousContract.name,
        version: previousContract.version,
        contractType: previousContract.contractType,
        isEnabled: false,
        policyPermissions: previousContract.policyPermissions,
        policyFunctions: previousContract.policyFunctions,
      });

      envioContext.Contract.set({
        ...previousContract,
        isEnabled: false,
        lastUpdatedTimestamp: timestamp,
        lastUpdatedBlockNumber: blockNumber,
      });
    }

    const isEnabled = parseIsEnabled(actionInt);
    envioContext.ContractEvent.set({
      id: contractEventId(
        chainId,
        event.transaction.hash,
        event.logIndex,
        action,
        target
      ),
      chainId,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      action,
      address: target,
      timestamp,
      blockNumber,
      name: contractName,
      version: contractVersion,
      contractType,
      isEnabled,
      policyPermissions,
      policyFunctions,
    });

    envioContext.Contract.set({
      ...(existingContract ?? {
        id: contractId(chainId, target),
        chainId,
        address: target,
        name: contractName,
        version: contractVersion,
        contractType,
      }),
      lastUpdatedTimestamp: timestamp,
      lastUpdatedBlockNumber: blockNumber,
      isEnabled,
      policyPermissions,
      policyFunctions,
    });

    if (contractType === "MODULE" && isEnabled) {
      setCurrentModule(
        envioContext,
        chainId,
        contractName,
        target,
        timestamp,
        blockNumber
      );
    }
  }

  if (action === "changeExecutor") {
    const executor = await getKernelExecutor(
      envioContext,
      event.srcAddress,
      chainId
    );

    envioContext.KernelExecutor.set({
      id: kernelExecutorId(chainId, event.srcAddress),
      chainId,
      kernel: event.srcAddress,
      lastUpdatedTimestamp: timestamp,
      lastUpdatedBlockNumber: blockNumber,
      executor,
    });

    envioContext.KernelExecutorEvent.set({
      id: kernelExecutorEventId(
        chainId,
        event.srcAddress,
        event.transaction.hash,
        event.logIndex
      ),
      chainId,
      kernel: event.srcAddress,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      timestamp,
      blockNumber,
      executor,
    });
  }
}

async function handleRoleGranted(
  event: RoleGrantedEvent,
  context: EnvioContext
): Promise<void> {
  const envioContext = context;
  await ensureRolesAdminSeeded(envioContext, event.chainId);

  const role = fromHex(event.params.role_, "string").replace(/\0/g, "");
  const assignee = event.params.addr_;
  const timestamp = BigInt(event.block.timestamp);
  const blockNumber = BigInt(event.block.number);
  const assigneeName = getContractName(assignee, event.chainId);

  console.log(
    `Chain ${event.chainId}: Processing role granted event for ${role} to ${assignee}`
  );

  envioContext.RoleEvent.set({
    id: roleEventId(
      event.chainId,
      role,
      event.transaction.hash,
      event.logIndex,
      assignee
    ),
    chainId: event.chainId,
    role,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    assignee,
    timestamp,
    blockNumber,
    assigneeName,
    isGranted: true,
  });

  envioContext.RoleAssignment.set({
    id: roleAssignmentId(event.chainId, role, assignee),
    chainId: event.chainId,
    role,
    assignee,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    assigneeName,
    isGranted: true,
  });

  setRole(envioContext, event.chainId, role);
}

async function handleRoleRevoked(
  event: RoleRevokedEvent,
  context: EnvioContext
): Promise<void> {
  const envioContext = context;
  await ensureRolesAdminSeeded(envioContext, event.chainId);

  const role = fromHex(event.params.role_, "string").replace(/\0/g, "");
  const assignee = event.params.addr_;
  const timestamp = BigInt(event.block.timestamp);
  const blockNumber = BigInt(event.block.number);
  const assignmentId = roleAssignmentId(event.chainId, role, assignee);
  const existingAssignment = await envioContext.RoleAssignment.get<{
    assigneeName?: string;
  }>(assignmentId);
  const assigneeName =
    existingAssignment?.assigneeName ??
    getContractName(assignee, event.chainId);

  console.log(
    `Chain ${event.chainId}: Processing role revoked event for ${role} from ${assignee}`
  );

  envioContext.RoleEvent.set({
    id: roleEventId(
      event.chainId,
      role,
      event.transaction.hash,
      event.logIndex,
      assignee
    ),
    chainId: event.chainId,
    role,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    assignee,
    timestamp,
    blockNumber,
    assigneeName,
    isGranted: false,
  });

  envioContext.RoleAssignment.set({
    id: assignmentId,
    chainId: event.chainId,
    role,
    assignee,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    assigneeName,
    isGranted: false,
  });

  setRole(envioContext, event.chainId, role);
}

async function handleNewAdminPulled(
  event: NewAdminPulledEvent,
  context: EnvioContext
): Promise<void> {
  const envioContext = context;
  await ensureRolesAdminSeeded(envioContext, event.chainId);

  const newAdmin = event.params.newAdmin_;
  const timestamp = BigInt(event.block.timestamp);
  const blockNumber = BigInt(event.block.number);
  const currentAssignee =
    await envioContext.CurrentRoleAssignee.get<CurrentRoleAssigneeEntity>(
      currentRoleAssigneeId(event.chainId, ROLE_ROLES_ADMIN)
    );

  console.log(
    `Chain ${event.chainId}: Processing new admin pulled event for ${newAdmin}`
  );

  if (currentAssignee) {
    envioContext.RoleEvent.set({
      id: roleEventId(
        event.chainId,
        ROLE_ROLES_ADMIN,
        event.transaction.hash,
        event.logIndex,
        currentAssignee.assignee
      ),
      chainId: event.chainId,
      role: ROLE_ROLES_ADMIN,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      assignee: currentAssignee.assignee,
      timestamp,
      blockNumber,
      assigneeName: currentAssignee.assigneeName,
      isGranted: false,
    });

    envioContext.RoleAssignment.set({
      id: roleAssignmentId(
        event.chainId,
        ROLE_ROLES_ADMIN,
        currentAssignee.assignee
      ),
      chainId: event.chainId,
      role: ROLE_ROLES_ADMIN,
      assignee: currentAssignee.assignee,
      lastUpdatedTimestamp: timestamp,
      lastUpdatedBlockNumber: blockNumber,
      assigneeName: currentAssignee.assigneeName,
      isGranted: false,
    });
  }

  const assigneeName = getContractName(newAdmin, event.chainId);
  envioContext.RoleEvent.set({
    id: roleEventId(
      event.chainId,
      ROLE_ROLES_ADMIN,
      event.transaction.hash,
      event.logIndex,
      newAdmin
    ),
    chainId: event.chainId,
    role: ROLE_ROLES_ADMIN,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    assignee: newAdmin,
    timestamp,
    blockNumber,
    assigneeName,
    isGranted: true,
  });

  envioContext.RoleAssignment.set({
    id: roleAssignmentId(event.chainId, ROLE_ROLES_ADMIN, newAdmin),
    chainId: event.chainId,
    role: ROLE_ROLES_ADMIN,
    assignee: newAdmin,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    assigneeName,
    isGranted: true,
  });

  envioContext.CurrentRoleAssignee.set({
    id: currentRoleAssigneeId(event.chainId, ROLE_ROLES_ADMIN),
    chainId: event.chainId,
    role: ROLE_ROLES_ADMIN,
    assignee: newAdmin,
    assigneeName,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
  });

  setRole(envioContext, event.chainId, ROLE_ROLES_ADMIN);
}

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
  }
);

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
