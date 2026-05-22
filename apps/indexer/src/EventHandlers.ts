import { indexer } from "envio";

import { handleKernelActionExecuted } from "./events/kernel";
import {
  handleNewAdminPulled,
  handleRoleGranted,
  handleRoleRevoked,
} from "./events/roles";
import type {
  EnvioContext,
  KernelActionExecutedEvent,
  NewAdminPulledEvent,
  RoleGrantedEvent,
  RoleRevokedEvent,
} from "./events/types";

indexer.onEvent(
  {
    contract: "Kernel",
    event: "ActionExecuted",
  },
  async ({ event, context }) => {
    await handleKernelActionExecuted(
      event as unknown as KernelActionExecutedEvent,
      context as EnvioContext
    );
  }
);

indexer.onEvent(
  {
    contract: "OlympusRoles",
    event: "RoleGranted",
  },
  ({ event, context }) =>
    handleRoleGranted(
      event as unknown as RoleGrantedEvent,
      context as EnvioContext
    )
);

indexer.onEvent(
  {
    contract: "OlympusRoles",
    event: "RoleRevoked",
  },
  async ({ event, context }) => {
    await handleRoleRevoked(
      event as unknown as RoleRevokedEvent,
      context as EnvioContext
    );
  }
);

indexer.onEvent(
  {
    contract: "RolesAdmin",
    event: "NewAdminPulled",
  },
  async ({ event, context }) => {
    await handleNewAdminPulled(
      event as unknown as NewAdminPulledEvent,
      context as EnvioContext
    );
  }
);
