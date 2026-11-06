import { OBSERVATION_BLOCK_INTERVAL } from "../../../../packages/snapshot-artifacts/src/observation-constants";

/** Verify near the head even in the final backfill batch; skip old sparse callbacks. */
export function createLiveObservation<
  T extends {
    isPreload: boolean;
  },
>(
  readHead: () => Promise<bigint>,
  observe: (context: T, number: number) => Promise<unknown>
) {
  let eligibleFrom: bigint | undefined;
  return async ({
    block,
    context,
  }: {
    block: { number: number };
    context: T;
  }) => {
    if (context.isPreload) return;
    const number = BigInt(block.number);
    if (eligibleFrom !== undefined && number < eligibleFrom) return;
    const head = await readHead();
    if (number > head) return;
    eligibleFrom = head - BigInt(OBSERVATION_BLOCK_INTERVAL - 1);
    if (number < eligibleFrom) return;
    await observe(context, block.number);
    eligibleFrom = undefined;
  };
}
