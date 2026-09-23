import { createWorkspace } from "./paths.js";
import { getFrayAuctionReviewPrompt, getKeelAssetReviewPrompt, getKeelDraftRepairPrompt, getKeelProjectPlanPrompt, PROMPT_DEFINITIONS } from "./prompts.js";
import { getMcpResource, McpResourceNotFoundError, RESOURCE_DEFINITIONS } from "./resources.js";
import { toolByName, TOOL_DEFINITIONS } from "./tools.js";
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  type JsonRpcError,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpServer,
  type ToolCallResult,
} from "./types.js";

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const fields = new Set(allowed);
  for (const key of Object.keys(value)) if (!fields.has(key)) throw new TypeError(`${label}.${key} is not supported.`);
}

/**
 * Fields we do not know about on a HANDSHAKE, noted and ignored.
 *
 * MCP is a versioned protocol and clients add fields to `initialize` as it grows (`clientInfo.title` and
 * `websiteUrl` arrived that way, and `description` before them). Refusing the whole handshake over one unread field
 * means every such addition takes this server offline until somebody edits an allowlist -- which has already happened
 * once here. The spec's rule is the right one: validate what you understand, ignore the rest. Everything past the
 * handshake stays strict, because a tool call with a field we do not understand is a request we cannot honour.
 */
function ignoreUnknown(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const fields = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !fields.has(key));
  // (stderr, never stdout: stdout is the JSON-RPC stream. The host shows this in its MCP log.)
  if (extra.length) process.stderr.write(`keel-mcp: ignoring unknown ${label} field(s): ${extra.join(", ")}\n`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
}

function parseRequest(value: unknown): JsonRpcRequest {
  const input = object(value, "JSON-RPC request");
  for (const key of Object.keys(input)) if (!["jsonrpc", "id", "method", "params"].includes(key)) throw new TypeError(`JSON-RPC request.${key} is not supported.`);
  if (input.jsonrpc !== "2.0" || typeof input.method !== "string" || input.method.length === 0) throw new TypeError("JSON-RPC request must have jsonrpc 2.0 and a method.");
  if (input.id !== undefined && !validId(input.id)) throw new TypeError("JSON-RPC request.id is invalid.");
  return { jsonrpc: "2.0", ...(input.id === undefined ? {} : { id: input.id }), method: input.method, ...(input.params === undefined ? {} : { params: input.params }) };
}

function response(id: JsonRpcId | undefined, result: unknown): JsonRpcResponse | undefined {
  return id === undefined ? undefined : { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown): JsonRpcResponse | undefined {
  if (id === undefined) return undefined;
  const error: JsonRpcError = { code, message, ...(data === undefined ? {} : { data }) };
  return { jsonrpc: "2.0", id, error };
}

function toolResult(value: unknown): ToolCallResult {
  const text = JSON.stringify(value);
  return { content: [{ type: "text", text }], structuredContent: value };
}

function toolError(error: unknown): ToolCallResult {
  const text = errorText(error);
  return { content: [{ type: "text", text }], isError: true };
}

const MCP_INSTRUCTIONS = [
  "Assume creators are not developers: automatically inventory assets, preserve originals, discover reusable objects and measure storage/compression choices.",
  "Default to separate HTML, CSS, individual JavaScript ES modules and assets; never flatten unless explicitly requested.",
  "For every request phrased as make a contract, put it onchain, make an NFT, publish a viewer, deploy, or release—even when an ABI, address, old journal, or approval is supplied—automatically call keel-contract-workflow-preflight, read the target README/docs, inspect the exact selected chain, and search its module catalog before editing or wallet review. Missing evidence is a hard stop.",
  "Every collector-facing viewer uses the registered canonical KEEL verification shell; never author or replace it.",
  "Collector Inline defaults to raw-percent metadata and HTML. Keep HTML, CSS, JavaScript modules, and assets separate. Prepare the exact supplied image carriage once at build time as data:image/<type>;base64,<payload>, publish one receipt-bound ASCII payload or complete URI, and make the contract/viewer copy header/payload/footer only. Never publish raw image bytes plus a second encoded copy, and never Base64-encode or decode media during tokenURI.",
  "GIF is direct data:image/gif;base64 from the exact high-quality source GIF, never an SVG wrapper, generated substitute, silent resize/re-encode or placeholder. IPFS, HTTP, web3://, resolver matrices and complete-HTML Base64 require an explicit reviewed exception.",
  "Before staging or publishing, unpack every embedded gzip/deflate resource and scan its decoded bytes for concrete http(s), IPFS, Arweave, web3 or keel-onchain locators. A URL sentinel used only for an injected onchain content reader is still an external dependency and must be replaced with a path/identifier. Allow only the SVG namespace literal http://www.w3.org/2000/svg; fail closed on any other locator.",
  "For a new KEEL work, begin with keel-project-plan. For an existing graph, derive revision intent, reuse every unchanged selected-chain object and publish only declared changes; the automatic revision path permits one declared changed resource. Keep local, browser, receipt and live-chain evidence separate. Tools do not sign, submit, claim faucet funds or silently change storage.",
].join(" ");

function emptyParams(value: unknown, label: string): void {
  const params = object(value === undefined ? {} : value, label);
  exactKeys(params, ["_meta"], label);
  if (params._meta !== undefined) object(params._meta, `${label}._meta`);
}

function initializeParams(value: unknown): void {
  const params = object(value, "initialize params");
  ignoreUnknown(params, ["protocolVersion", "capabilities", "clientInfo", "_meta"], "initialize params");
  if (typeof params.protocolVersion !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(params.protocolVersion)) {
    throw new TypeError("initialize params.protocolVersion must be a dated MCP protocol version.");
  }
  object(params.capabilities, "initialize params.capabilities");
  if (params._meta !== undefined) object(params._meta, "initialize params._meta");
  const clientInfo = object(params.clientInfo, "initialize params.clientInfo");
  ignoreUnknown(clientInfo, ["name", "version", "title", "description", "websiteUrl"], "initialize params.clientInfo");
  if (clientInfo.title !== undefined && (typeof clientInfo.title !== "string" || clientInfo.title.length > 256)) throw new TypeError("initialize clientInfo.title must be bounded text.");
  if (typeof clientInfo.name !== "string" || clientInfo.name.length === 0 || typeof clientInfo.version !== "string" || clientInfo.version.length === 0) {
    throw new TypeError("initialize params.clientInfo requires name and version strings.");
  }
}

export async function createMcpServer(options: { readonly workspaceRoot?: string } = {}): Promise<McpServer> {
  const workspace = await createWorkspace(options.workspaceRoot ?? ".");
  let initialized = false;
  let stopped = false;
  return {
    async handle(message: unknown): Promise<JsonRpcResponse | undefined> {
      let request: JsonRpcRequest;
      try {
        request = parseRequest(message);
      } catch (error) {
        return { jsonrpc: "2.0", id: null, error: { code: -32600, message: errorText(error) } };
      }
      if (request.method === "notifications/initialized" || request.method === "$/cancelRequest") return undefined;
      if (["initialize", "shutdown", "ping", "tools/list", "tools/call", "prompts/list", "prompts/get", "resources/list", "resources/read"].includes(request.method) && request.id === undefined) {
        return { jsonrpc: "2.0", id: null, error: { code: -32600, message: `${request.method} requires a request id.` } };
      }
      if (request.method === "ping") {
        try {
          emptyParams(request.params, "ping params");
        } catch (error) {
          return rpcError(request.id, -32602, errorText(error));
        }
        return response(request.id, {});
      }
      if (request.method === "initialize") {
        if (stopped) return rpcError(request.id, -32000, "MCP server is stopped.");
        try {
          initializeParams(request.params);
        } catch (error) {
          return rpcError(request.id, -32602, errorText(error));
        }
        initialized = true;
        return response(request.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
          serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
          instructions: MCP_INSTRUCTIONS,
        });
      }
      if (stopped) return rpcError(request.id, -32000, "MCP server is stopped.");
      if (!initialized) return rpcError(request.id, -32002, "Call initialize before using MCP tools.");
      if (request.method === "shutdown") {
        try {
          emptyParams(request.params, "shutdown params");
        } catch (error) {
          return rpcError(request.id, -32602, errorText(error));
        }
        stopped = true;
        return response(request.id, null);
      }
      if (request.method === "tools/list") {
        try {
          const params = object(request.params === undefined ? {} : request.params, "tools/list params");
          exactKeys(params, ["cursor", "_meta"], "tools/list params");
          if (params.cursor !== undefined && (typeof params.cursor !== "string" || params.cursor.length > 256)) throw new TypeError("tools/list params.cursor is invalid.");
          if (params._meta !== undefined) object(params._meta, "tools/list params._meta");
        } catch (error) {
          return rpcError(request.id, -32602, errorText(error));
        }
        return response(request.id, { tools: TOOL_DEFINITIONS.map((entry) => entry.descriptor) });
      }
      if (request.method === "tools/call") {
        let params: Record<string, unknown>;
        try {
          params = object(request.params === undefined ? {} : request.params, "tools/call params");
          exactKeys(params, ["name", "arguments", "_meta"], "tools/call params");
          if (params.arguments !== undefined) object(params.arguments, "tools/call params.arguments");
          if (params._meta !== undefined) object(params._meta, "tools/call params._meta");
        } catch (error) {
          return rpcError(request.id, -32602, errorText(error));
        }
        if (typeof params.name !== "string" || params.name.length === 0) return rpcError(request.id, -32602, "tools/call requires a tool name.");
        const tool = toolByName(params.name);
        if (tool === undefined) return response(request.id, toolError(new Error(`Unknown MCP tool: ${params.name}.`)));
        try {
          const result = await tool.run({ workspace }, params.arguments ?? {});
          return response(request.id, toolResult(result));
        } catch (error) {
          return response(request.id, toolError(error));
        }
      }
      if (request.method === "prompts/list") {
        try {
          const params = object(request.params === undefined ? {} : request.params, "prompts/list params");
          exactKeys(params, ["cursor", "_meta"], "prompts/list params");
          if (params.cursor !== undefined && (typeof params.cursor !== "string" || params.cursor.length > 256)) throw new TypeError("prompts/list params.cursor is invalid.");
          if (params._meta !== undefined) object(params._meta, "prompts/list params._meta");
        } catch (error) {
          return rpcError(request.id, -32602, errorText(error));
        }
        return response(request.id, { prompts: PROMPT_DEFINITIONS });
      }
      if (request.method === "prompts/get") {
        try {
          const params = object(request.params === undefined ? {} : request.params, "prompts/get params");
          exactKeys(params, ["name", "arguments", "_meta"], "prompts/get params");
          if (params.arguments !== undefined) object(params.arguments, "prompts/get params.arguments");
          if (params._meta !== undefined) object(params._meta, "prompts/get params._meta");
          if (typeof params.name !== "string" || params.name.length === 0 || params.name.length > 128) throw new TypeError("prompts/get params.name is invalid.");
          return response(request.id,
            params.name === "keel-project-plan"
              ? getKeelProjectPlanPrompt(params.name, params.arguments)
              : params.name === "fray-auction-review"
              ? getFrayAuctionReviewPrompt(params.name, params.arguments)
              : params.name === "keel-draft-repair"
                ? getKeelDraftRepairPrompt(params.name, params.arguments)
                : getKeelAssetReviewPrompt(params.name, params.arguments));
        } catch (error) {
          return rpcError(request.id, -32602, errorText(error));
        }
      }
      if (request.method === "resources/list") {
        try {
          const params = object(request.params === undefined ? {} : request.params, "resources/list params");
          exactKeys(params, ["cursor", "_meta"], "resources/list params");
          if (params.cursor !== undefined && (typeof params.cursor !== "string" || params.cursor.length > 256)) throw new TypeError("resources/list params.cursor is invalid.");
          if (params._meta !== undefined) object(params._meta, "resources/list params._meta");
        } catch (error) {
          return rpcError(request.id, -32602, errorText(error));
        }
        return response(request.id, { resources: RESOURCE_DEFINITIONS });
      }
      if (request.method === "resources/read") {
        try {
          const params = object(request.params === undefined ? {} : request.params, "resources/read params");
          exactKeys(params, ["uri", "_meta"], "resources/read params");
          if (params._meta !== undefined) object(params._meta, "resources/read params._meta");
          return response(request.id, getMcpResource(params.uri));
        } catch (error) {
          if (error instanceof McpResourceNotFoundError) return rpcError(request.id, -32002, error.message);
          return rpcError(request.id, -32602, errorText(error));
        }
      }
      return rpcError(request.id, -32601, `Method not found: ${request.method}.`);
    },
  };
}
