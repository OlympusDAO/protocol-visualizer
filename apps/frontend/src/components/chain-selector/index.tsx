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
        className="text-sm font-medium text-foreground"
      >
        Chain:
      </label>
      <select
        id="chain-select"
        value={selectedChainId}
        onChange={(e) => onChainChange(Number(e.target.value))}
        className="block w-48 rounded-md border border-ui-border bg-surface text-foreground shadow-xs focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
      >
        {["production", "testnet"].map((environment) => (
          <optgroup
            key={environment}
            label={environment === "production" ? "Production" : "Testnets"}
          >
            {SUPPORTED_CHAINS.filter(
              (chain) => chain.environment === environment
            ).map((chain) => (
              <option key={chain.chainId} value={chain.chainId}>
                {chain.name}
                {chain.availability === "historical" ? " (historical)" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
