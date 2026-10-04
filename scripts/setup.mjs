#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseSetup(args) {
  const options = { workspace: join(sdkRoot, '.keel-workspace'), desktop: true, engine: true, connectOnly: false, editorConnection: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--workspace' && args[i + 1] && !args[i + 1].startsWith('--')) options.workspace = resolve(args[++i]);
    else if (arg === '--editor-connection' && args[i + 1] && !args[i + 1].startsWith('--')) options.editorConnection = resolve(args[++i]);
    else if (arg === '--skip-desktop') options.desktop = false;
    else if (arg === '--skip-engine') options.engine = false;
    else if (arg === '--connect-only') options.connectOnly = true;
    else throw Error(`Unknown or incomplete option: ${arg}`);
  }
  return options;
}

// Existing agent configuration and skill customizations always win. A separately
// generated connection file lets users merge settings without losing their own.
export function connectWorkspace(workspace, root = sdkRoot, editorConnection) {
  mkdirSync(workspace, { recursive: true });
  const savedConnection = join(workspace, '.keel/mcp.json');
  if (!editorConnection && existsSync(savedConnection)) {
    try { editorConnection = JSON.parse(readFileSync(savedConnection, 'utf8')).mcpServers?.keel?.env?.KEEL_EDITOR_CONNECTION; } catch { /* Preserve customized settings below. */ }
  }
  const readme = join(workspace, 'README.md');
  if (!existsSync(readme)) writeFileSync(readme, '# KEEL artwork workspace\n\nAdd your original generator code here. Ask the KEEL agent to inspect it,\npreserve originals, and plan a modular conversion before publishing.\nSelect local Anvil or Sepolia explicitly. No publication has occurred.\n', { flag: 'wx' });
  const presentation = join(workspace, 'docs/KEEL_PRESENTATION.md');
  if (!existsSync(presentation)) {
    mkdirSync(dirname(presentation), { recursive: true });
    cpSync(join(root, 'docs/KEEL_PRESENTATION.md'), presentation, { errorOnExist: true, force: false });
  }
  const args = [join(root, 'packages/mcp/dist/cli.js'), '--workspace', workspace];
  const server = { command: process.execPath, args, ...(editorConnection ? { env: { KEEL_EDITOR_CONNECTION: editorConnection } } : {}) };
  const output = join(workspace, '.keel');
  mkdirSync(output, { recursive: true });
  const toml = `[mcp_servers.keel]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(args)}\n${editorConnection ? `env = { KEEL_EDITOR_CONNECTION = ${JSON.stringify(editorConnection)} }\n` : ''}`;
  const json = `${JSON.stringify({ mcpServers: { keel: server } }, null, 2)}\n`;
  const priorToml = existsSync(join(output, 'codex.toml')) ? readFileSync(join(output, 'codex.toml'), 'utf8') : undefined;
  const priorJson = existsSync(join(output, 'mcp.json')) ? readFileSync(join(output, 'mcp.json'), 'utf8') : undefined;
  writeFileSync(join(output, 'mcp.json'), json);
  writeFileSync(join(output, 'codex.toml'), toml);
  const preserved = [];
  for (const [file, content, previous] of [[join(workspace, '.codex/config.toml'), toml, priorToml], [join(workspace, '.mcp.json'), json, priorJson]]) {
    if (existsSync(file)) {
      const current = readFileSync(file, 'utf8');
      if (current === previous) writeFileSync(file, content);
      else if (current !== content) preserved.push(file);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, { flag: 'wx' });
  }
  const skills = ['fray-keel-agent', 'keel-sdk-mcp', 'keel-onchain-data'];
  for (const name of skills) {
    const source = join(root, 'skills', name);
    if (!existsSync(join(source, 'SKILL.md'))) continue;
    for (const base of ['.agents/skills', '.claude/skills']) {
      const target = join(workspace, base, name);
      if (existsSync(target)) { preserved.push(target); continue; }
      cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
    }
  }
  return { workspace, output, preserved };
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: sdkRoot, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) throw Error(`${command} failed (${result.status ?? result.error?.code}). Fix the reported error and rerun setup.`);
}

export function setup(args) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) throw Error('Install Node 22.18 or newer (native TypeScript support is required by the engine).');
  const options = parseSetup(args);
  if (!options.connectOnly) {
    run('pnpm', ['install', '--frozen-lockfile']);
    run('pnpm', ['build']);
    if (options.engine) run('pnpm', ['game:engine']);
    if (options.desktop) {
      // pnpm may intentionally withhold dependency lifecycle scripts.
      const electron = join(sdkRoot, 'apps/desktop/node_modules/electron');
      if (!existsSync(join(electron, 'path.txt'))) run(process.execPath, [join(electron, 'install.js')]);
      run('pnpm', ['--filter', '@keel/desktop', 'build']);
    }
  }
  if (!existsSync(join(sdkRoot, 'packages/mcp/dist/cli.js'))) throw Error('Build the SDK before connecting an artwork workspace.');
  mkdirSync(options.workspace, { recursive: true });
  run(process.execPath, [join(sdkRoot, 'packages/mcp/dist/cli.js'), '--self-test', '--workspace', options.workspace]);
  const result = connectWorkspace(options.workspace, sdkRoot, options.editorConnection);
  console.log(`\nKEEL setup complete. Open this artwork folder in your agent: ${result.workspace}\nConnection files: ${result.output}\nEditor: pnpm desktop\nPractice chain: pnpm game:sandbox\nSepolia check (read only): pnpm setup:sepolia\nGuide: docs/FRIEND_QUICKSTART.md`);
  if (result.preserved.length) console.log(`Preserved existing settings/skills; merge or update explicitly if needed:\n${result.preserved.join('\n')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { setup(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
