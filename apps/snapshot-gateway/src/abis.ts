import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AbiDeployment,
  AbiDeploymentResponse,
  AbiIndexResponse,
} from "@protocol-visualizer/snapshot-artifacts";

// abis/manifest.json of packages/contract-abis. The gateway reads only the
// deployments. `abi` is the path of the ABI file, which the API does not show.
export type AbiRegistryManifest = {
  deployments: Array<AbiDeployment & { abi: string }>;
};

// The committed registry, loaded into memory at startup. It changes only with
// a new image, so each response body is serialized one time.
export type AbiRegistry = {
  index: string;
  byAddress: (chainId: number, address: string) => string | undefined;
  byLabel: (chainId: number, label: string) => string | undefined;
};

export const defaultAbisPath = "../../packages/contract-abis/abis";

const toBody = (value: unknown) => `${JSON.stringify(value)}\n`;

export function createAbiRegistry(
  manifest: AbiRegistryManifest,
  abis: Map<string, unknown[]>
): AbiRegistry {
  const chains = new Map<number, AbiIndexResponse["data"][number]>();
  const addresses = new Map<string, string>();
  const labels = new Map<string, string>();
  for (const { abi: file, ...deployment } of manifest.deployments) {
    const abi = abis.get(file);
    if (!abi) throw new Error(`ABI file ${file} is missing`);
    const response: AbiDeploymentResponse = { data: { deployment, abi } };
    const body = toBody(response);
    addresses.set(
      `${deployment.chainId}:${deployment.address.toLowerCase()}`,
      body
    );
    labels.set(`${deployment.chainId}:${deployment.label}`, body);
    let chain = chains.get(deployment.chainId);
    if (!chain) {
      chain = {
        chainId: deployment.chainId,
        chain: deployment.chain,
        contracts: [],
      };
      chains.set(deployment.chainId, chain);
    }
    chain.contracts.push({
      label: deployment.label,
      address: deployment.address,
    });
  }
  const index: AbiIndexResponse = { data: [...chains.values()] };
  return {
    index: toBody(index),
    byAddress: (chainId, address) =>
      addresses.get(`${chainId}:${address.toLowerCase()}`),
    byLabel: (chainId, label) => labels.get(`${chainId}:${label}`),
  };
}

export async function loadAbiRegistry(dir: string): Promise<AbiRegistry> {
  const manifest = JSON.parse(
    await readFile(join(dir, "manifest.json"), "utf8")
  ) as AbiRegistryManifest;
  const abis = new Map<string, unknown[]>();
  await Promise.all(
    manifest.deployments.map(async ({ abi: file }) => {
      abis.set(file, JSON.parse(await readFile(join(dir, file), "utf8")));
    })
  );
  return createAbiRegistry(manifest, abis);
}
