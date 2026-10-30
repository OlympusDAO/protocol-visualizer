import proofs from "../generated/kernel-read-proofs.json";
import { getKernelConstants } from "../constants";
import { contractId } from "./ids";
import type { ControlBlock } from "./control-state";
import type {
  ContractEntity,
  EnvioContext,
  KernelActionExecutedEvent,
} from "./types";

export type KernelReadInput = {
  chainId: number;
  address: string;
  getter: string;
  block: ControlBlock;
};
type Epoch = { epoch: string; migrated: boolean };
type Result = { status: string; verifiedAt?: ControlBlock };
type Cached<T> = { epoch: string; result: T; verifiedAt: ControlBlock };

export function kernelReadProof(
  input: Pick<KernelReadInput, "chainId" | "address" | "getter">
) {
  return proofs.find(
    (proof) =>
      proof.chainId === input.chainId &&
      proof.address === input.address.toLowerCase() &&
      (input.getter.startsWith("moduleDependents:")
        ? proof.name === "kernel"
        : (proof.getters as readonly string[]).includes(input.getter))
  );
}

/** Rollback-aware entity state, never a process global or rollback-surviving effect. */
export async function invalidateKernelReads(
  context: EnvioContext,
  event: KernelActionExecutedEvent
) {
  const id = String(event.chainId);
  const previous = await context.KernelReadEpoch.get<Epoch>(id);
  context.KernelReadEpoch.set({
    id,
    chainId: event.chainId,
    epoch: `${event.block.hash}:${event.transaction.hash}:${event.logIndex}`,
    // Old Kernel active records survive migration; don't trust them again.
    migrated: previous?.migrated === true || Number(event.params.action_) === 5,
  });
}

export async function reuseKernelRead<T extends Result>(
  context: EnvioContext,
  input: KernelReadInput,
  read: () => Promise<T>,
  verifyRuntime: () => Promise<string | undefined>,
  readBlock: (number: string) => Promise<ControlBlock | undefined>
): Promise<T> {
  const proof = kernelReadProof(input);
  if (!proof) return read();
  const epoch = await context.KernelReadEpoch.get<Epoch>(String(input.chainId));
  if (epoch?.migrated) return read();
  if (proof.name !== "kernel") {
    const contract = await context.Contract.get<ContractEntity>(
      contractId(input.chainId, input.address)
    );
    if (!contract?.isEnabled || contract.kernelHistory !== "installed")
      return read();
  } else if (
    input.address.toLowerCase() !==
    getKernelConstants(input.chainId).address.toLowerCase()
  )
    return read();
  const generation = epoch?.epoch ?? "initial";
  const id = `${input.chainId}:${proof.address}:${proof.codeHash}:${input.getter}:v1`;
  const cached = await context.KernelReadCache.get<Cached<T>>(id);
  if (
    cached?.epoch === generation &&
    BigInt(cached.verifiedAt.number) <= BigInt(input.block.number)
  ) {
    const [anchor, current] = await Promise.all([
      readBlock(cached.verifiedAt.number),
      readBlock(input.block.number),
    ]);
    if (
      anchor?.hash === cached.verifiedAt.hash &&
      current?.hash === input.block.hash
    )
      return { ...cached.result, verifiedAt: cached.verifiedAt };
  }
  const result = await read();
  if (
    result.status === "success" &&
    (await verifyRuntime()) === proof.codeHash
  ) {
    const current = await readBlock(input.block.number);
    if (current?.hash === input.block.hash)
      context.KernelReadCache.set({
        id,
        chainId: input.chainId,
        epoch: generation,
        result,
        verifiedAt: input.block,
      });
  }
  return result;
}
