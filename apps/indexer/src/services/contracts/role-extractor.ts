// import { Abi, AbiFunction, AbiParameter, keccak256, toBytes } from 'viem';
// import { RoleDefinition } from './types';

// const ROLE_PATTERNS = {
//   // Standard role patterns
//   STANDARD: [
//     /^(ROLE_[A-Z][A-Z0-9_]*)/,
//     /^([A-Z][A-Z0-9_]*_ROLE)$/,
//   ],
//   // OpenZeppelin style roles
//   OPENZEPPELIN: [
//     /^(DEFAULT_ADMIN_ROLE)$/,
//     /^(MINTER_ROLE)$/,
//     /^(PAUSER_ROLE)$/,
//     /^(UPGRADER_ROLE)$/,
//   ],
//   // Function-based role patterns
//   FUNCTION: [
//     /@onlyRole\((.*?)\)/,
//     /@notice\s+Requires\s+([A-Z_]+_ROLE)/,
//     /@dev\s+Requires\s+([A-Z_]+_ROLE)/,
//   ],
//   // Event-based role patterns
//   EVENT: [
//     /RoleGranted\((bytes32\s+indexed\s+role)/,
//     /RoleRevoked\((bytes32\s+indexed\s+role)/,
//   ]
// };

// // TODO simplify to checking onlyRole modifier

// const ROLE_RELATED_FUNCTIONS = [
//   'hasRole',
//   'grantRole',
//   'revokeRole',
//   'getRoleAdmin',
//   'renounceRole',
// ];

// export class RoleExtractor {
//   private roles: Map<string, RoleDefinition>;

//   constructor() {
//     this.roles = new Map();
//   }

//   extractRoles(abi: Abi): RoleDefinition[] {
//     this.roles.clear();

//     // // First pass: Extract explicit role constants
//     // this.extractRoleConstants(abi);

//     // // Second pass: Extract roles from functions
//     // this.extractRolesFromFunctions(abi);

//     // // Third pass: Extract roles from events
//     // this.extractRolesFromEvents(abi);

//     return Array.from(this.roles.values());
//   }

//   private extractRoleConstants(abi: Abi): void {
//     for (const item of abi) {
//       if (
//         item.type === 'function' &&
//         item.constant === true &&
//         item.outputs?.length === 1 &&
//         item.outputs[0]?.type === 'bytes32'
//       ) {
//         const name = item.name;

//         // Check against all standard role patterns
//         for (const pattern of [...ROLE_PATTERNS.STANDARD, ...ROLE_PATTERNS.OPENZEPPELIN]) {
//           if (pattern.test(name)) {
//             this.addRole(name);
//             break;
//           }
//         }
//       }
//     }
//   }

//   private extractRolesFromFunctions(abi: Abi): void {
//     for (const item of abi) {
//       if (item.type !== 'function') continue;

//       // Check if this is a role-related function
//       if (ROLE_RELATED_FUNCTIONS.includes(item.name)) {
//         this.extractRolesFromRoleFunction(item);
//       }

//       // Check function modifiers and NatSpec
//       this.extractRolesFromModifiers(item);
//       this.extractRolesFromNatSpec(item);
//     }
//   }

//   // private extractRolesFromRoleFunction(func: AbiFunction): void {
//   //   const roleParam = func.inputs?.find(
//   //     (input: AbiParameter) => input.name === 'role' && input.type === 'bytes32'
//   //   );

//   //   if (roleParam) {
//   //     // Look for role name hints in NatSpec
//   //     const natspec = func.notice || func.details;
//   //     if (natspec) {
//   //       for (const pattern of ROLE_PATTERNS.FUNCTION) {
//   //         const match = pattern.exec(natspec);
//   //         if (match?.[1]) {
//   //           this.addRole(match[1]);
//   //         }
//   //       }
//   //     }
//   //   }
//   // }

//   private extractRolesFromModifiers(func: any): void {
//     const modifiers = func.modifiers || [];
//     for (const modifier of modifiers) {
//       if (modifier.name === 'onlyRole') {
//         const roleArg = modifier.arguments?.[0];
//         if (typeof roleArg === 'string') {
//           this.addRole(roleArg);
//         }
//       }
//     }
//   }

//   private extractRolesFromNatSpec(func: any): void {
//     const natspec = func.notice || func.details;
//     if (!natspec) return;

//     for (const pattern of ROLE_PATTERNS.FUNCTION) {
//       const matches = Array.from(natspec.matchAll(pattern));
//       for (const match of matches) {
//         // if (match[1]) {
//         //   this.addRole(match[1]);
//         // }
//       }
//     }
//   }

//   private extractRolesFromEvents(abi: Abi): void {
//     for (const item of abi) {
//       if (item.type !== 'event') continue;

//       // Check for role-related events
//       if (
//         item.name === 'RoleGranted' ||
//         item.name === 'RoleRevoked' ||
//         item.name === 'RoleAdminChanged'
//       ) {
//         const roleParam = item.inputs?.find(
//           (input: any) => input.name === 'role' && input.type === 'bytes32'
//         );

//         if (roleParam?.indexed) {
//           // This is a role-related event, check for known role hashes
//           this.addUnknownRole(roleParam.name);
//         }
//       }
//     }
//   }

//   private addRole(name: string, description?: string): void {
//     const hash = keccak256(toBytes(name));
//     if (!this.roles.has(hash)) {
//       this.roles.set(hash, { name, hash, description });
//     }
//   }

//   private addUnknownRole(hint: string): void {
//     const name = `UNKNOWN_ROLE_${hint.toUpperCase()}`;
//     this.addRole(name);
//   }
// }
