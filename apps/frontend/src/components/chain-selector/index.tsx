import { ChainId } from "@/lib/constants";

interface ChainSelectorProps {
  selectedChainId: number;
  onChainChange: (chainId: number) => void;
}

const CHAIN_LABELS: Record<number, string> = {
  [ChainId.Mainnet]: "Ethereum Mainnet",
  [ChainId.Arbitrum]: "Arbitrum",
  [ChainId.Base]: "Base",
  [ChainId.Berachain]: "Berachain",
  [ChainId.Optimism]: "Optimism",
  [ChainId.Sepolia]: "Sepolia",
};

export function ChainSelector({
  selectedChainId,
  onChainChange,
}: ChainSelectorProps) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <label
        htmlFor="chain-select"
        className="text-sm font-medium text-gray-700"
      >
        Chain:
      </label>
      <select
        id="chain-select"
        value={selectedChainId}
        onChange={(e) => onChainChange(Number(e.target.value))}
        className="block w-48 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
      >
        {Object.entries(CHAIN_LABELS).map(([chainId, label]) => (
          <option key={chainId} value={chainId}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
