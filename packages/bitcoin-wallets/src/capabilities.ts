export type CapabilityStatus = "supported" | "unsupported" | "untested";
export const wallets = ["xverse", "leather", "unisat", "okx", "magic-eden"] as const;
export const flows = ["connect", "separateRoles", "sharedRoles", "dualRoleBip322", "keyPathPsbt", "nonDefaultSighash", "vaultScriptPath", "genericScriptPath", "events", "mainnet", "testnet3", "testnet4", "signet", "regtest"] as const;
export type Wallet = typeof wallets[number];
export type Flow = typeof flows[number];
type Matrix = Record<Wallet, Record<Flow, CapabilityStatus>>;

// Mocked provider and package-helper evidence; live acceptance is tracked separately.
export const mockedCapabilities: Matrix = {
  xverse: { connect: "supported", separateRoles: "supported", sharedRoles: "unsupported", dualRoleBip322: "supported", keyPathPsbt: "supported", nonDefaultSighash: "unsupported", vaultScriptPath: "unsupported", genericScriptPath: "unsupported", events: "supported", mainnet: "supported", testnet3: "unsupported", testnet4: "unsupported", signet: "supported", regtest: "supported" },
  leather: { connect: "supported", separateRoles: "supported", sharedRoles: "unsupported", dualRoleBip322: "unsupported", keyPathPsbt: "supported", nonDefaultSighash: "unsupported", vaultScriptPath: "unsupported", genericScriptPath: "unsupported", events: "untested", mainnet: "supported", testnet3: "supported", testnet4: "unsupported", signet: "supported", regtest: "unsupported" },
  unisat: { connect: "untested", separateRoles: "unsupported", sharedRoles: "supported", dualRoleBip322: "supported", keyPathPsbt: "supported", nonDefaultSighash: "supported", vaultScriptPath: "supported", genericScriptPath: "unsupported", events: "supported", mainnet: "supported", testnet3: "supported", testnet4: "unsupported", signet: "unsupported", regtest: "unsupported" },
  okx: { connect: "untested", separateRoles: "unsupported", sharedRoles: "supported", dualRoleBip322: "supported", keyPathPsbt: "supported", nonDefaultSighash: "supported", vaultScriptPath: "supported", genericScriptPath: "unsupported", events: "untested", mainnet: "supported", testnet3: "supported", testnet4: "unsupported", signet: "untested", regtest: "unsupported" },
  "magic-eden": { connect: "supported", separateRoles: "supported", sharedRoles: "unsupported", dualRoleBip322: "unsupported", keyPathPsbt: "supported", nonDefaultSighash: "unsupported", vaultScriptPath: "unsupported", genericScriptPath: "unsupported", events: "untested", mainnet: "supported", testnet3: "unsupported", testnet4: "unsupported", signet: "unsupported", regtest: "unsupported" },
};
export const liveCapabilities: Matrix = Object.fromEntries(wallets.map(wallet => [wallet, Object.fromEntries(flows.map(flow => [flow, "untested"]))])) as Matrix;
