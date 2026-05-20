import type { Context } from "ponder:registry";
import { and, desc, eq } from "ponder";
import { contract as contractTable } from "../../ponder.schema";

type Contract = typeof contractTable.$inferSelect;

export const getLatestContractByName = async (
  name: string,
  context: Context,
): Promise<Contract | null> => {
  const contract = await context.db.sql
    .select()
    .from(contractTable)
    .where(
      and(
        eq(contractTable.name, name),
        eq(contractTable.chainId, context.chain.id),
      ),
    )
    .orderBy(desc(contractTable.lastUpdatedTimestamp));

  if (contract.length === 0) {
    return null;
  }

  return contract[0] || null;
};
