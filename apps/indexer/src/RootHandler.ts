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
import { getContractName } from "./ContractNames";

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
    case 2:
      return true;
    case 1:
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
    return getContractName(target);
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
  const keycode = fromHex(keycodeResult, "string");
  console.log(`Keycode for ${target}: ${keycode}`);
  return keycode;
};

const parsePolicyPermissions = async (
  action: number,
  target: `0x${string}`,
  context: Context
): Promise<PolicyPermission[] | null> => {
  if (action !== 2 && action !== 3) {
    console.debug(
      `Skipping policy permissions for non-policy action: ${action}`
    );
    return null;
  }

  // Get the permissions from the policy
  const permissionsResult = await context.client.readContract({
    abi: PolicyAbi,
    address: target,
    functionName: "requestPermissions",
    args: [],
  });

  const policyPermissions: PolicyPermission[] = [];
  for (let i = 0; i < permissionsResult.length; i++) {
    const currentResult = permissionsResult[i];
    if (!currentResult) {
      continue;
    }

    const keycode = fromHex(currentResult.keycode, "string");
    policyPermissions.push({ keycode, function: currentResult.funcSelector });

    // TODO Add lookup of function selector hash
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

ponder.on("Kernel:ActionExecuted", async ({ event, context }) => {
  const kernelAddress = event.log.address;
  const actionInt = event.args.action_;
  const target = event.args.target_;
  const timestamp = Number(event.block.timestamp);
  const action = parseAction(actionInt);
  const contractType = parseContractType(actionInt);

  console.log(
    `Processing action ${action} on target ${target} at block ${event.block.number}`
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
      name: await parseContractName(actionInt, target, context),
      action: action,
      type: contractType,
      isEnabled: parseIsEnabled(actionInt),
      policyPermissions: await parsePolicyPermissions(
        actionInt,
        target,
        context
      ),
    });
    console.log("Recorded contract event");
  }

  // Update the contract state
  if (contractType !== "kernel") {
    const isEnabled = parseIsEnabled(actionInt);

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
        name: await parseContractName(actionInt, target, context),
        type: contractType,
        isEnabled: isEnabled,
        policyPermissions: await parsePolicyPermissions(
          actionInt,
          target,
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
  // Insert records for the Kernel contract
  // Transaction: https://etherscan.io/tx/0xda3facf1f77124cdf4bddff8fa09221354ad663ec2f8b03dcc4657086ebf5e72

  const transactionHash =
    "0xda3facf1f77124cdf4bddff8fa09221354ad663ec2f8b03dcc4657086ebf5e72";
  const kernelAddress = "0x2286d7f9639e8158FaD1169e76d1FbC38247f54b";
  const kernelBlockNumber = 15998125;
  const kernelTimestamp = 1668790475;

  // Get the initial executor
  const initialExecutor = await getKernelExecutor(kernelAddress, context);

  console.log(`Inserting records for initial Kernel contract`);

  // Record the action event
  await context.db.insert(actionExecutedEvent).values({
    // Primary keys
    chainId: context.network.chainId,
    kernel: kernelAddress,
    transactionHash: transactionHash,
    logIndex: 0,
    // Timestamp
    timestamp: BigInt(kernelTimestamp),
    blockNumber: BigInt(kernelBlockNumber),
    // Other data
    action: "migrateKernel",
    target: kernelAddress,
  });
  console.log("Recorded action executed event");

  // Record the contract history
  await context.db.insert(contractEvent).values({
    // Primary keys
    chainId: context.network.chainId,
    transactionHash: transactionHash,
    logIndex: 0,
    // Timestamp
    timestamp: BigInt(kernelTimestamp),
    blockNumber: BigInt(kernelBlockNumber),
    // Other data
    name: "Kernel",
    address: kernelAddress,
    action: "migrateKernel",
    type: "kernel",
    isEnabled: true,
  });
  console.log("Recorded contract event");

  // Update the contract state
  await context.db.insert(contract).values({
    // Primary keys
    chainId: context.network.chainId,
    address: kernelAddress,
    // Timestamp
    lastUpdatedTimestamp: BigInt(kernelTimestamp),
    lastUpdatedBlockNumber: BigInt(kernelBlockNumber),
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
    kernel: kernelAddress,
    // Timestamp
    lastUpdatedTimestamp: BigInt(kernelTimestamp),
    lastUpdatedBlockNumber: BigInt(kernelBlockNumber),
    // Other data
    executor: initialExecutor,
  });
  console.log("Recorded kernel executor");

  // Record the kernel executor event
  await context.db.insert(kernelExecutorEvent).values({
    // Primary keys
    chainId: context.network.chainId,
    kernel: kernelAddress,
    transactionHash: transactionHash,
    logIndex: 0,
    // Timestamp
    timestamp: BigInt(kernelTimestamp),
    blockNumber: BigInt(kernelBlockNumber),
    // Other data
    executor: initialExecutor,
  });
  console.log("Recorded kernel executor event");
});

// TODO:
// - Role events
// - Handle migrate kernel
