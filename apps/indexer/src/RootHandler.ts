import { Context, ponder } from "ponder:registry";
import {
  actionExecutedEvent,
  contract,
  contractEvent,
  PolicyPermission,
} from "ponder:schema";
import { ModuleAbi } from "../abis/Module";
import { fromHex } from "viem";
import { PolicyAbi } from "../abis/Policy";

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

const parseModuleKeycode = async (
  action: number,
  target: `0x${string}`,
  context: Context
): Promise<string | null> => {
  if (action > 1) {
    console.debug(`Skipping keycode for non-module action: ${action}`);
    return null;
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
    return "unknown";
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

ponder.on("Kernel:ActionExecuted", async ({ event, context }) => {
  const action = event.args.action_;
  const target = event.args.target_;
  const timestamp = Number(event.block.timestamp);

  console.log(
    `Processing action ${action} on target ${target} at block ${event.block.number}`
  );

  // Record the action event
  await context.db.insert(actionExecutedEvent).values({
    // Primary keys
    chainId: context.network.chainId,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    // Timestamp
    timestamp: BigInt(timestamp),
    blockNumber: BigInt(event.block.number),
    // Other data
    action: parseAction(action),
    target: target,
  });
  console.log("Recorded action executed event");

  // Record the contract history
  if (parseContractType(action) !== "kernel") {
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
      action: parseAction(action),
      type: parseContractType(action),
      isEnabled: parseIsEnabled(action),
      moduleKeycode: await parseModuleKeycode(action, target, context),
      policyPermissions: await parsePolicyPermissions(action, target, context),
    });
    console.log("Recorded contract event");
  }

  // Update the contract state
  if (parseContractType(action) !== "kernel") {
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
        type: parseContractType(action),
        isEnabled: parseIsEnabled(action),
        moduleKeycode: await parseModuleKeycode(action, target, context),
        policyPermissions: await parsePolicyPermissions(
          action,
          target,
          context
        ),
      })
      .onConflictDoUpdate({
        isEnabled: parseIsEnabled(action),
      });
    console.log("Updated contract");
  }
});

// TODO:
// - Role events
// - Handle kernel executor
// - Handle migrate kernel
// - Bootstrap initial Kernel contract
