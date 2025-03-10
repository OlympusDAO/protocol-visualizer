import { ponder } from "ponder:registry";
import { fromHex } from "viem";
import { roleAssignment, roleEvent, role as roleTable } from "../ponder.schema";
import { getContractName } from "./ContractNames";

ponder.on("ROLES:RoleGranted", async ({ event, context }) => {
  const role = fromHex(event.args.role_, "string").replace(/\0/g, "");
  const assignee = event.args.addr_;
  const timestamp = Number(event.block.timestamp);
  const blockNumber = Number(event.block.number);

  console.log(
    `Chain ${context.network.chainId}: Processing role granted event for ${role} to ${assignee}`
  );

  // Record the role event
  await context.db.insert(roleEvent).values({
    // Primary keys
    chainId: context.network.chainId,
    role: role,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    // Timestamp
    timestamp: BigInt(timestamp),
    blockNumber: BigInt(blockNumber),
    // Other data
    assignee: assignee,
    assigneeName: getContractName(assignee, context.network.chainId),
    isGranted: true,
  });

  // Record the role assignment (or update)
  await context.db
    .insert(roleAssignment)
    .values({
      // Primary keys
      chainId: context.network.chainId,
      role: role,
      assignee: assignee,
      // Timestamp
      lastUpdatedTimestamp: BigInt(timestamp),
      lastUpdatedBlockNumber: BigInt(blockNumber),
      // Other data
      assigneeName: getContractName(assignee, context.network.chainId),
      isGranted: true,
    })
    .onConflictDoUpdate({
      isGranted: true,
    });

  // Record the role (if needed)
  await context.db
    .insert(roleTable)
    .values({
      // Primary keys
      chainId: context.network.chainId,
      role: role,
    })
    .onConflictDoNothing();
});

ponder.on("ROLES:RoleRevoked", async ({ event, context }) => {
  const role = fromHex(event.args.role_, "string").replace(/\0/g, "");
  const assignee = event.args.addr_;
  const timestamp = Number(event.block.timestamp);
  const blockNumber = Number(event.block.number);

  console.log(
    `Chain ${context.network.chainId}: Processing role revoked event for ${role} from ${assignee}`
  );

  // Record the role event
  await context.db.insert(roleEvent).values({
    // Primary keys
    chainId: context.network.chainId,
    role: role,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    // Timestamp
    timestamp: BigInt(timestamp),
    blockNumber: BigInt(blockNumber),
    // Other data
    assignee: assignee,
    assigneeName: getContractName(assignee, context.network.chainId),
    isGranted: false,
  });

  // Update the role assignment
  await context.db
    .update(roleAssignment, {
      chainId: context.network.chainId,
      role: role,
      assignee: assignee,
    })
    .set({
      // Timestamp
      lastUpdatedTimestamp: BigInt(timestamp),
      lastUpdatedBlockNumber: BigInt(blockNumber),
      // Other data
      isGranted: false,
    });

  // The role would already have been created upon granting the role
});
