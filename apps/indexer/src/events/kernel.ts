import { getContractVersion } from "../ContractNames";
import {
  actionExecutedEventId,
  contractEventId,
  contractId,
  kernelExecutorEventId,
  kernelExecutorId,
} from "./ids";
import type {
  ContractEntity,
  EnvioContext,
  KernelActionExecutedEvent,
} from "./types";
import { getKernelExecutor } from "./effects";
import { getPreviousModule, setCurrentModule } from "./modules";
import {
  parseAction,
  parseContractName,
  parseContractType,
  parseIsEnabled,
  parsePolicyFunctions,
  parsePolicyPermissions,
} from "./contractParsing";
import { ensureKernelSeeded } from "./seeding";

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

  envioContext.ActionExecutedEvent.set({
    id: actionExecutedEventId(
      chainId,
      event.srcAddress,
      event.transaction.hash,
      event.logIndex
    ),
    chainId,
    kernel: event.srcAddress,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    timestamp,
    blockNumber,
    action,
    target,
  });

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

      envioContext.ContractEvent.set({
        id: contractEventId(
          chainId,
          event.transaction.hash,
          event.logIndex,
          action,
          previousContract.address
        ),
        chainId,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
        action,
        address: previousContract.address,
        timestamp,
        blockNumber,
        name: previousContract.name,
        version: previousContract.version,
        contractType: previousContract.contractType,
        isEnabled: false,
        policyPermissions: previousContract.policyPermissions,
        policyFunctions: previousContract.policyFunctions,
      });

      envioContext.Contract.set({
        ...previousContract,
        isEnabled: false,
        lastUpdatedTimestamp: timestamp,
        lastUpdatedBlockNumber: blockNumber,
      });
    }

    const isEnabled = parseIsEnabled(actionInt);
    envioContext.ContractEvent.set({
      id: contractEventId(
        chainId,
        event.transaction.hash,
        event.logIndex,
        action,
        target
      ),
      chainId,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      action,
      address: target,
      timestamp,
      blockNumber,
      name: contractName,
      version: contractVersion,
      contractType,
      isEnabled,
      policyPermissions,
      policyFunctions,
    });

    envioContext.Contract.set({
      ...(existingContract ?? {
        id: contractId(chainId, target),
        chainId,
        address: target,
        name: contractName,
        version: contractVersion,
        contractType,
      }),
      lastUpdatedTimestamp: timestamp,
      lastUpdatedBlockNumber: blockNumber,
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
    const executor = await getKernelExecutor(
      envioContext,
      event.srcAddress,
      chainId,
      blockNumber
    );

    envioContext.KernelExecutor.set({
      id: kernelExecutorId(chainId, event.srcAddress),
      chainId,
      kernel: event.srcAddress,
      lastUpdatedTimestamp: timestamp,
      lastUpdatedBlockNumber: blockNumber,
      executor,
    });

    envioContext.KernelExecutorEvent.set({
      id: kernelExecutorEventId(
        chainId,
        event.srcAddress,
        event.transaction.hash,
        event.logIndex
      ),
      chainId,
      kernel: event.srcAddress,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      timestamp,
      blockNumber,
      executor,
    });
  }
}
