import { mcpRpc } from "./rpc-tools.js";
import { readKeelInlineTokenAudit } from "@keel/sdk";
import type { ToolDefinition } from "./types.js";

export const TOKEN_AUDIT_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {name:"keel-inline-token-audit",
    description:"Read the actual collection tokenURI at a pinned RPC block and measure complete returned bytes, decoded HTML/image, child packed bytes, Base64/hex carriage inflation and document layers. Detect fresh encoded-body regressions. Bounded read-only calls; never signs, publishes or claims browser/registry verification. MIME type does not override ;base64. Use this for a user's actual token, not compressed-size estimates.",
    inputSchema:{type:"object",additionalProperties:false,properties:{
      rpcUrl:{type:"string",minLength:1,maxLength:2048},chainId:{type:"integer",minimum:1},
      collection:{type:"string",pattern:"^0x[0-9a-fA-F]{40}$"},tokenId:{type:"string",pattern:"^(0|[1-9][0-9]*)$",maxLength:78},
      reportPath:{type:"string",minLength:1,maxLength:2048}},required:["chainId","collection","tokenId"]}},
  async run(context,value) {
    if (!value || typeof value!=="object" || Array.isArray(value)) throw new TypeError("Token audit needs an exact target.");
    const input=value as Record<string,unknown>;
    if (Object.keys(input).some(key=>!["rpcUrl","chainId","collection","tokenId","reportPath"].includes(key))
      || input.rpcUrl!==undefined && typeof input.rpcUrl!=="string" || typeof input.chainId!=="number" || typeof input.collection!=="string"
      || typeof input.tokenId!=="string" || input.reportPath!==undefined && typeof input.reportPath!=="string") throw new TypeError("Invalid token audit fields.");
    const rpc = await mcpRpc(context, { ...(input.rpcUrl === undefined ? {} : { rpcUrl: input.rpcUrl as string }), chainId: input.chainId as number });
    const report=await readKeelInlineTokenAudit({rpcUrl:rpc.rpcUrl,chainId:input.chainId as number,collection:input.collection as string,tokenId:input.tokenId as string}, rpc.fetchImpl);
    const reportPath=input.reportPath===undefined ? undefined : await context.workspace.writeJson(input.reportPath as string,report);
    return {...report,...(reportPath===undefined ? {} : {reportPath})};
  },
}];
