import type { JsonSchema, McpTool } from "./types.js";

/**
 * What an MCP client will accept in `tools/list`.
 *
 * Clients validate the WHOLE list response against the spec before showing any tool. The official TypeScript
 * client (used by Claude Desktop and most hosts) parses `inputSchema` with `type: z.literal("object")`, so one tool
 * whose schema is a bare top-level `oneOf` fails the parse and the host shows zero tools while reporting the server
 * as connected. The Anthropic API separately rejects `oneOf`/`anyOf`/`allOf` at the top of `input_schema`.
 *
 * This check is run by the self-test and the test suite so a schema that would blank the tool list never ships.
 */
const JSON_TYPES = new Set(["object", "string", "number", "integer", "boolean", "array", "null"]);
const KNOWN_KEYWORDS = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum", "oneOf", "anyOf",
  "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "description", "pattern", "const", "default",
]);
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/u;

function schemaIssues(schema: unknown, at: string, issues: string[], depth = 0): void {
  if (depth > 32) {
    issues.push(`${at}: schema nesting exceeds 32 levels`);
    return;
  }
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    issues.push(`${at}: schema must be an object`);
    return;
  }
  const value = schema as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!KNOWN_KEYWORDS.has(key)) issues.push(`${at}: unknown JSON Schema keyword "${key}"`);
  if (value.type !== undefined && (typeof value.type !== "string" || !JSON_TYPES.has(value.type))) issues.push(`${at}: invalid type ${JSON.stringify(value.type)}`);
  if (value.properties !== undefined) {
    if (value.properties === null || typeof value.properties !== "object" || Array.isArray(value.properties)) issues.push(`${at}.properties must be an object`);
    else for (const [key, child] of Object.entries(value.properties)) schemaIssues(child, `${at}.properties.${key}`, issues, depth + 1);
  }
  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.some((entry) => typeof entry !== "string")) issues.push(`${at}.required must be a list of names`);
    else {
      if (new Set(value.required).size !== value.required.length) issues.push(`${at}.required has duplicates`);
      const declared = value.properties !== null && typeof value.properties === "object" ? Object.keys(value.properties as object) : [];
      for (const name of value.required as string[]) if (!declared.includes(name)) issues.push(`${at}.required names undeclared property "${name}"`);
    }
  }
  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== "boolean") schemaIssues(value.additionalProperties, `${at}.additionalProperties`, issues, depth + 1);
  if (value.items !== undefined) schemaIssues(value.items, `${at}.items`, issues, depth + 1);
  for (const key of ["oneOf", "anyOf"] as const) {
    const list = value[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length === 0) issues.push(`${at}.${key} must be a non-empty list`);
    else list.forEach((child, index) => schemaIssues(child, `${at}.${key}[${index}]`, issues, depth + 1));
  }
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0)) issues.push(`${at}.enum must be a non-empty list`);
  for (const key of ["minItems", "maxItems", "minLength", "maxLength"] as const) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)) issues.push(`${at}.${key} must be a non-negative integer`);
  }
  if (value.description !== undefined && typeof value.description !== "string") issues.push(`${at}.description must be text`);
}

/** Every reason a client could reject this descriptor. Empty means it is safe to list. */
export function mcpToolDescriptorIssues(tool: McpTool): readonly string[] {
  const issues: string[] = [];
  const at = `tool ${JSON.stringify(tool?.name)}`;
  if (typeof tool?.name !== "string" || !TOOL_NAME.test(tool.name)) issues.push(`${at}: name must match ${TOOL_NAME.source}`);
  if (typeof tool?.description !== "string" || tool.description.length === 0) issues.push(`${at}: description must be non-empty text`);
  const schema = tool?.inputSchema as JsonSchema | undefined;
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    issues.push(`${at}: inputSchema must be an object`);
    return issues;
  }
  if (schema.type !== "object") issues.push(`${at}: inputSchema.type must be "object" (MCP clients reject the whole tools/list otherwise)`);
  for (const key of ["oneOf", "anyOf", "allOf", "enum", "not"]) {
    if ((schema as Record<string, unknown>)[key] !== undefined) issues.push(`${at}: inputSchema cannot use top-level ${key}`);
  }
  schemaIssues(schema, `${at}.inputSchema`, issues);
  return issues;
}

export function mcpToolListIssues(tools: readonly McpTool[]): readonly string[] {
  const issues = tools.flatMap((tool) => mcpToolDescriptorIssues(tool));
  const names = tools.map((tool) => tool.name);
  for (const name of new Set(names)) if (names.filter((entry) => entry === name).length > 1) issues.push(`duplicate tool name ${name}`);
  return issues;
}
