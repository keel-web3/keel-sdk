#!/usr/bin/env node
import { runMcpSelfTest } from "./health.js";
import { MCP_SERVER_VERSION } from "./types.js";
import { runConnectionCli } from "./connection-cli.js";
import { STUDIO_CONNECTION_SCOPES, type StudioConnectionScope } from "@keel/sdk/studio-connection-node";
import { runStdio } from "./stdio.js";

const HELP = `Usage: keel-mcp [--workspace <directory> | --workspace=<directory>] [--help | --version | --self-test]

Run the offline MCP JSON-RPC server over stdio (the default).
  --workspace <directory>  Restrict local reads and writes to this directory.
  --plugin <entry>        Load a trusted local KEEL plugin (repeatable).
  --plugin-config <file>  Use a registry instead of ~/.keel/plugins.json.
  --no-plugins            Disable the default registry; explicit --plugin entries still load.
  --connect               Request Studio access; opens your browser, saves the approved key privately.
  --connection-status     Show connection metadata (never the key).
  --import-key            Import an existing key using a hidden terminal prompt.
  --studio-url <origin>   Choose Studio (defaults to https://studio.onkeel.io).
  --window                Open a small browser connection helper. No Desktop app required.
  --no-open               Print approval links without opening a browser.
  --reconnect             Request a new grant, for example to change permissions.
  --scopes <comma-list>   Requested permissions; the user may reduce them in Studio.
  --label <name>          Name shown to the user on the approval page.
  --self-test              Run initialize, ping, tools/list, prompts/list/get, and static resource checks.
  --version, -v            Print the server version and exit.
  --help, -h               Print this help and exit.
`;

type Action = "stdio" | "help" | "version" | "self-test" | "connect" | "connection-status" | "import-key";

interface ParsedArgs {
  readonly action: Action;
  readonly workspace: string;
  readonly plugins: readonly string[];
  readonly pluginConfig?: string | false;
  readonly studioUrl?: string;
  readonly noOpen?: boolean;
  readonly window?: boolean;
  readonly reconnect?: boolean;
  readonly label?: string;
  readonly scopes?: readonly StudioConnectionScope[];
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let action: Action = "stdio";
  let workspace = ".";
  const connection: { studioUrl?: string; noOpen?: boolean; window?: boolean; reconnect?: boolean; label?: string; scopes?: StudioConnectionScope[] } = {};
  let workspaceSeen = false;
  const plugins: string[] = [];
  let pluginConfig: string | false | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) throw new TypeError("Missing command argument.");
    if (argument === "--workspace") {
      if (workspaceSeen) throw new TypeError("--workspace may be provided only once.");
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new TypeError("--workspace requires a directory.");
      workspace = value;
      workspaceSeen = true;
      index += 1;
    } else if (argument.startsWith("--workspace=")) {
      if (workspaceSeen) throw new TypeError("--workspace may be provided only once.");
      const value = argument.slice("--workspace=".length);
      if (value.length === 0) throw new TypeError("--workspace requires a directory.");
      workspace = value;
      workspaceSeen = true;
    } else if (argument === "--plugin") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new TypeError("--plugin requires a local entry path.");
      plugins.push(value);
    } else if (argument === "--plugin-config") {
      const value = args[++index];
      if (!value || value.startsWith("--") || pluginConfig !== undefined) throw new TypeError("--plugin-config requires one registry path.");
      pluginConfig = value;
    } else if (argument === "--no-plugins") {
      if (pluginConfig !== undefined) throw new TypeError("--no-plugins conflicts with --plugin-config.");
      pluginConfig = false;
    } else if (["--connect", "--connection-status", "--import-key"].includes(argument)) {
      action = selectAction(action, argument.slice(2) as "connect" | "connection-status" | "import-key");
    } else if (["--window", "--no-open", "--reconnect"].includes(argument)) {
      if (argument === "--window") connection.window = true;
      if (argument === "--no-open") connection.noOpen = true;
      if (argument === "--reconnect") connection.reconnect = true;
    } else if (["--studio-url", "--label", "--scopes"].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new TypeError(`${argument} requires a value.`);
      if (argument === "--studio-url") connection.studioUrl = value;
      else if (argument === "--label") connection.label = value;
      else {
        const scopes = value.split(",");
        if (!scopes.every(scope => STUDIO_CONNECTION_SCOPES.includes(scope as StudioConnectionScope))) throw new TypeError("Invalid connection permissions.");
        connection.scopes = scopes as StudioConnectionScope[];
      }
    } else if (argument === "--help" || argument === "-h") {
      action = selectAction(action, "help");
    } else if (argument === "--version" || argument === "-v") {
      action = selectAction(action, "version");
    } else if (argument === "--self-test") {
      action = selectAction(action, "self-test");
    } else {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  return { action, workspace, plugins, ...connection, ...(pluginConfig === undefined ? {} : { pluginConfig }) };
}

function selectAction(current: Action, next: Exclude<Action, "stdio">): Action {
  if (current !== "stdio" && current !== next) throw new TypeError("Choose only one CLI action.");
  return next;
}

async function main(args: readonly string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.action === "help") {
    process.stdout.write(HELP);
  } else if (parsed.action === "version") {
    process.stdout.write(`${MCP_SERVER_VERSION}\n`);
  } else if (parsed.action === "self-test") {
    process.stdout.write(`${JSON.stringify(await runMcpSelfTest(parsed.workspace, parsed))}\n`);
  } else if (parsed.action === "connect" || parsed.action === "connection-status" || parsed.action === "import-key") {
    await runConnectionCli({ ...parsed, action: parsed.action });
  } else {
    if (parsed.studioUrl) process.env.KEEL_STUDIO_URL = parsed.studioUrl;
    if (parsed.window || parsed.noOpen || parsed.reconnect || parsed.label || parsed.scopes) throw new TypeError("Connection options require --connect, --connection-status, or --import-key.");
    await runStdio(undefined, undefined, parsed.workspace, parsed);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
