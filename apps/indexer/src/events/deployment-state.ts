import type { Hex } from "viem";
import {
  emptyCodeHash,
  readExactBytecodeHash,
  type BytecodeContext,
  type BytecodePin,
} from "./code-cache";
import {
  getDeploymentFact,
  getOrdinaryDeployment,
  type CanonicalBlockReader,
  type DeploymentFact,
} from "./deployment-facts";
import { getPublicClient, rethrowTransientRpc } from "./rpc";

type VerifiedDeployment = {
  id: string;
  chainId: number;
  address: string;
  creationBlock: bigint;
  creationHash: string;
  codeHash: Hex;
  version: string;
  verifiedAt: DeploymentFact["verifiedAt"];
};

/** Ordinary Envio entities roll back with events; external proof effects do not. */
export async function readVerifiedDeploymentCode(
  context: BytecodeContext,
  chainId: number,
  pin: BytecodePin & { blockNumber: bigint },
  readCanonicalBlock: CanonicalBlockReader = (chain, blockNumber) =>
    getPublicClient(chain).getBlock({ blockNumber })
): Promise<Hex | undefined> {
  const store = context.VerifiedDeployment;
  if (!store) return readExactBytecodeHash(context, chainId, pin);
  const address = pin.address.toLowerCase();
  const id = `verified-deployment:${chainId}:${address}`;
  const stored = await store.get<VerifiedDeployment>(id);
  try {
    if (
      stored &&
      stored.chainId === chainId &&
      stored.address === address &&
      ["ordinary-runtime-v1", "compiler-immutables-v1"].includes(
        stored.version
      ) &&
      stored.creationBlock > 0n &&
      pin.blockNumber >= stored.creationBlock &&
      /^0x[0-9a-f]{64}$/i.test(stored.codeHash) &&
      stored.codeHash !== emptyCodeHash &&
      /^0x[0-9a-f]{64}$/i.test(stored.creationHash) &&
      stored.verifiedAt?.number === stored.creationBlock.toString() &&
      stored.verifiedAt?.hash === stored.creationHash
    ) {
      const matches = async () => {
        const [creation, requested] = await Promise.all([
          readCanonicalBlock(chainId, stored.creationBlock),
          readCanonicalBlock(chainId, pin.blockNumber),
        ]);
        return (
          creation.hash?.toLowerCase() === stored.creationHash &&
          requested.hash?.toLowerCase() === pin.blockHash.toLowerCase()
        );
      };
      if ((await matches()) && (await matches())) return stored.codeHash;
    }
    const codeHash = await readExactBytecodeHash(context, chainId, pin);
    if (!codeHash || codeHash === emptyCodeHash) return codeHash;
    const input = {
      chainId,
      address,
      blockNumber: pin.blockNumber,
      blockHash: pin.blockHash,
    };
    const deployment = await getOrdinaryDeployment(context, input, codeHash);
    if (!deployment || deployment.codeHash !== codeHash) return codeHash;
    const fact = await getDeploymentFact(
      context,
      input,
      deployment,
      readCanonicalBlock
    );
    if (fact?.codeHash === codeHash)
      store.set({
        id,
        chainId,
        address,
        creationBlock: BigInt(deployment.creationBlock),
        creationHash: fact.verifiedAt.hash,
        codeHash,
        version: deployment.version,
        verifiedAt: fact.verifiedAt,
      });
    return codeHash;
  } catch (error) {
    rethrowTransientRpc(error);
    return undefined;
  }
}
