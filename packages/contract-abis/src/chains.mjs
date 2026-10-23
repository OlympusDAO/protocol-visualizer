import * as viemChains from "viem/chains";

// The chain names in env.json and config.json are also export names in
// viem/chains, so viem gives the chain ID.
export function chainIdOf(chain) {
  // biome-ignore lint/performance/noDynamicNamespaceImportAccess: a Node script, not a bundle; config.json names the chains.
  const id = viemChains[chain]?.id;
  if (id === undefined) {
    throw new Error(`viem/chains has no chain ${chain}.`);
  }
  return id;
}
