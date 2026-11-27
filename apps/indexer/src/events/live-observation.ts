import { ChainId } from "../constants";
import {
  type CanonicalHeader,
  validateCanonicalHeader,
} from "./canonical-observation";

const OBSERVATION_INTERVAL_SECONDS = 30n * 60n;

// Approximate 30-minute block counts from public RPC headers on 2026-11-26.
const blocksPerHalfHour = new Map([
  [ChainId.Mainnet, 150],
  [ChainId.Optimism, 900],
  [ChainId.Arbitrum, 6300],
  [ChainId.Base, 9000],
  [ChainId.Berachain, 900],
  [ChainId.Robinhood, 11100],
  [ChainId.Sepolia, 150],
  [ChainId.ArbitrumSepolia, 5800],
  [ChainId.BaseSepolia, 9000],
]);

export function getObservationCandidateInterval(chainId: number): number {
  const blocks = blocksPerHalfHour.get(chainId);
  if (blocks === undefined)
    throw new Error(`Missing live observation interval for chain ${chainId}`);
  return Math.floor(blocks / 30);
}

/** Verify near the head even in the final backfill batch; skip old sparse callbacks. */
export function createLiveObservation<T extends { isPreload: boolean }>({
  candidateInterval,
  readHead,
  readHeader,
  lastObservedAt,
  observe,
}: {
  candidateInterval: number;
  readHead: () => Promise<bigint>;
  readHeader: (number: bigint) => Promise<CanonicalHeader | undefined>;
  lastObservedAt: (context: T) => Promise<bigint | undefined>;
  observe: (
    context: T,
    number: number,
    openingHeader?: CanonicalHeader
  ) => Promise<void>;
}) {
  let eligibleFrom: bigint | undefined;
  const maxHeadLag = BigInt(candidateInterval - 1);
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
    eligibleFrom = head - maxHeadLag;
    if (number < eligibleFrom) return;

    const previous = await lastObservedAt(context);
    let openingHeader: CanonicalHeader | undefined;
    if (previous !== undefined) {
      const sampled = validateCanonicalHeader(await readHeader(number), number);
      if (
        sampled.timestamp / OBSERVATION_INTERVAL_SECONDS <=
        previous / OBSERVATION_INTERVAL_SECONDS
      )
        return;
      openingHeader = sampled;
    }

    await observe(context, block.number, openingHeader);
    eligibleFrom = undefined;
  };
}
