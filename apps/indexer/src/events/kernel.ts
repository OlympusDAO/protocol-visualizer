import { getContractVersion } from "../ContractNames";
import {
  parseAction,
  parseContractName,
  parseContractType,
  parseIsEnabled,
  parsePolicyFunctions,
  parsePolicyPermissions,
} from "./contractParsing";
import { contractId, kernelExecutorId } from "./ids";
import { getPreviousModule, setCurrentModule } from "./modules";
import { ensureKernelSeeded } from "./seeding";
import type {
  ContractEntity,
  EnvioContext,
  KernelActionExecutedEvent,
} from "./types";

export async function handleKernelActionExecuted(
  event: KernelActionExecutedEvent,
  context: EnvioContext
): Promise<void> {
  const envioContext = context;
  const chainId = event.chainId;
  await ensureKernelSeeded(envioContext, chainId);

  const actionInt = Number(event.params.action_);
  const target = event.params.target_;
  const timestamp = BigInt(event.block.timestamp);
  const blockNumber = BigInt(event.block.number);
  const action = parseAction(actionInt);
  const contractType = parseContractType(actionInt);
  const contractName = await parseContractName(
    actionInt,
    target,
    chainId,
    blockNumber,
    envioContext
  );
  const contractVersion = getContractVersion(target, chainId) ?? undefined;
  const previousContract =
    action === "upgradeModule"
      ? await getPreviousModule(contractName, chainId, envioContext)
      : undefined;

  console.log(
    `Chain ${chainId}: Processing action ${action} on target ${target} at block ${event.block.number}`
  );

  if (contractType !== "KERNEL") {
    const [policyPermissions, policyFunctions, existingContract] =
      await Promise.all([
        parsePolicyPermissions(
          actionInt,
          event.srcAddress,
          target,
          contractName,
          blockNumber,
          chainId,
          envioContext
        ),
        parsePolicyFunctions(
          actionInt,
          target,
          contractName,
          blockNumber,
          chainId,
          envioContext
        ),
        envioContext.Contract.get<ContractEntity>(contractId(chainId, target)),
      ]);

    if (action === "upgradeModule") {
      if (!previousContract) {
        throw new Error(
          `No previous contract found for keycode ${contractName}`
        );
      }

      envioContext.Contract.set({
        ...previousContract,
        kernelHistory: "installed",
        isEnabled: false,
        lastUpdatedTimestamp: timestamp,
        lastUpdatedBlockNumber: blockNumber,
      });
    }

    const isEnabled = parseIsEnabled(actionInt);

    envioContext.Contract.set({
      ...(existingContract ?? {
        id: contractId(chainId, target),
        address: target,
        name: contractName,
        version: contractVersion,
        contractType,
      }),
      lastUpdatedTimestamp: timestamp,
      lastUpdatedBlockNumber: blockNumber,
      kernelHistory: "installed",
      isEnabled,
      policyPermissions,
      policyFunctions,
    });

    if (contractType === "MODULE" && isEnabled) {
      setCurrentModule(
        envioContext,
        chainId,
        contractName,
        target,
        timestamp,
        blockNumber
      );
    }
  }

  if (action === "changeExecutor") {
    const executor = target;

    envioContext.KernelExecutor.set({
      id: kernelExecutorId(chainId, event.srcAddress),
      kernel: event.srcAddress,
      lastUpdatedTimestamp: timestamp,
      lastUpdatedBlockNumber: blockNumber,
      executor,
    });
  }
}
