import { Kernel, OlympusRoles, RolesAdmin } from "generated";

Kernel.ActionExecuted.handler(async ({ event }) => {
  console.log(
    `Envio scaffold: Kernel action ${event.params.action_} on ${event.params.target_} at chain ${event.chainId} block ${event.block.number}`
  );
});

OlympusRoles.RoleGranted.handler(async ({ event }) => {
  console.log(
    `Envio scaffold: role granted ${event.params.role_} to ${event.params.addr_} at chain ${event.chainId} block ${event.block.number}`
  );
});

OlympusRoles.RoleRevoked.handler(async ({ event }) => {
  console.log(
    `Envio scaffold: role revoked ${event.params.role_} from ${event.params.addr_} at chain ${event.chainId} block ${event.block.number}`
  );
});

RolesAdmin.NewAdminPulled.handler(async ({ event }) => {
  console.log(
    `Envio scaffold: new roles admin ${event.params.newAdmin_} at chain ${event.chainId} block ${event.block.number}`
  );
});
