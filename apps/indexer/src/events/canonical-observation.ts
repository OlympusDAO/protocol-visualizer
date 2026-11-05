import type { ControlBlock } from "./control-state";
import {
  getPublicClient,
  RpcTransientFailure,
  rethrowTransientRpc,
} from "./rpc";

export type CanonicalBlockReader = (
  chainId: number,
  blockNumber: bigint
) => Promise<CanonicalHeader>;

type CanonicalHeader = {
  hash?: string | null;
  parentHash?: string;
  timestamp?: bigint;
  number?: bigint | null;
};
type FreshReader = (
  chainId: number,
  blockNumber: bigint
) => Promise<CanonicalHeader | undefined>;

export type CanonicalObservation = {
  block: ControlBlock;
  readBlock: (number: string) => Promise<ControlBlock | undefined>;
  readCanonicalBlock: (
    chainId: number,
    blockNumber: bigint
  ) => Promise<CanonicalHeader>;
};

export class CanonicalObservationChanged extends Error {
  constructor() {
    super("Canonical observation changed or unavailable");
    this.name = "CanonicalObservationChanged";
  }
}

/** Share numeric headers only for this callback; recheck every used anchor fresh. */
export async function withCanonicalObservation(
  chainId: number,
  blockNumber: bigint,
  run: (phase: CanonicalObservation) => Promise<boolean | undefined>,
  readFresh: FreshReader = (chain, number) =>
    getPublicClient(chain).getBlock({ blockNumber: number })
): Promise<ControlBlock> {
  let failure: Error | undefined;
  let open = true;
  const anchors = new Map<bigint, Promise<CanonicalHeader>>();
  const reject = (error?: unknown): never => {
    let safe: Error = new CanonicalObservationChanged();
    if (error instanceof RpcTransientFailure) safe = error;
    else {
      try {
        rethrowTransientRpc(error);
      } catch (transient) {
        safe = transient as RpcTransientFailure;
      }
    }
    if (!failure || safe instanceof RpcTransientFailure) failure = safe;
    throw safe;
  };
  const fresh = async (number: bigint): Promise<CanonicalHeader> => {
    try {
      const header = await readFresh(chainId, number);
      if (
        !header?.hash ||
        !/^0x[0-9a-f]{64}$/i.test(header.hash) ||
        header.number !== number ||
        typeof header.timestamp !== "bigint"
      )
        return reject();
      return Object.freeze({ ...header, hash: header.hash.toLowerCase() });
    } catch (error) {
      return reject(error);
    }
  };
  const read = (chain: number, number: bigint): Promise<CanonicalHeader> => {
    if (!open || chain !== chainId || number < 0n) return reject();
    let result = anchors.get(number);
    if (!result) {
      result = fresh(number);
      anchors.set(number, result);
    }
    return result;
  };
  const toControlBlock = (
    number: bigint,
    header: CanonicalHeader
  ): ControlBlock =>
    Object.freeze({
      number: number.toString(),
      hash: header.hash as string,
      timestamp: (header.timestamp as bigint).toString(),
    });
  try {
    const block = toControlBlock(blockNumber, await read(chainId, blockNumber));
    const complete = await run({
      block,
      readBlock: async (number) => {
        let height: bigint;
        try {
          height = BigInt(number);
        } catch {
          return reject();
        }
        return toControlBlock(height, await read(chainId, height));
      },
      readCanonicalBlock: read,
    });
    open = false;
    if (failure) throw failure;
    if (complete !== true) return reject();

    await Promise.all(anchors.values());
    const historical = [...anchors.entries()].filter(
      ([number]) => number !== blockNumber
    );
    for (let offset = 0; offset < historical.length; offset += 4) {
      await Promise.all(
        historical.slice(offset, offset + 4).map(async ([number, opening]) => {
          const before = await opening;
          const after = await fresh(number);
          if (before.hash !== after.hash) reject();
        })
      );
    }
    const after = await fresh(blockNumber);
    if (block.hash !== after.hash) return reject();
    if (failure) throw failure;
    return block;
  } finally {
    open = false;
  }
}
