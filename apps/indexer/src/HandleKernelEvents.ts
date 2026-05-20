import { Context, ponder } from "ponder:registry";
import {
  actionExecutedEvent,
  contract,
  contractEvent,
  kernelExecutor,
  kernelExecutorEvent,
  PolicyPermission,
} from "ponder:schema";
import { ModuleAbi } from "../abis/Module";
import { fromHex } from "viem";
import { PolicyAbi } from "../abis/Policy";
import { KernelAbi } from "../abis/Kernel";
import {
  getContractName,
  getContractStartBlock,
  getContractType,
  getContractVersion,
} from "./ContractNames";
import { ContractProcessor } from "./services/contracts/processor";
import { getEtherscanApi } from "./services/etherscan/api";
import {
  FunctionDetails,
  ProcessedContractData,
} from "./services/contracts/types";
import { and, desc, eq } from "ponder";
import { getKernelConstants } from "./constants";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

type RequestedPolicyPermission = {
  keycode: `0x${string}`;
  funcSelector: `0x${string}`;
};

// Initialize services
const contractProcessors = new Map<number, ContractProcessor>();
const processedContracts = new Map<string, Promise<ProcessedContractData>>();
const requestedPolicyPermissions = new Map<
  string,
  Promise<readonly RequestedPolicyPermission[]>
>();

const getContractProcessor = (chainId: number) => {
  const processor = contractProcessors.get(chainId);
  if (processor) {
    return processor;
  }

  const etherscanApi = getEtherscanApi(chainId);
  const newProcessor = new ContractProcessor(etherscanApi, chainId);
  contractProcessors.set(chainId, newProcessor);

  return newProcessor;
};

const getProcessedContract = (
  chainId: number,
  address: `0x${string}`,
  name: string
): Promise<ProcessedContractData> => {
  const cacheKey = `${chainId}:${address.toLowerCase()}`;
  const cached = processedContracts.get(cacheKey);
  if (cached) {
    return cached;
  }

  const processedContract = getContractProcessor(chainId)
    .processContract(address, name)
    .catch((error) => {
      processedContracts.delete(cacheKey);
      throw error;
    });
  processedContracts.set(cacheKey, processedContract);

  return processedContract;
};

const getRequestedPolicyPermissions = (
  chainId: number,
  policyAddress: `0x${string}`,
  blockNumber: bigint,
  context: Context
): Promise<readonly RequestedPolicyPermission[]> => {
  const cacheKey = `${chainId}:${policyAddress.toLowerCase()}`;
  const cached = requestedPolicyPermissions.get(cacheKey);
  if (cached) {
    return cached;
  }

  const permissions = context.client
    .readContract({
      abi: PolicyAbi,
      address: policyAddress,
      functionName: "requestPermissions",
      args: [],
      blockNumber,
    })
    .catch((error) => {
      requestedPolicyPermissions.delete(cacheKey);
      throw error;
    });
  requestedPolicyPermissions.set(cacheKey, permissions);

  return permissions;
};

const parseAction = (
  action: number
):
  | "installModule"
  | "upgradeModule"
  | "activatePolicy"
  | "deactivatePolicy"
  | "changeExecutor"
  | "migrateKernel" => {
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
};

const parseContractType = (action: number): "kernel" | "module" | "policy" => {
  switch (action) {
    case 0:
    case 1:
      return "module";
    case 2:
    case 3:
      return "policy";
    case 4:
    case 5:
      return "kernel";
    default:
      throw new Error(
        `parseContractType: Unknown/unsupported Kernel action: ${action}`
      );
  }
};

const parseIsEnabled = (action: number): boolean => {
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
};

const parseContractName = async (
  action: number,
  target: `0x${string}`,
  context: Context
): Promise<string> => {
  if (action > 1) {
    return getContractName(target, context.chain.id);
  }

  const knownName = getContractName(target, context.chain.id);
  if (knownName !== "UNKNOWN") {
    return knownName;
  }

  // Get the keycode from the module
  let keycodeResult;
  try {
    keycodeResult = await context.client.readContract({
      abi: ModuleAbi,
      address: target,
      functionName: "KEYCODE",
      args: [],
    });
  } catch (error) {
    console.error(`Failed to read KEYCODE from module at ${target}:`, error);
    return "UNKNOWN";
  }

  // Decode from bytes5 to string
  const keycode = fromHex(keycodeResult, "string").replace(/\0/g, "");
  console.log(`Keycode for ${target}: ${keycode}`);

  return keycode;
};

const parsePolicyFunctions = async (
  action: number,
  policyAddress: `0x${string}`,
  policyName: string,
  blockNumber: bigint,
  context: Context
): Promise<FunctionDetails[] | null> => {
  if (action !== 2 && action !== 3) {
    console.debug(
      `Skipping policy functions for non-policy action ${action} on ${policyName}`
    );
    return null;
  }

  const contractType = getContractType(policyAddress, context.chain.id);
  if (contractType !== "policy") {
    console.debug(
      `Skipping policy functions for non-policy contract type ${String(contractType)} on ${policyName}`
    );
    return null;
  }

  const startBlock = getContractStartBlock(policyAddress, context.chain.id);
  if (startBlock !== undefined && blockNumber < BigInt(startBlock)) {
    console.debug(
      `Skipping policy functions for ${policyName} at block ${blockNumber} before start block ${startBlock}`
    );
    return null;
  }

  // Process the policy contract
  const policyFunctions = await getProcessedContract(
    context.chain.id,
    policyAddress,
    policyName
  );

  return Object.values(policyFunctions.functionSelectors);
};

const parsePolicyPermissions = async (
  action: number,
  kernelAddress: `0x${string}`,
  target: `0x${string}`,
  targetName: string,
  blockNumber: bigint,
  context: Context
): Promise<PolicyPermission[] | null> => {
  if (action !== 2 && action !== 3) {
    console.debug(
      `Skipping policy permissions for non-policy action ${action} on ${targetName}`
    );
    return null;
  }

  const contractType = getContractType(target, context.chain.id);
  if (contractType !== "policy") {
    console.debug(
      `Skipping policy permissions for non-policy contract type ${String(contractType)} on ${targetName}`
    );
    return null;
  }

  const startBlock = getContractStartBlock(target, context.chain.id);
  if (startBlock !== undefined && blockNumber < BigInt(startBlock)) {
    console.debug(
      `Skipping policy permissions for ${targetName} at block ${blockNumber} before start block ${startBlock}`
    );
    return null;
  }

  console.log(`Parsing policy permissions for ${targetName}`);

  // Get the permissions from the policy. This is static per policy contract, so
  // cache it across repeated activation/deactivation events.
  const permissionsResult = await getRequestedPolicyPermissions(
    context.chain.id,
    target,
    blockNumber,
    context
  );

  const permissions = permissionsResult.filter((permission) => !!permission);
  const permissionDetails = permissions.map((permission) => {
    const moduleKeycode = fromHex(permission.keycode, "string").replace(
      /\0/g,
      ""
    );
    const moduleKeycodeHex = permission.keycode;
    const funcSelector = permission.funcSelector;
    console.log(
      `Looking up keycode ${moduleKeycode} and selector ${funcSelector}`
    );

    return { moduleKeycode, moduleKeycodeHex, funcSelector };
  });

  const moduleAddresses = new Map<string, `0x${string}`>();
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

  // Iterate over the permissions
  const policyPermissions: PolicyPermission[] = [];
  for (let i = 0; i < permissionDetails.length; i++) {
    const currentResult = permissionDetails[i];
    if (!currentResult) {
      continue;
    }

    // Each Permission has a keycode and a hashed function selector
    const moduleKeycode = currentResult.moduleKeycode;
    const funcSelector = currentResult.funcSelector;
    const moduleAddress = moduleAddresses.get(moduleKeycode);

    if (!moduleAddress || moduleAddress === ZERO_ADDRESS) {
      throw new Error(
        `No module address found in Kernel for keycode ${moduleKeycode} at block ${blockNumber}`
      );
    }

    console.log(
      `Found contract at ${moduleAddress} for module ${moduleKeycode}`
    );

    // Process the module contract to get function information
    const moduleProcessedData = await getProcessedContract(
      context.chain.id,
      moduleAddress,
      moduleKeycode
    );

    // Get the function details for this selector
    const functionDetails = moduleProcessedData.functionSelectors[funcSelector];
    if (!functionDetails) {
      console.warn(
        `No function details found for keycode ${moduleKeycode} and selector ${funcSelector} on policy ${targetName}`
      );
      continue;
    }

    policyPermissions.push({
      keycode: moduleKeycode,
      function: functionDetails ? functionDetails.signature : funcSelector,
    });
  }

  return policyPermissions;
};

const getCurrentModuleAddress = async (
  keycode: string,
  keycodeHex: `0x${string}`,
  kernelAddress: `0x${string}`,
  blockNumber: bigint,
  context: Context
): Promise<`0x${string}` | null> => {
  const currentModules = await context.db.sql
    .select()
    .from(contract)
    .where(
      and(
        eq(contract.name, keycode),
        eq(contract.chainId, context.chain.id),
        eq(contract.type, "module"),
        eq(contract.isEnabled, true)
      )
    )
    .orderBy(desc(contract.lastUpdatedBlockNumber))
    .limit(1);

  const currentModule = currentModules[0];
  if (currentModule) {
    return currentModule.address;
  }

  const moduleAddress = await context.client.readContract({
    abi: KernelAbi,
    address: kernelAddress,
    functionName: "getModuleForKeycode",
    args: [keycodeHex],
    blockNumber,
  });

  if (moduleAddress === ZERO_ADDRESS) {
    return null;
  }

  return moduleAddress;
};

const getKernelExecutor = async (
  kernelAddress: `0x${string}`,
  context: Context
): Promise<`0x${string}`> => {
  const kernelExecutor = await context.client.readContract({
    abi: KernelAbi,
    address: kernelAddress,
    functionName: "executor",
    args: [],
  });

  return kernelExecutor;
};

const getPreviousModule = async (keycode: string, context: Context) => {
  const previousContract = await context.db.sql
    .select()
    .from(contract)
    .where(
      and(eq(contract.name, keycode), eq(contract.chainId, context.chain.id))
    )
    .orderBy(desc(contract.lastUpdatedTimestamp))
    .limit(1);

  if (previousContract.length === 0) {
    return null;
  }

  if (previousContract.length > 1) {
    throw new Error(
      `Found multiple previous contract records for keycode ${keycode}: ${previousContract.map((c) => c.address).join(", ")}`
    );
  }

  return previousContract[0];
};

ponder.on(
  "KernelNonPolicyActions:ActionExecuted",
  async ({ event, context }) => {
    const kernelAddress = event.log.address;
    const actionInt = event.args.action_;

    // Policy actions are handled by KernelPolicyActions to avoid duplication.
    if (actionInt === 2 || actionInt === 3) {
      return;
    }

    const target = event.args.target_;
    const timestamp = Number(event.block.timestamp);
    const action = parseAction(actionInt);
    const contractType = parseContractType(actionInt);
    const contractName = await parseContractName(actionInt, target, context);
    const contractVersion = getContractVersion(target, context.chain.id);
    const previousContract =
      action === "upgradeModule"
        ? await getPreviousModule(contractName, context)
        : null;

    console.log("\n\n****");
    console.log(
      `Chain ${context.chain.id}: Processing action ${action} on target ${target} at block ${event.block.number}`
    );

    // Record the action event
    await context.db
      .insert(actionExecutedEvent)
      .values({
        // Primary keys
        chainId: context.chain.id,
        kernel: kernelAddress,
        transactionHash: event.transaction.hash,
        logIndex: event.log.logIndex,
        // Timestamp
        timestamp: BigInt(timestamp),
        blockNumber: BigInt(event.block.number),
        // Other data
        action: action,
        target: target,
      })
      .onConflictDoNothing(); // TODO Sometimes the tx is recorded multiple times. Look at why.
    console.log("Recorded action executed event");

    // Record the contract history
    if (contractType !== "kernel") {
      // For module upgrades, add an event for the previous contract
      if (action === "upgradeModule") {
        if (!previousContract) {
          throw new Error(
            `No previous contract found for keycode ${contractName}`
          );
        }

        await context.db
          .insert(contractEvent)
          .values({
            // Primary keys
            chainId: context.chain.id,
            transactionHash: event.transaction.hash,
            logIndex: event.log.logIndex,
            action: "upgradeModule",
            address: previousContract.address,
            // Timestamp
            timestamp: BigInt(timestamp),
            blockNumber: BigInt(event.block.number),
            // Other data
            name: previousContract.name,
            version: previousContract.version,
            type: previousContract.type,
            isEnabled: false,
            policyPermissions: previousContract.policyPermissions,
            policyFunctions: previousContract.policyFunctions,
          })
          .onConflictDoNothing(); // TODO Sometimes the tx is recorded multiple times. Look at why.
        console.log("Recorded previous contract event");
      }

      await context.db
        .insert(contractEvent)
        .values({
          // Primary keys
          chainId: context.chain.id,
          transactionHash: event.transaction.hash,
          logIndex: event.log.logIndex,
          action: action,
          address: target,
          // Timestamp
          timestamp: BigInt(timestamp),
          blockNumber: BigInt(event.block.number),
          // Other data
          name: contractName,
          version: contractVersion,
          type: contractType,
          isEnabled: parseIsEnabled(actionInt),
          policyPermissions: null,
          policyFunctions: null,
        })
        .onConflictDoNothing(); // TODO Sometimes the tx is recorded multiple times. Look at why.
      console.log("Recorded contract event");
    }

    // Update the contract state
    // With modules, this may lead to multiple contract records being created
    if (contractType !== "kernel") {
      const isEnabled = parseIsEnabled(actionInt);

      // If a module is being upgraded, we need to update the previous contract
      if (action === "upgradeModule") {
        if (!previousContract) {
          throw new Error(
            `No previous contract found for keycode ${contractName}`
          );
        }

        await context.db
          .update(contract, {
            chainId: context.chain.id,
            address: previousContract.address,
          })
          .set({
            isEnabled: false,
            lastUpdatedTimestamp: BigInt(timestamp),
            lastUpdatedBlockNumber: BigInt(event.block.number),
          });
        console.log("Updated previous contract");
      }

      await context.db
        .insert(contract)
        .values({
          // Primary keys
          chainId: context.chain.id,
          address: target,
          // Timestamp
          lastUpdatedTimestamp: BigInt(timestamp),
          lastUpdatedBlockNumber: BigInt(event.block.number),
          // Other data
          name: contractName,
          version: contractVersion,
          type: contractType,
          isEnabled: isEnabled,
          policyPermissions: null,
          policyFunctions: null,
        })
        .onConflictDoUpdate({
          isEnabled: isEnabled,
          lastUpdatedTimestamp: BigInt(timestamp),
          lastUpdatedBlockNumber: BigInt(event.block.number),
        });
      console.log("Updated contract");
    }

    // Handle the kernel executor
    if (action === "changeExecutor") {
      // Get the new executor
      const kernelAddress = event.log.address;
      const executor = await getKernelExecutor(kernelAddress, context);

      // Update the kernel executor
      await context.db
        .update(kernelExecutor, {
          chainId: context.chain.id,
          kernel: kernelAddress,
        })
        .set({
          executor: executor,
          lastUpdatedTimestamp: BigInt(timestamp),
          lastUpdatedBlockNumber: BigInt(event.block.number),
        });

      // Record the kernel executor event
      await context.db.insert(kernelExecutorEvent).values({
        // Primary keys
        chainId: context.chain.id,
        kernel: kernelAddress,
        transactionHash: event.transaction.hash,
        logIndex: event.log.logIndex,
        // Timestamp
        timestamp: BigInt(timestamp),
        blockNumber: BigInt(event.block.number),
        // Other data
        executor: executor,
      });
      console.log("Recorded kernel executor event");
    }
  }
);

ponder.on("KernelPolicyActions:ActionExecuted", async ({ event, context }) => {
  const kernelAddress = event.log.address;
  const actionInt = event.args.action_;
  const target = event.args.target_;
  const timestamp = Number(event.block.timestamp);
  const action = parseAction(actionInt);
  const contractType = parseContractType(actionInt);
  const contractName = await parseContractName(actionInt, target, context);
  const contractVersion = getContractVersion(target, context.chain.id);
  const isEnabled = parseIsEnabled(actionInt);

  const policyPermissions = await parsePolicyPermissions(
    actionInt,
    kernelAddress,
    target,
    contractName,
    event.block.number,
    context
  );
  const policyFunctions = await parsePolicyFunctions(
    actionInt,
    target,
    contractName,
    event.block.number,
    context
  );

  console.log("\n\n****");
  console.log(
    `Chain ${context.chain.id}: Processing policy action ${action} on target ${target} at block ${event.block.number}`
  );

  await context.db
    .insert(actionExecutedEvent)
    .values({
      chainId: context.chain.id,
      kernel: kernelAddress,
      transactionHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      timestamp: BigInt(timestamp),
      blockNumber: BigInt(event.block.number),
      action: action,
      target: target,
    })
    .onConflictDoNothing();

  await context.db
    .insert(contractEvent)
    .values({
      chainId: context.chain.id,
      transactionHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      action: action,
      address: target,
      timestamp: BigInt(timestamp),
      blockNumber: BigInt(event.block.number),
      name: contractName,
      version: contractVersion,
      type: contractType,
      isEnabled: isEnabled,
      policyPermissions: policyPermissions,
      policyFunctions: policyFunctions,
    })
    .onConflictDoNothing();

  await context.db
    .insert(contract)
    .values({
      chainId: context.chain.id,
      address: target,
      lastUpdatedTimestamp: BigInt(timestamp),
      lastUpdatedBlockNumber: BigInt(event.block.number),
      name: contractName,
      version: contractVersion,
      type: contractType,
      isEnabled: isEnabled,
      policyPermissions: policyPermissions,
      policyFunctions: policyFunctions,
    })
    .onConflictDoUpdate({
      isEnabled: isEnabled,
      lastUpdatedTimestamp: BigInt(timestamp),
      lastUpdatedBlockNumber: BigInt(event.block.number),
      policyPermissions: policyPermissions,
      policyFunctions: policyFunctions,
    });
});

ponder.on("KernelPolicyActions:setup", async ({ context }) => {
  // Insert initial records for the Kernel contract
  const constants = getKernelConstants(context.chain.id);

  // Get the initial executor
  const initialExecutor = await getKernelExecutor(constants.address, context);

  console.log(
    `Chain ${context.chain.id}: Inserting records for initial Kernel contract`
  );

  // Record the action event
  await context.db.insert(actionExecutedEvent).values({
    // Primary keys
    chainId: context.chain.id,
    kernel: constants.address,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    // Timestamp
    timestamp: BigInt(constants.creationTimestamp),
    blockNumber: BigInt(constants.creationBlockNumber),
    // Other data
    action: "migrateKernel",
    target: constants.address,
  });
  console.log("Recorded action executed event");

  // Record the contract history
  await context.db.insert(contractEvent).values({
    // Primary keys
    chainId: context.chain.id,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    action: "migrateKernel",
    address: constants.address,
    // Timestamp
    timestamp: BigInt(constants.creationTimestamp),
    blockNumber: BigInt(constants.creationBlockNumber),
    // Other data
    name: "Kernel",
    type: "kernel",
    isEnabled: true,
  });
  console.log("Recorded contract event");

  // Update the contract state
  await context.db.insert(contract).values({
    // Primary keys
    chainId: context.chain.id,
    address: constants.address,
    // Timestamp
    lastUpdatedTimestamp: BigInt(constants.creationTimestamp),
    lastUpdatedBlockNumber: BigInt(constants.creationBlockNumber),
    // Other data
    name: "Kernel",
    type: "kernel",
    isEnabled: true,
    policyPermissions: null,
  });
  console.log("Updated contract");

  // Record the kernel executor
  await context.db.insert(kernelExecutor).values({
    // Primary keys
    chainId: context.chain.id,
    kernel: constants.address,
    // Timestamp
    lastUpdatedTimestamp: BigInt(constants.creationTimestamp),
    lastUpdatedBlockNumber: BigInt(constants.creationBlockNumber),
    // Other data
    executor: initialExecutor,
  });
  console.log("Recorded kernel executor");

  // Record the kernel executor event
  await context.db.insert(kernelExecutorEvent).values({
    // Primary keys
    chainId: context.chain.id,
    kernel: constants.address,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    // Timestamp
    timestamp: BigInt(constants.creationTimestamp),
    blockNumber: BigInt(constants.creationBlockNumber),
    // Other data
    executor: initialExecutor,
  });
  console.log("Recorded kernel executor event");
});
