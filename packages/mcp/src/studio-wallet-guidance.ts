export const STUDIO_WALLET_GUIDANCE = "Default to the KEEL Studio website at https://studio.onkeel.io for the full creator workflow and wallet review. KEEL Desktop is entirely optional; do not require installing, building or configuring it, creating another wallet, or building a separate signing page for a supported Studio workflow. Connect to the user's existing Studio account using keel-studio-connect: start returns an approveUrl/code for the user; complete saves the approved scoped key privately and local tools use it automatically. The cross-platform terminal alternative is keel-mcp --connect --window --workspace <project>. Never ask for a key in chat or an environment file. Then stage work with keel-studio-stage-project, create or edit releases with keel-studio-draft, and return handoffUrl or reviewUrl. The creator opens that website link, reviews the selected chain and exact operation, and approves in their existing connected wallet. A scoped agent key authorizes private draft work, not signatures or spending. wallet-request-prepare and wallet-link return unsigned envelopes/typed data, not a hosted signing route or wallet approval. Do not put keys, grants, or arbitrary transaction payloads in review URLs.";

export const STUDIO_WALLET_POLICY = {
  schema: "keel-studio-wallet-review@1",
  default: "studio-web",
  studioUrl: "https://studio.onkeel.io",
  desktopRequired: false,
  desktop: "optional local authoring application",
  connectUrl: "https://studio.onkeel.io/studio#agents",
  remoteMcpUrl: "https://studio.onkeel.io/api/mcp",
  connection: { default: "approval-code", cli: "keel-mcp --connect --window --workspace <project>", startApi: "/api/agent/pair", pollApi: "/api/agent/pair/poll", approvePage: "/studio/connect", secrets: "private user-profile credential file, scoped by workspace and Studio origin; no token in URLs, MCP results, project files or shell history", terminalImport: "keel-mcp --import-key --workspace <project> (hidden prompt)" },
  localTools: ["keel-studio-connect","keel-studio-capabilities", "keel-studio-stage-project", "keel-studio-draft"],
  remoteTools: ["keel_whoami", "keel_workspace", "keel_create_draft", "keel_contracts", "keel_inspect_contract"],
  handoff: "Return the stage response's handoffUrl or the draft response's reviewUrl; use returned contract reviewUrl for existing contract controls.",
  creator: "Signs in and reviews/publishes in the website using their existing connected wallet; EVM uses the selected wagmi connector.",
  agentSigning: false,
  agentSubmission: false,
  rawTransactionImport: "No generic URL importer is advertised. Use the supported Studio project/release/contract workflow; an unsigned wallet envelope is not a hosted job.",
} as const;
