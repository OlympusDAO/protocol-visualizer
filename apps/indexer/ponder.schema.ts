import { onchainEnum, onchainTable, primaryKey, relations } from "ponder";

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

export type PolicyPermission = {
  keycode: string;
  function: string;
};

/**
 * Latest state of a contract on a chain.
 */
export const contract = onchainTable(
  "contract",
  (t) => ({
    // Primary keys
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    // Timestamp
    lastUpdatedTimestamp: t.bigint().notNull(),
    lastUpdatedBlockNumber: t.bigint().notNull(),
    // Other data
    name: t.text().notNull(),
    type: contractType().notNull(),
    isEnabled: t.boolean().notNull(),
    policyPermissions: t.json().$type<PolicyPermission>().array(), // Policies only
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.address] }),
  })
);

/**
 * Events that occurred on a contract.
 */
export const contractEvent = onchainTable(
  "contractEvent",
  (t) => ({
    // Primary keys
    chainId: t.integer().notNull(),
    transactionHash: t.hex().notNull(),
    logIndex: t.integer().notNull(), // Ensures a unique id if there are multiple operations on the same contract in the same transaction
    // Timestamp
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    // Other data
    address: t.hex().notNull(),
    name: t.text().notNull(),
    action: actionType().notNull(),
    type: contractType().notNull(),
    isEnabled: t.boolean().notNull(),
    policyPermissions: t.json().$type<PolicyPermission>().array(), // Policies only
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.chainId, table.transactionHash, table.logIndex],
    }),
  })
);

// 1 contract -> many contract events
// 1 kernel -> 1 kernel executor
export const contractRelations = relations(contract, ({ one, many }) => ({
  events: many(contractEvent),
  kernelExecutor: one(kernelExecutor, {
    fields: [contract.chainId, contract.address],
    references: [kernelExecutor.chainId, kernelExecutor.kernel],
  }),
}));

// 1 contract event -> 1 contract
export const contractEventRelations = relations(contractEvent, ({ one }) => ({
  contract: one(contract, {
    fields: [contractEvent.chainId, contractEvent.address],
    references: [contract.chainId, contract.address],
  }),
}));

export const kernelExecutor = onchainTable(
  "kernelExecutor",
  (t) => ({
    // Primary keys
    chainId: t.integer().notNull(),
    kernel: t.hex().notNull(),
    // Timestamp
    lastUpdatedTimestamp: t.bigint().notNull(),
    lastUpdatedBlockNumber: t.bigint().notNull(),
    // Other data
    executor: t.hex().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.kernel] }),
  })
);

export const kernelExecutorEvent = onchainTable(
  "kernelExecutorEvent",
  (t) => ({
    // Primary keys
    chainId: t.integer().notNull(),
    kernel: t.hex().notNull(),
    transactionHash: t.hex().notNull(),
    logIndex: t.integer().notNull(), // Ensures a unique id if there are multiple operations on the same contract in the same transaction
    // Timestamp
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    // Other data
    executor: t.hex().notNull(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [
        table.chainId,
        table.kernel,
        table.transactionHash,
        table.logIndex,
      ],
    }),
  })
);

// 1 kernel executor -> 1 kernel
// 1 kernel executor -> many kernel executor events
export const kernelExecutorRelations = relations(
  kernelExecutor,
  ({ one, many }) => ({
    kernel: one(contract, {
      fields: [kernelExecutor.chainId, kernelExecutor.kernel],
      references: [contract.chainId, contract.address],
    }),
    events: many(kernelExecutorEvent),
  })
);

// 1 kernel executor event -> 1 kernel executor
export const kernelExecutorEventRelations = relations(
  kernelExecutorEvent,
  ({ one }) => ({
    kernelExecutor: one(kernelExecutor, {
      fields: [kernelExecutorEvent.chainId, kernelExecutorEvent.kernel],
      references: [kernelExecutor.chainId, kernelExecutor.kernel],
    }),
  })
);

export const actionExecutedEvent = onchainTable(
  "actionExecutedEvent",
  (t) => ({
    // Primary keys
    chainId: t.integer().notNull(),
    kernel: t.hex().notNull(),
    transactionHash: t.hex().notNull(),
    logIndex: t.integer().notNull(), // Ensures a unique id if there are multiple operations on the same contract in the same transaction
    // Timestamp
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    // Other data
    action: actionType().notNull(),
    target: t.hex().notNull(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [
        table.chainId,
        table.kernel,
        table.transactionHash,
        table.logIndex,
      ],
    }),
  })
);

// 1 action executed event -> 1 contract event
// 1 action executed event -> 1 contract
// 1 action executed event -> 1 kernel executor event
// 1 action executed event -> 1 kernel executor
export const actionExecutedEventRelations = relations(
  actionExecutedEvent,
  ({ one }) => ({
    contractEvent: one(contractEvent, {
      fields: [
        actionExecutedEvent.chainId,
        actionExecutedEvent.transactionHash,
        actionExecutedEvent.logIndex,
      ],
      references: [
        contractEvent.chainId,
        contractEvent.transactionHash,
        contractEvent.logIndex,
      ],
    }),
    contract: one(contract, {
      fields: [actionExecutedEvent.chainId, actionExecutedEvent.target],
      references: [contract.chainId, contract.address],
    }),
    kernelExecutorEvent: one(kernelExecutorEvent, {
      fields: [
        actionExecutedEvent.chainId,
        actionExecutedEvent.kernel,
        actionExecutedEvent.transactionHash,
        actionExecutedEvent.logIndex,
      ],
      references: [
        kernelExecutorEvent.chainId,
        kernelExecutorEvent.kernel,
        kernelExecutorEvent.transactionHash,
        kernelExecutorEvent.logIndex,
      ],
    }),
    kernelExecutor: one(kernelExecutor, {
      fields: [actionExecutedEvent.chainId, actionExecutedEvent.kernel],
      references: [kernelExecutor.chainId, kernelExecutor.kernel],
    }),
  })
);
