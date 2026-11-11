import * as viemChains from "viem/chains";

// The chain names in env.json and config.json are viem/chains export names in
// kebab case, for example arbitrum-sepolia for arbitrumSepolia. viem gives the
// chain ID.
export function chainIdOf(chain) {
  const name = chain.replace(/-([a-z0-9])/g, (_, letter) =>
    letter.toUpperCase()
  );
  // biome-ignore lint/performance/noDynamicNamespaceImportAccess: a Node script, not a bundle; config.json names the chains.
  const id = viemChains[name]?.id;
  if (id === undefined) {
    throw new Error(`viem/chains has no chain ${chain}.`);
  }
  return id;
}
