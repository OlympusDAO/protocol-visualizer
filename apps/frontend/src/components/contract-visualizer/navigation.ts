import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { DEFAULT_CHAIN_ID, SUPPORTED_CHAINS } from "../../lib/constants";

type GraphNavigation = {
  chainId: number;
  node: string | null;
  notice: string | null;
};

export function parseGraphUrl(url: URL): GraphNavigation {
  const requestedChain = url.searchParams.get("chain");
  const chainId =
    requestedChain === null ? DEFAULT_CHAIN_ID : Number(requestedChain);
  if (!SUPPORTED_CHAINS.some((chain) => chain.chainId === chainId)) {
    return {
      chainId: DEFAULT_CHAIN_ID,
      node: null,
      notice: "Unsupported chain. Showing the default chain.",
    };
  }
  const requestedNode = url.searchParams.get("node");
  if (requestedNode === null) return { chainId, node: null, notice: null };
  if (/^0x[0-9a-fA-F]{40}$/.test(requestedNode)) {
    return { chainId, node: requestedNode.toLowerCase(), notice: null };
  }
  if (requestedNode.startsWith("role-") && requestedNode.length > 5) {
    return { chainId, node: requestedNode, notice: null };
  }
  return {
    chainId,
    node: null,
    notice: "Invalid selection. Showing the chain overview.",
  };
}

export function writeGraphUrl(
  url: URL,
  next: Pick<GraphNavigation, "chainId" | "node">
): URL {
  const result = new URL(url);
  result.searchParams.set("chain", String(next.chainId));
  if (next.node) result.searchParams.set("node", next.node);
  else result.searchParams.delete("node");
  return result;
}

export function useGraphNavigation() {
  const [navigation, setNavigation] = useState(() =>
    parseGraphUrl(new URL(window.location.href))
  );
  const current = useRef(navigation);
  const navigate = useCallback((next: GraphNavigation, replace = false) => {
    const url = writeGraphUrl(new URL(window.location.href), next);
    if (url.href !== window.location.href) {
      if (replace) window.history.replaceState(window.history.state, "", url);
      else window.history.pushState(null, "", url);
    }
    current.current = next;
    setNavigation(next);
  }, []);

  useEffect(() => {
    const restore = () => {
      const next = parseGraphUrl(new URL(window.location.href));
      current.current = next;
      setNavigation(next);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const setSelectedNode = useCallback(
    (value: SetStateAction<string | null>) => {
      const node =
        typeof value === "function" ? value(current.current.node) : value;
      if (node === current.current.node) return;
      navigate({ ...current.current, node, notice: null });
    },
    [navigate]
  );
  const setSelectedChainId = useCallback(
    (chainId: number) => {
      if (chainId === current.current.chainId) return;
      navigate({ chainId, node: null, notice: null });
    },
    [navigate]
  );
  const reconcileSelection = useCallback(
    (node: string | null) => {
      if (node === current.current.node) return;
      navigate(
        {
          ...current.current,
          node,
          notice: "The selected node is not available on this chain.",
        },
        true
      );
    },
    [navigate]
  );

  return {
    ...navigation,
    setSelectedNode,
    setSelectedChainId,
    reconcileSelection,
  };
}
