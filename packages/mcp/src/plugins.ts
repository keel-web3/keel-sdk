import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolDefinition } from "./types.js";

export interface McpPlugin {
  readonly apiVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly instructions?: string;
  readonly tools: readonly ToolDefinition[];
}
export interface McpPluginOptions {
  /** Explicit local entry files. Plugins execute trusted local code. Never inferred from project files. */
  readonly plugins?: readonly string[];
  /** Defaults to KEEL_MCP_PLUGIN_CONFIG or ~/.keel/plugins.json. false disables the registry. */
  readonly pluginConfig?: string | false;
}
export interface LoadedMcpPlugin extends McpPlugin { readonly entry: string }

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
export function validateMcpPlugin(value: unknown): McpPlugin {
  const plugin = record(value, "keelPlugin");
  if (plugin.apiVersion !== 1) throw new TypeError("Unsupported KEEL plugin API version.");
  if (typeof plugin.id !== "string" || !/^[a-z0-9][a-z0-9./-]{0,127}$/u.test(plugin.id)) throw new TypeError("Invalid KEEL plugin id.");
  if (typeof plugin.version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u.test(plugin.version)) throw new TypeError("Invalid KEEL plugin version.");
  if (plugin.instructions !== undefined && (typeof plugin.instructions !== "string" || plugin.instructions.length > 32768)) throw new TypeError("Invalid plugin instructions.");
  if (!Array.isArray(plugin.tools) || plugin.tools.length > 128) throw new TypeError("Plugin tools must be a bounded array.");
  for (const value of plugin.tools) {
    const tool = record(value, "plugin tool"), descriptor = record(tool.descriptor, "plugin tool descriptor");
    if (typeof descriptor.name !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(descriptor.name)) throw new TypeError("Invalid plugin tool name.");
    if (typeof descriptor.description !== "string" || !descriptor.description.length) throw new TypeError("Plugin tool needs a description.");
    if (record(descriptor.inputSchema, "plugin input schema").type !== "object") throw new TypeError("Plugin tool input schema must have type object.");
    if (typeof tool.run !== "function") throw new TypeError("Plugin tool needs a run function.");
  }
  return value as McpPlugin;
}

export async function loadMcpPlugins(options: McpPluginOptions = {}, core: readonly ToolDefinition[] = []): Promise<readonly LoadedMcpPlugin[]> {
  const entries: { entry: string; id?: string }[] = [];
  if (options.pluginConfig !== false) {
    const configPath = resolve(options.pluginConfig ?? process.env.KEEL_MCP_PLUGIN_CONFIG ?? join(homedir(), ".keel", "plugins.json"));
    let bytes: Buffer | undefined;
    try { bytes = await readFile(configPath); } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT" || options.pluginConfig !== undefined || process.env.KEEL_MCP_PLUGIN_CONFIG) throw error;
    }
    if (bytes !== undefined) {
      if (bytes.length > 65536) throw new RangeError("KEEL plugin registry exceeds 64 KiB.");
      const config = record(JSON.parse(bytes.toString("utf8")), "KEEL plugin registry");
      if (config.schema !== "keel-plugins@1" || !Array.isArray(config.plugins) || config.plugins.length > 64) throw new TypeError("Invalid KEEL plugin registry.");
      for (const value of config.plugins) {
        const item = record(value, "plugin registry item");
        if (item.enabled !== undefined && typeof item.enabled !== "boolean") throw new TypeError("Plugin enabled must be boolean.");
        if (typeof item.id !== "string" || typeof item.entry !== "string" || !isAbsolute(item.entry)) throw new TypeError("Registry plugin needs id and an absolute local entry.");
        if (item.enabled !== false) entries.push({ id: item.id, entry: item.entry });
      }
    }
  }
  for (const entry of options.plugins ?? []) {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(entry)) throw new TypeError("Plugins must be local file paths, not URLs.");
    entries.push({ entry: resolve(entry) });
  }
  const loaded: LoadedMcpPlugin[] = [], paths = new Set<string>(), ids = new Set<string>();
  const names = new Set(core.map(tool => tool.descriptor.name));
  for (const item of entries) {
    const entry = await realpath(item.entry);
    if (paths.has(entry)) continue;
    const module = await import(pathToFileURL(entry).href) as { keelPlugin?: unknown };
    const plugin = validateMcpPlugin(module.keelPlugin);
    if (item.id !== undefined && item.id !== plugin.id) throw new TypeError(`Plugin identity mismatch: ${item.id} vs ${plugin.id}.`);
    if (ids.has(plugin.id)) throw new TypeError(`Duplicate KEEL plugin id: ${plugin.id}.`);
    for (const tool of plugin.tools) {
      if (names.has(tool.descriptor.name)) throw new TypeError(`Duplicate MCP tool: ${tool.descriptor.name}.`);
      names.add(tool.descriptor.name);
    }
    loaded.push({ ...plugin, entry }); paths.add(entry); ids.add(plugin.id);
  }
  return loaded;
}
