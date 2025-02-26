import { client, schema } from "@/lib/ponder";

export type Contract = typeof schema.contract.$inferSelect;
export type ActionExecutedEvent =
  typeof schema.actionExecutedEvent.$inferSelect;

export async function getContracts(): Promise<Contract[]> {
  const result = await client.db.select().from(schema.contract);
  return result;
}

export async function getActionExecutedEvents(): Promise<
  ActionExecutedEvent[]
> {
  const result = await client.db.select().from(schema.actionExecutedEvent);
  return result;
}
