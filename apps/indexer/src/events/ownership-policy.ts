import proofs from "../generated/ownership-read-proofs.json";
import type { RelationshipField } from "./ownership";

export type OwnershipEventPolicy = {
  profile:
    | "solmate-owned"
    | "oz-ownable"
    | "oz-ownable2step"
    | "chainlink-confirmed-owner"
    | "chainlink-token-admin-registry";
  codeHash: string;
  version: string;
};

export function getOwnershipEventPolicy(
  chainId: number,
  address: string
): OwnershipEventPolicy | undefined {
  const binding = proofs.contracts.find(
    (entry) =>
      entry.chainId === chainId && entry.address === address.toLowerCase()
  );
  const implementation = proofs.implementations.find(
    (entry) => entry.id === binding?.implementation
  );
  return implementation
    ? {
        profile: implementation.profile as OwnershipEventPolicy["profile"],
        codeHash: implementation.codeHash,
        version: implementation.id,
      }
    : undefined;
}

export function policyCoversGetter(
  policy: OwnershipEventPolicy,
  getter: string
): boolean {
  if (getter === "owner") return true;
  if (getter === "pendingOwner") return policy.profile === "oz-ownable2step";
  if (getter === "newOwner")
    return [
      "chainlink-confirmed-owner",
      "chainlink-token-admin-registry",
    ].includes(policy.profile);
  return (
    policy.profile === "chainlink-token-admin-registry" &&
    /^(administrator|newAdministrator|getPool):0x[0-9a-f]{40}$/.test(getter)
  );
}

export function policyCoversEvent(
  policy: OwnershipEventPolicy,
  getter: string,
  event: string
): boolean {
  if (!policyCoversGetter(policy, getter)) return false;
  if (getter === "owner") return event === "OwnershipTransferred";
  if (getter === "pendingOwner")
    return ["OwnershipTransferStarted", "OwnershipTransferred"].includes(event);
  if (getter === "newOwner")
    return ["OwnershipTransferRequested", "OwnershipTransferred"].includes(
      event
    );
  if (getter.startsWith("getPool:")) return event === "PoolSet";
  if (getter.startsWith("newAdministrator:"))
    return [
      "AdministratorTransferRequested",
      "AdministratorTransferred",
    ].includes(event);
  return event === "AdministratorTransferred";
}

/** A source proof is reusable only while its complete event stream is subscribed. */
export function configureOwnershipEventFields(
  chainId: number,
  fields: RelationshipField[],
  subscriptions: {
    Owned: readonly string[];
    ChainlinkOwned: readonly string[];
    TokenAdminRegistry: readonly string[];
  }
): RelationshipField[] {
  return fields.map((field) => {
    const ordinary = { ...field };
    delete ordinary.eventPolicy;
    const policy = getOwnershipEventPolicy(chainId, field.address);
    if (!policy || !policyCoversGetter(policy, field.getter)) return ordinary;
    const required = policy.profile.startsWith("chainlink")
      ? policy.profile === "chainlink-token-admin-registry"
        ? [subscriptions.ChainlinkOwned, subscriptions.TokenAdminRegistry]
        : [subscriptions.ChainlinkOwned]
      : [subscriptions.Owned];
    if (
      !required.every((addresses) =>
        addresses.some(
          (address) => address.toLowerCase() === field.address.toLowerCase()
        )
      )
    )
      return ordinary;
    return {
      ...ordinary,
      ...(field.kind === "contract-reference" &&
      (field.getter === "owner" || field.getter === "pendingOwner")
        ? { kind: "owner" }
        : {}),
      eventPolicy: policy,
      coverage:
        "Source/runtime-verified ownership events maintain this value after its initial canonical getter verification.",
    };
  });
}
