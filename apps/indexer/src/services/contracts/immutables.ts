import {
  keccak256,
  stringToHex,
  toFunctionSelector,
  type Abi,
  type Hex,
} from "viem";
import type { ImmutableDeployment, OrdinaryDeployment } from "./types";

export const verifiedGetterFields =
  "metadata,sources,sourceIds,runtimeBytecode.onchainBytecode,runtimeBytecode.sourceMap,runtimeBytecode.immutableReferences,deployment.blockNumber,compilation.language,proxyResolution";

export type VerifiedImmutableInput = {
  chainId?: string | number;
  address?: string;
  runtimeMatch?: string | null;
  deployment?: { blockNumber?: string | number | null };
  compilation?: { language?: string };
  proxyResolution?: { isProxy?: boolean } | null;
  runtimeBytecode?: {
    onchainBytecode?: Hex;
    sourceMap?: string;
    immutableReferences?: Record<string, { start: number; length: number }[]>;
  };
  sourceIds?: Record<string, { id: number }>;
  sources?: Record<string, { content?: string }>;
  metadata?: {
    language?: string;
    sources?: Record<string, { keccak256?: string }>;
    output?: { abi?: Abi };
  };
};

/** Restrict lifetime facts to ordinary bytecode; only PUSH operands are skipped. */
export function ordinaryRuntime(code: Hex): boolean {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(code)) return false;
  const bytes = Buffer.from(code.slice(2), "hex");
  if (bytes.readUInt8(0) === 0xef) return false; // Delegation designators and EOF need a different decoder.
  // Scan the entire runtime: arbitrary last bytes do not prove a CBOR boundary.
  // Metadata may cause a conservative false negative, never hide executable code.
  for (let pc = 0; pc < bytes.length; pc++) {
    const opcode = bytes.readUInt8(pc);
    if ([0xf2, 0xf4, 0xff].includes(opcode)) return false;
    if (opcode >= 0x60 && opcode <= 0x7f) pc += opcode - 0x5f;
  }
  return true;
}

export function discoverOrdinaryDeployment(
  verified: VerifiedImmutableInput,
  chainId: string | number,
  address: string
): OrdinaryDeployment | undefined {
  const creationBlock = String(verified.deployment?.blockNumber ?? "");
  const code = verified.runtimeBytecode?.onchainBytecode;
  if (
    !/^[1-9][0-9]*$/.test(String(chainId)) ||
    !Number.isSafeInteger(Number(chainId)) ||
    String(verified.chainId) !== String(chainId) ||
    verified.address?.toLowerCase() !== address.toLowerCase() ||
    !["match", "exact_match"].includes(verified.runtimeMatch ?? "") ||
    (verified.compilation?.language ?? verified.metadata?.language) !==
      "Solidity" ||
    verified.proxyResolution?.isProxy === true ||
    !/^[1-9][0-9]*$/.test(creationBlock) ||
    !code ||
    !ordinaryRuntime(code)
  )
    return undefined;
  return {
    chainId: Number(chainId),
    address: address.toLowerCase(),
    creationBlock,
    codeHash: keccak256(code),
    version: "ordinary-runtime-v1",
    sourceUrl: `https://sourcify.dev/server/v2/contract/${chainId}/${address.toLowerCase()}?fields=${verifiedGetterFields}`,
  };
}

/**
 * Compiler immutableReferences identify immutable operands; compiler sourceMap
 * entries bind generated public getters to their declarations. ABI names alone
 * never establish immutability. No compiler process or source-name allowlist.
 */
export function discoverImmutableDeployment(
  verified: VerifiedImmutableInput,
  chainId: string | number,
  address: string
): ImmutableDeployment | undefined {
  const ordinary = discoverOrdinaryDeployment(verified, chainId, address);
  const runtime = verified.runtimeBytecode;
  if (
    !ordinary ||
    !runtime?.onchainBytecode ||
    !runtime.sourceMap ||
    !runtime.immutableReferences ||
    !verified.sourceIds ||
    !verified.sources
  )
    return undefined;
  if (
    !Object.values(runtime.immutableReferences).some(
      (references) => references.length
    )
  )
    return undefined;
  const abiGetters = new Set(
    (verified.metadata?.output?.abi ?? []).flatMap((fn) =>
      fn.type === "function" &&
      ["view", "pure"].includes(fn.stateMutability) &&
      fn.inputs.length === 0 &&
      fn.outputs.length === 1 &&
      fn.outputs[0]?.type === "address"
        ? [fn.name]
        : []
    )
  );
  const bytes = Buffer.from(runtime.onchainBytecode.slice(2), "hex");
  const locations = new Map<
    number,
    { start: number; length: number; sourceId: number }
  >();
  const fields: [string, string, string] = ["", "", ""];
  let pc = 0;
  for (const entry of runtime.sourceMap.split(";")) {
    const values = entry.split(":");
    for (let index = 0; index < 3; index++) {
      const value = values[index];
      if (value) fields[index] = value;
    }
    if (pc >= bytes.length || fields.some((value) => !/^-?[0-9]+$/.test(value)))
      return undefined;
    locations.set(pc, {
      start: Number(fields[0]),
      length: Number(fields[1]),
      sourceId: Number(fields[2]),
    });
    const opcode = bytes.readUInt8(pc);
    pc += 1 + (opcode >= 0x60 && opcode <= 0x7f ? opcode - 0x5f : 0);
  }
  const paths = new Map<number, string>();
  for (const [path, source] of Object.entries(verified.sourceIds)) {
    if (!Number.isSafeInteger(source.id) || paths.has(source.id))
      return undefined;
    paths.set(source.id, path);
  }
  const immutableGetters: Record<string, string> = {};
  const owners = new Map<string, string>();
  const validatedSources = new Map<string, Buffer>();
  for (const [id, references] of Object.entries(runtime.immutableReferences)) {
    if (!references.length) continue;
    let value: string | undefined;
    for (const reference of references) {
      if (
        !Number.isSafeInteger(reference.start) ||
        reference.start < 1 ||
        reference.length !== 32 ||
        reference.start + 32 > bytes.length ||
        bytes.readUInt8(reference.start - 1) !== 0x7f ||
        !locations.has(reference.start - 1)
      )
        return undefined;
      const actual = bytes
        .subarray(reference.start, reference.start + 32)
        .toString("hex");
      if (value !== undefined && actual !== value) return undefined;
      value = actual;
      const location = locations.get(reference.start - 1);
      if (!location) return undefined;
      const path = paths.get(location.sourceId);
      if (!path) return undefined;
      let sourceBytes = validatedSources.get(path);
      if (!sourceBytes) {
        const content = verified.sources[path]?.content;
        const sourceHash = verified.metadata?.sources?.[path]?.keccak256;
        if (
          !content ||
          !sourceHash ||
          keccak256(stringToHex(content)) !== sourceHash
        )
          return undefined;
        sourceBytes = Buffer.from(content, "utf8");
        validatedSources.set(path, sourceBytes);
      }
      if (
        location.start < 0 ||
        location.length <= 0 ||
        location.start + location.length > sourceBytes.length
      )
        return undefined;
      const declaration = (
        sourceBytes
          .subarray(location.start, location.start + location.length)
          .toString("utf8")
          .split("=", 1)[0] ?? ""
      ).trim();
      const match =
        /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\s+payable)?\s+(?:public\s+immutable|immutable\s+public)(?:\s+override(?:\([A-Za-z_$][\w$.,\s]*\))?)?\s+([A-Za-z_$][\w$]*)$/.exec(
          declaration
        );
      const name = match?.[2];
      if (!name || !abiGetters.has(name)) continue;
      if (!/^0{24}[0-9a-f]{40}$/.test(actual)) return undefined;
      const selector = toFunctionSelector(`${name}()`);
      if (owners.has(selector) && owners.get(selector) !== id) return undefined;
      owners.set(selector, id);
      immutableGetters[selector] = `${name}()`;
    }
  }
  if (!Object.keys(immutableGetters).length) return undefined;
  return {
    ...ordinary,
    version: "compiler-immutables-v1",
    immutableGetters: Object.fromEntries(
      Object.entries(immutableGetters).sort(([a], [b]) => a.localeCompare(b))
    ),
  };
}
