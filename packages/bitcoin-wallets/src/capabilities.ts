export type CapabilityStatus = "supported" | "unsupported" | "untested";
export const wallets = ["xverse", "leather", "unisat", "okx", "magic-eden"] as const;
export const flows = ["connect", "separateRoles", "sharedRoles", "dualRoleBip322", "keyPathPsbt", "nonDefaultSighash", "vaultScriptPath", "genericScriptPath", "events", "mainnet", "testnet3", "testnet4", "signet", "regtest"] as const;
export type Wallet = typeof wallets[number];
export type Flow = typeof flows[number];
type Matrix = Record<Wallet, Record<Flow, CapabilityStatus>>;

// API-level evidence only. Pending T07 signing work is not yet integrated.
export const mockedCapabilities: Matrix = {
  xverse: { connect: "supported", separateRoles: "supported", sharedRoles: "unsupported", dualRoleBip322: "supported", keyPathPsbt: "untested", nonDefaultSighash: "untested", vaultScriptPath: "unsupported", genericScriptPath: "unsupported", events: "supported", mainnet: "supported", testnet3: "unsupported", testnet4: "unsupported", signet: "supported", regtest: "supported" },
  leather: { connect: "supported", separateRoles: "supported", sharedRoles: "unsupported", dualRoleBip322: "unsupported", keyPathPsbt: "untested", nonDefaultSighash: "unsupported", vaultScriptPath: "unsupported", genericScriptPath: "unsupported", events: "untested", mainnet: "supported", testnet3: "supported", testnet4: "unsupported", signet: "supported", regtest: "unsupported" },
  unisat: { connect: "untested", separateRoles: "unsupported", sharedRoles: "supported", dualRoleBip322: "supported", keyPathPsbt: "untested", nonDefaultSighash: "untested", vaultScriptPath: "untested", genericScriptPath: "unsupported", events: "supported", mainnet: "untested", testnet3: "untested", testnet4: "untested", signet: "untested", regtest: "untested" },
  okx: { connect: "untested", separateRoles: "unsupported", sharedRoles: "supported", dualRoleBip322: "supported", keyPathPsbt: "untested", nonDefaultSighash: "untested", vaultScriptPath: "untested", genericScriptPath: "unsupported", events: "untested", mainnet: "untested", testnet3: "untested", testnet4: "untested", signet: "untested", regtest: "untested" },
  "magic-eden": { connect: "supported", separateRoles: "supported", sharedRoles: "unsupported", dualRoleBip322: "unsupported", keyPathPsbt: "untested", nonDefaultSighash: "unsupported", vaultScriptPath: "unsupported", genericScriptPath: "unsupported", events: "untested", mainnet: "supported", testnet3: "unsupported", testnet4: "unsupported", signet: "unsupported", regtest: "unsupported" },
};
export const liveCapabilities: Matrix = Object.fromEntries(wallets.map(wallet => [wallet, Object.fromEntries(flows.map(flow => [flow, "untested"]))])) as Matrix;
