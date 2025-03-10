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
import { getContractName, getContractVersion } from "./ContractNames";
import { ContractProcessor } from "./services/contracts/processor";
import { getEtherscanApi } from "./services/etherscan/api";
import { getLatestContractByName } from "./services/db";
import { FunctionDetails } from "./services/contracts/types";
import { and, desc, eq } from "ponder";
import { getKernelConstants } from "./constants";

// Initialize services
const getContractProcessor = (chainId: number) => {
  const etherscanApi = getEtherscanApi(chainId);
  return new ContractProcessor(etherscanApi, chainId);
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
    return getContractName(target, context.network.chainId);
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
  context: Context
): Promise<FunctionDetails[] | null> => {
  if (action !== 2 && action !== 3) {
    console.debug(
      `Skipping policy functions for non-policy action ${action} on ${policyName}`
    );
    return null;
  }

  // Process the policy contract
  const policyFunctions = await getContractProcessor(
    context.network.chainId
  ).processContract(policyAddress, policyName);

  return Object.values(policyFunctions.functionSelectors);
};

const parsePolicyPermissions = async (
  action: number,
  target: `0x${string}`,
  targetName: string,
  context: Context
): Promise<PolicyPermission[] | null> => {
  if (action !== 2 && action !== 3) {
    console.debug(
      `Skipping policy permissions for non-policy action ${action} on ${targetName}`
    );
    return null;
  }

  console.log(`Parsing policy permissions for ${targetName}`);

  // Get the permissions from the policy
  const permissionsResult = await context.client.readContract({
    abi: PolicyAbi,
    address: target,
    functionName: "requestPermissions",
    args: [],
  });

  // Iterate over the permissions
  const policyPermissions: PolicyPermission[] = [];
  for (let i = 0; i < permissionsResult.length; i++) {
    const currentResult = permissionsResult[i];
    if (!currentResult) {
      continue;
    }

    // Each Permission has a keycode and a hashed function selector
    const moduleKeycode = fromHex(currentResult.keycode, "string");
    const funcSelector = currentResult.funcSelector;
    console.log(
      `Looking up keycode ${moduleKeycode} and selector ${funcSelector}`
    );

    // Find the contract for this keycode
    const moduleContract = await getLatestContractByName(
      moduleKeycode,
      context
    );
    if (!moduleContract) {
      throw new Error(`No contract found in DB for keycode ${moduleKeycode}`);
    }

    console.log(
      `Found contract at ${moduleContract.address} for module ${moduleKeycode}`
    );

    // Process the module contract to get function information
    const moduleProcessedData = await getContractProcessor(
      context.network.chainId
    ).processContract(moduleContract.address, moduleKeycode);

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
      and(
        eq(contract.name, keycode),
        eq(contract.chainId, context.network.chainId)
      )
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

ponder.on("Kernel:ActionExecuted", async ({ event, context }) => {
  const kernelAddress = event.log.address;
  const actionInt = event.args.action_;
  const target = event.args.target_;
  const timestamp = Number(event.block.timestamp);
  const action = parseAction(actionInt);
  const contractType = parseContractType(actionInt);
  const contractName = await parseContractName(actionInt, target, context);
  const contractVersion = getContractVersion(target, context.network.chainId);

  console.log("\n\n****");
  console.log(
    `Chain ${context.network.chainId}: Processing action ${action} on target ${target} at block ${event.block.number}`
  );

  // Record the action event
  await context.db.insert(actionExecutedEvent).values({
    // Primary keys
    chainId: context.network.chainId,
    kernel: kernelAddress,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    // Timestamp
    timestamp: BigInt(timestamp),
    blockNumber: BigInt(event.block.number),
    // Other data
    action: action,
    target: target,
  });
  console.log("Recorded action executed event");

  // Record the contract history
  if (contractType !== "kernel") {
    // For module upgrades, add an event for the previous contract
    if (action === "upgradeModule") {
      const previousContract = await getPreviousModule(contractName, context);

      if (!previousContract) {
        throw new Error(
          `No previous contract found for keycode ${contractName}`
        );
      }

      await context.db.insert(contractEvent).values({
        // Primary keys
        chainId: context.network.chainId,
        transactionHash: event.transaction.hash,
        logIndex: event.log.logIndex,
        // Timestamp
        timestamp: BigInt(timestamp),
        blockNumber: BigInt(event.block.number),
        // Other data
        address: previousContract.address,
        name: previousContract.name,
        version: previousContract.version,
        type: previousContract.type,
        action: "upgradeModule",
        isEnabled: false,
        policyPermissions: previousContract.policyPermissions,
        policyFunctions: previousContract.policyFunctions,
      });
      console.log("Recorded previous contract event");
    }

    await context.db.insert(contractEvent).values({
      // Primary keys
      chainId: context.network.chainId,
      transactionHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      // Timestamp
      timestamp: BigInt(timestamp),
      blockNumber: BigInt(event.block.number),
      // Other data
      address: target,
      name: contractName,
      version: contractVersion,
      action: action,
      type: contractType,
      isEnabled: parseIsEnabled(actionInt),
      policyPermissions: await parsePolicyPermissions(
        actionInt,
        target,
        contractName,
        context
      ),
      policyFunctions: await parsePolicyFunctions(
        actionInt,
        target,
        contractName,
        context
      ),
    });
    console.log("Recorded contract event");
  }

  // Update the contract state
  // With modules, this may lead to multiple contract records being created
  if (contractType !== "kernel") {
    const isEnabled = parseIsEnabled(actionInt);

    // If a module is being upgraded, we need to update the previous contract
    if (action === "upgradeModule") {
      const previousContract = await getPreviousModule(contractName, context);

      if (!previousContract) {
        throw new Error(
          `No previous contract found for keycode ${contractName}`
        );
      }

      await context.db
        .update(contract, {
          chainId: context.network.chainId,
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
        chainId: context.network.chainId,
        address: target,
        // Timestamp
        lastUpdatedTimestamp: BigInt(timestamp),
        lastUpdatedBlockNumber: BigInt(event.block.number),
        // Other data
        name: contractName,
        version: contractVersion,
        type: contractType,
        isEnabled: isEnabled,
        policyPermissions: await parsePolicyPermissions(
          actionInt,
          target,
          contractName,
          context
        ),
        policyFunctions: await parsePolicyFunctions(
          actionInt,
          target,
          contractName,
          context
        ),
      })
      .onConflictDoUpdate({
        isEnabled: isEnabled,
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
        chainId: context.network.chainId,
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
      chainId: context.network.chainId,
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
});

ponder.on("Kernel:setup", async ({ context }) => {
  // Insert initial records for the Kernel contract
  const constants = getKernelConstants(context.network.chainId);

  // Get the initial executor
  const initialExecutor = await getKernelExecutor(constants.address, context);

  console.log(
    `Chain ${context.network.chainId}: Inserting records for initial Kernel contract`
  );

  // Record the action event
  await context.db.insert(actionExecutedEvent).values({
    // Primary keys
    chainId: context.network.chainId,
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
    chainId: context.network.chainId,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    // Timestamp
    timestamp: BigInt(constants.creationTimestamp),
    blockNumber: BigInt(constants.creationBlockNumber),
    // Other data
    name: "Kernel",
    address: constants.address,
    action: "migrateKernel",
    type: "kernel",
    isEnabled: true,
  });
  console.log("Recorded contract event");

  // Update the contract state
  await context.db.insert(contract).values({
    // Primary keys
    chainId: context.network.chainId,
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
    chainId: context.network.chainId,
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
    chainId: context.network.chainId,
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
