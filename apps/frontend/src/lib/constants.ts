import protocolChains from "../../../../packages/protocol-config/protocol-chains.json";

export type ProtocolChain = {
  key: string;
  chainId: number;
  name: string;
  explorerBaseUrl: string;
};

export const SUPPORTED_CHAINS = protocolChains satisfies ProtocolChain[];

export const ChainId = Object.freeze(
  Object.fromEntries(
    SUPPORTED_CHAINS.map((chain) => [chain.key, chain.chainId])
  )
) as Record<string, number>;

export const DEFAULT_CHAIN_ID = ChainId.Mainnet;
