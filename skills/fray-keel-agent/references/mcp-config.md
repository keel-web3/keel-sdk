# Portable MCP connection

Use the built `@keel/mcp` CLI from the repository or an installed package. A
Claude/Codex client can connect over stdio with a configuration equivalent to:

```bash
pnpm build
node packages/mcp/dist/cli.js --self-test --workspace /path/to/artwork-workspace
```

The self-test checks initialization, discovery, the plan prompt, and the
project-routes resource without writing files, starting a wallet request, or
changing chain state.

For Codex, add the built local server and verify discovery:

```bash
codex mcp add keel -- node /absolute/path/to/keel-sdk/packages/mcp/dist/cli.js \
  --workspace /absolute/path/to/artwork-workspace
codex mcp list
```

To keep configuration repository-scoped, put the equivalent entry in
`.codex/config.toml` instead:

```toml
[mcp_servers.keel]
command = "node"
args = ["/absolute/path/to/keel-sdk/packages/mcp/dist/cli.js", "--workspace", "/absolute/path/to/artwork-workspace"]
```

Other MCP clients can use the generic JSON configuration below.

```json
{
  "mcpServers": {
    "keel-mcp": {
      "command": "node",
      "args": ["/path/to/keel-sdk/packages/mcp/dist/cli.js", "--workspace", "/path/to/artwork-workspace"],
      "env": {
        "KEEL_STUDIO_URL": "https://keel-test.149-28-255-65.sslip.io",
        "KEEL_PUBLIC_RPC_URL": "https://rpc.keel-test.149-28-255-65.sslip.io",
        "KEEL_INDEXER_URL": "https://your-indexer.example",
        "KEEL_STUDIO_AGENT_TOKEN": "<creator-scoped-studio-token>"
      }
    }
  }
}
```

All endpoint values are optional. `keel-endpoint-config` resolves each URL with
this precedence: explicit tool input, KEEL environment value, canonical KEEL
test default. There is no canonical indexer default. `FRAY_STUDIO_URL` remains
a deprecated Studio-only compatibility input; new configuration must use
`KEEL_STUDIO_URL`. `KEEL_PUBLIC_RPC_URL` names the browser/wallet-facing RPC and
must not be confused with a server's private upstream `KEEL_RPC_URL`.

The current canonical Studio upload page is:
`https://keel-test.149-28-255-65.sslip.io/studio/projects/new`.

The MCP server reads only bounded JSON metadata from `/api/library` and
`/api/modules`. Studio draft and staging tools require the creator-scoped
`KEEL_STUDIO_AGENT_TOKEN`; draft updates additionally require the current revision.
`fray-stage-project` sends the
selected bounded source to the Studio temporary project endpoint. It requires
the separate `FRAY_STUDIO_AGENT_TOKEN`, never accepts a wallet key, and never
signs or submits a wallet request.

Installing or discovering this skill does not install, start, authenticate, or
connect the MCP. Build and configure the MCP separately, then confirm its
self-test before using connected tools.

The Electron assistant is an advisory connection. It does not automatically
inherit arbitrary MCP actions from local clients. For the full MCP workflow in
Codex or Claude, configure this server in that client and preserve its own
permissions and exact creator review boundaries. The desktop catalog and the
MCP `keel://mcp/engine` resource share the SDK decision source.
