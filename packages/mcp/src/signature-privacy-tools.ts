import { keelSignaturePrivacyReadiness } from "@keel/sdk/signature-privacy";
import type { ToolDefinition } from "./types.js";
export const SIGNATURE_PRIVACY_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name: "keel-signature-privacy-readiness",
    description: "Source-profile guidance for EVM Keel typed signatures. Off-chain collection still publishes signature packets at execution. Persistent privacy, verified hash-based signing and enforced fresh addresses are unavailable. This does not inspect a deployed contract, change defaults or sign. Never provide signature packets or confidential notes to this tool.",
    inputSchema: { type: "object", properties: { forceAddressChange: { type: "boolean", default: false }, requirePersistentPrivacy: { type: "boolean", default: false } }, additionalProperties: false },
  },
  async run(_context, input) { return keelSignaturePrivacyReadiness(input); },
}];
