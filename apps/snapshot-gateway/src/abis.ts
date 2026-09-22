import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AbiDeployment,
  AbiDeploymentResponse,
  AbiRegistryManifest,
} from "@protocol-visualizer/snapshot-artifacts";

// The committed registry of packages/contract-abis, loaded into memory at
// startup. It changes only with a new image.
export type AbiRegistry = {
  manifest: AbiRegistryManifest;
  byAddress: (
    chainId: number,
    address: string
  ) => AbiDeploymentResponse | undefined;
  byLabel: (
    chainId: number,
    label: string
  ) => AbiDeploymentResponse | undefined;
};

export const defaultAbisPath = "../../packages/contract-abis/abis";

export function createAbiRegistry(
  manifest: AbiRegistryManifest,
  abis: Map<string, unknown[]>
): AbiRegistry {
  const addresses = new Map<string, AbiDeploymentResponse>();
  const labels = new Map<string, AbiDeploymentResponse>();
  for (const deployment of manifest.deployments) {
    const abi = abis.get(deployment.abi);
    if (!abi) throw new Error(`ABI file ${deployment.abi} is missing`);
    const response = { data: { deployment, abi } };
    addresses.set(
      `${deployment.chainId}:${deployment.address.toLowerCase()}`,
      response
    );
    labels.set(`${deployment.chainId}:${deployment.label}`, response);
  }
  return {
    manifest,
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
    manifest.deployments.map(async (deployment: AbiDeployment) => {
      abis.set(
        deployment.abi,
        JSON.parse(await readFile(join(dir, deployment.abi), "utf8"))
      );
    })
  );
  return createAbiRegistry(manifest, abis);
}
