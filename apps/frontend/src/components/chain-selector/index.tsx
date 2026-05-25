import { SUPPORTED_CHAINS } from "@/lib/constants";

interface ChainSelectorProps {
  selectedChainId: number;
  onChainChange: (chainId: number) => void;
}

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
        {SUPPORTED_CHAINS.map((chain) => (
          <option key={chain.chainId} value={chain.chainId}>
            {chain.name}
          </option>
        ))}
      </select>
    </div>
  );
}
