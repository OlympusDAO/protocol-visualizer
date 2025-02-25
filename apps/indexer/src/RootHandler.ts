import { Context, ponder } from "ponder:registry";
import { actionExecutedEvent, contract, contractEvent } from "ponder:schema";
import { ModuleAbi } from "../abis/Module";
import { decodeAbiParameters, parseAbiParameters } from "viem";

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
      throw new Error(`Unknown/unsupported Kernel action: ${action}`);
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
      throw new Error(`Unknown/unsupported Kernel action: ${action}`);
  }
};

const parseKeycode = async (
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
    console.debug(`Reading KEYCODE from module at ${target}`);
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

  console.debug(
    `Decoding KEYCODE from module at ${target} with value ${keycodeResult}`
  );

  // Decode from bytes5 to string
  const keycode = decodeAbiParameters(
    parseAbiParameters("bytes5"),
    keycodeResult
  );
  if (keycode.length !== 1) {
    throw new Error(`Unable to decode keycode for value ${keycodeResult}`);
  }

  console.debug(`Decoded KEYCODE from module at ${target}: ${keycode[0]}`);

  return keycode[0];
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
    chainId: context.network.chainId,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    action: parseAction(action),
    target: target,
    timestamp: BigInt(timestamp),
    blockNumber: BigInt(event.block.number),
  });
  console.log("Recorded action executed event");

  // Record the contract history
  await context.db.insert(contractEvent).values({
    chainId: context.network.chainId,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    address: target,
    action: parseAction(action),
    type: parseContractType(action),
    isEnabled: parseIsEnabled(action),
    keycode: await parseKeycode(action, target, context),
    timestamp: BigInt(timestamp),
    blockNumber: BigInt(event.block.number),
  });
  console.log("Recorded contract event");

  // Update the contract state
  await context.db
    .insert(contract)
    .values({
      chainId: context.network.chainId,
      address: target,
      type: parseContractType(action),
      isEnabled: parseIsEnabled(action),
      keycode: await parseKeycode(action, target, context),
      timestamp: BigInt(timestamp),
      blockNumber: BigInt(event.block.number),
    })
    .onConflictDoUpdate({
      isEnabled: parseIsEnabled(action),
    });
  console.log("Updated contract");
});

// TODO:
// - Role events
// - Handle kernel executor
// - Handle migrate kernel
// - Bootstrap initial Kernel contract
