import { ponder } from "ponder:registry";
import { role, roleAssignment, roleEvent } from "ponder:schema";
import { getContractName } from "./ContractNames";
import { desc, eq } from "ponder";
import { ROLE_ROLES_ADMIN } from "./services/contracts/types";

ponder.on("RolesAdmin:NewAdminPulled", async ({ event, context }) => {
  const newAdmin = event.args.newAdmin_;
  const timestamp = Number(event.block.timestamp);
  const blockNumber = Number(event.block.number);

  console.log(`Processing new admin pulled event for ${newAdmin}`);

  // Find the existing admin, if applicable
  const existingRoleAssignment = await context.db.sql
    .select()
    .from(roleAssignment)
    .where(eq(roleAssignment.role, ROLE_ROLES_ADMIN))
    .orderBy(desc(roleAssignment.lastUpdatedTimestamp))
    .limit(1);
  if (existingRoleAssignment.length > 0 && existingRoleAssignment[0]) {
    const previousAssignee = existingRoleAssignment[0].assignee;

    // Record the disabled role event
    await context.db.insert(roleEvent).values({
      // Primary keys
      chainId: context.network.chainId,
      role: ROLE_ROLES_ADMIN,
      transactionHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      // Timestamp
      timestamp: BigInt(timestamp),
      blockNumber: BigInt(blockNumber),
      // Other data
      assignee: previousAssignee,
      assigneeName: existingRoleAssignment[0].assigneeName,
      isGranted: false,
    });

    // Disable the previous role assignment
    await context.db
      .update(roleAssignment, {
        chainId: context.network.chainId,
        role: ROLE_ROLES_ADMIN,
        assignee: previousAssignee,
      })
      .set({
        isGranted: false,
      });
  }

  // Record the role event
  await context.db.insert(roleEvent).values({
    // Primary keys
    chainId: context.network.chainId,
    role: ROLE_ROLES_ADMIN,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    // Timestamp
    timestamp: BigInt(timestamp),
    blockNumber: BigInt(blockNumber),
    // Other data
    assignee: newAdmin,
    assigneeName: getContractName(newAdmin),
    isGranted: true,
  });

  // Record the new role assignment
  await context.db.insert(roleAssignment).values({
    // Primary keys
    chainId: context.network.chainId,
    role: ROLE_ROLES_ADMIN,
    assignee: newAdmin,
    // Timestamp
    lastUpdatedTimestamp: BigInt(timestamp),
    lastUpdatedBlockNumber: BigInt(blockNumber),
    // Other data
    assigneeName: getContractName(newAdmin),
    isGranted: true,
  });

  // Record the role (if needed)
  await context.db
    .insert(role)
    .values({
      // Primary keys
      chainId: context.network.chainId,
      role: ROLE_ROLES_ADMIN,
    })
    .onConflictDoNothing();
});
