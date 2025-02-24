import { onchainEnum, onchainTable, primaryKey, relations } from 'ponder';

export const contractType = onchainEnum("contractType", [
  "kernel",
  "module",
  "policy",
]);

export const actionType = onchainEnum("actionType", [
  "installModule",
  "upgradeModule",
  "activatePolicy",
  "deactivatePolicy",
  "changeExecutor",
  "migrateKernel",
]);

/**
 * Latest state of a contract on a chain.
 */
export const contract = onchainTable("contract", (t) => ({
  // Primary keys
  chainId: t.integer().notNull(),
  address: t.hex().notNull(),
  // Other data
  type: contractType().notNull(),
  isEnabled: t.boolean().notNull(),
  keycode: t.text(), // Modules only
}), (table) => ({
  pk: primaryKey({ columns: [table.chainId, table.address] }),
}));

/**
 * Events that occurred on a contract.
 */
export const contractEvent = onchainTable("contractEvent", (t) => ({
  // Primary keys
  chainId: t.integer().notNull(),
  transactionHash: t.hex().notNull(),
  logIndex: t.integer().notNull(), // Ensures a unique id if there are multiple operations on the same contract in the same transaction
  // Other data
  address: t.hex().notNull(),
  action: actionType().notNull(),
  type: contractType().notNull(),
  isEnabled: t.boolean().notNull(),
  keycode: t.text(), // Modules only
  timestamp: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
}), (table) => ({
  pk: primaryKey({ columns: [table.chainId, table.transactionHash, table.logIndex] }),
}));

export const contractRelations = relations(contract, ({ many }) => ({
  events: many(contractEvent),
}));

export const contractEventRelations = relations(contractEvent, ({ one }) => ({
  contract: one(contract, {
    fields: [contractEvent.chainId, contractEvent.address],
    references: [contract.chainId, contract.address],
  }),
}));

export const actionExecutedEvent = onchainTable("actionExecutedEvent", (t) => ({
  // Primary keys
  chainId: t.integer().notNull(),
  transactionHash: t.hex().notNull(),
  logIndex: t.integer().notNull(), // Ensures a unique id if there are multiple operations on the same contract in the same transaction
  // Other data
  action: actionType().notNull(),
  target: t.hex().notNull(),
  timestamp: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
}), (table) => ({
  pk: primaryKey({ columns: [table.chainId, table.transactionHash, table.logIndex] }),
}));

export const actionExecutedEventRelations = relations(actionExecutedEvent, ({ one }) => ({
  contractEvent: one(contractEvent, {
    fields: [actionExecutedEvent.chainId, actionExecutedEvent.transactionHash, actionExecutedEvent.logIndex],
    references: [contractEvent.chainId, contractEvent.transactionHash, contractEvent.logIndex],
  }),
  contract: one(contract, {
    fields: [actionExecutedEvent.chainId, actionExecutedEvent.target],
    references: [contract.chainId, contract.address],
  }),
}));
