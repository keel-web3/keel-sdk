# Hands-on test

Open **Open KEEL Test.command** in this folder, or run `pnpm desktop:test-drive`
from the repository root. The launcher opens a separate practice workspace and
keeps your changes for the next visit. It does not use existing wallet profiles.
The sample, local Studio catalog and simulated contract are created on first
launch. The banner shows the current local endpoint. Existing practice changes
are preserved on later launches. The editor must have been built once with `pnpm desktop:build`.

1. Open **Signal Garden · practice**. Move the pointer over the animated preview.
   Choose **Show code** to change the heading in `index.html`, or colors in `garden.js`, then **Save &
   preview**. Close with an unsaved edit and confirm **Keep editing** protects it.
   Rapid repeated saves must write once. Edits made while a save is pending
   must remain visible and marked unsaved until the next save.
2. Use **+ Import file** in a project with a GIF larger than 1 MB. It should
   become an asset and display immediately inside the canonical K shell.
   Open **Viewing** to switch between verification and direct display, or choose
   Project HTML again. **Files → Export original** must preserve its exact bytes.
   Unknown files and files over 16 MB also import; a suitable renderer may still
   be needed to display them. Original files remain untouched.
3. In **Viewing**, check measured original/Gzip sizes and the inclusive 1.75 MB
   Inline rule. Larger compressed assets select RPC reconstruction for publication.
   Read the compatibility warnings and direct `haulObject`/`readSlug` explanation.
   Expand **Target network & live costs** and connect the banner's practice RPC in **Your target network** (family EVM,
   expected chain 31337). Check the current head, fee quote, 45M read boundary
   and refresh button. Use the practice contract address, calldata `0x` and value
   `0x0` to test an exact call estimate. These are fixture fees, not a real chain quote.
   A real/custom RPC can be selected explicitly; mismatched chain IDs must fail.
   In **Release**, choose a release type, collection model, mint system and
   storage explicitly. Check that missing questions reflect those choices and
   a limited edition requires supply. Saving a plan does not publish it.
4. In **Setup**, choose **Check this computer**, then **Check Codex
   connection**. Codex has passed a real minimal round-trip on this computer.
   Claude Code is installed but currently needs sign-in. Use `claude auth login`
   in your terminal before testing that provider. API providers require your key
   and an available model ID; those accounts have not been exercised here.
5. Open **Chats** in the sidebar, start a conversation, and ask Codex to create
   an HTML artwork. Open the returned project, start a project chat and ask for a
   metadata change. Review and apply it; the open editor should update. Ask the
   assistant to show the Metadata or Release tab. Use **•••** to rename, pin,
   archive or restore the chat, change the connection, or control context sharing.
   Switch chats with an unsent message, then restart the editor; history and the
   message draft should remain. **Memory** lets you scope, edit, pause and forget
   remembered details. **Inspect context** explains what will be included.
   See [AGENT_WORKSPACE.md](AGENT_WORKSPACE.md) for wallet-review and provider acceptance boundaries.
6. The practice Studio is already configured. In **Setup**, use the
   banner’s Studio/RPC URL with **Check & connect Studio** to test negotiation.
   You can explicitly replace it with the origin of your own Studio. In **Library**, search its library, choose a
   project, and save a reference. Find it under that project's **Resources**.
   The saved reference is catalog metadata, not an onchain dependency lock.
7. In **Contracts**, first select **Practice / Demo controls** and copy the
   banner’s local endpoint into its RPC field. `owner()` returns the fixture
   account `0x2222222222222222222222222222222222222222`. Use that address
   to simulate `setValue(uint256)`; it produces no persistent chain change.
   For your own contracts, track an address and exact chain, then import its JSON ABI
   or compiler artifact. Check a read method using an RPC for that chain. For a
   write method, prepare an unsigned call and optionally simulate as a public
   address. Changing arguments clears the previous result. Simulation does not
   prove ownership and does not send a transaction.
   Change a value while a slow simulation or gas estimate is still running;
   its late response must not reappear as evidence for the new value.
8. Export the workspace from **Setup**. Review and import that file.
   Projects appear as copies; existing contracts remain intact. Original object
   bytes survive. API keys, wallet profiles and conversations are excluded from
   this portable project export.
9. In **Wallets**, add MetaMask, Rabby, or Temple, review the permissions, then
   create or restore the wallet in its own window. Use **Connect wallet**, choose
   an account, and approve the connection. **Check signing connection** requests
   only a non-authorizing message and verifies the signature without gas.
   For EVM contract writes, connect to the exact contract chain, choose an account
   in the contract's wallet controls, review simulation/fees, then approve or
   reject in the wallet. The practice RPC in the banner intentionally cannot
   submit transactions; use a separate local chain or chosen test network.
10. In **Tezos wallets**, choose installed Temple or **Pair a web, desktop, or
    phone wallet**. Beacon offers Temple, Kukai, Umami, AirGap and other wallets.
    Select Tezos Mainnet or a saved Tezos network, then approve pairing in the
    selected wallet. Check the address, network, tez balance and signing check.
    Under **Send tez or use a Tezos contract**, review the destination and fee;
    contract calls accept an entrypoint and Micheline. Always use a disposable
    test account for compatibility checks. Close pairing to test cancellation;
    disconnect/reconnect and restart to check persisted permissions. An operation
    hash means submitted; **Check transaction** verifies inclusion and contents.

## Metadata, releases and project checks

- In **Metadata**, enter an artwork name and description. Import a cover image,
  choose an existing image from Files, paste an image URI, or import metadata JSON.
  Save, return to My work, and confirm the card shows the metadata image. An
  imported artwork image is the fallback; a project without an image says so.
  Images remain contained rather than cropped. Try adding numeric traits and
  custom JSON fields, then export and re-import the metadata document.
- In **Preview**, try Fit, Desktop (1280 px), Phone (390 px), and Focus view.
  Escape exits focus. Source code is optional. Unsaved edits must be labelled as
  newer than the displayed preview; Save & preview refreshes it.
- In **Release**, choose Offer a collectible. Work through the network,
  preservation, collection and access steps. A sale can combine multiple rules
  with Every rule or At least one rule. A drop lets you add and reorder phases.
  Review shows unanswered choices and setup blockers. It saves a plan, not a mint.
- In **Manage**, link tracked contracts to a project, including a shared contract
  used by several projects. Open its generated controls, export original files,
  and run **Save & check files**. Ratings describe evidence and readiness, not art.
- To try **Save & check onchain** without spending gas, connect the banner's
  practice RPC (chain **31337**) in Viewing. In Manage, track the practice
  ERC-721 token: contract **0x1111111111111111111111111111111111111111**, token
  **1**, chain **31337**. The simulated metadata response is labelled Practice.
  This is a fixture, not a deployed NFT. The checker compares published JSON
  with your saved draft. Review the document before choosing **Use published
  metadata as draft**. Check history persists after restarting.
- Change metadata after a check. Earlier evidence must be marked as an earlier
  version and must leave the current rating. Recheck when ready. The EVM reader
  supports ERC-721/721A `tokenURI` and ERC-1155 `uri`, including `{id}` replacement.
  Tezos metadata read-back and a full nested-dependency audit remain separate work.
- In **Viewing → Audience & discovery**, save a discovery preference and search
  the Studio index. A search candidate, an exact file fingerprint match, a
  published contract response and a public gallery listing are different things.
  Empty index results do not prove absence onchain. Viewer counts remain
  **Not connected** until a real analytics service is configured.

Remote cover images use HTTPS, with IPFS and Arweave URIs resolved through public
preview gateways. Remote image previews are bounded to 12 MB and time out;
metadata JSON editing is bounded to 2 MB. Larger original artwork still imports
through Files. Local image URIs in a draft must be replaced with published
references before the exported metadata is suitable for a live token.

For failures, record the screen, what you clicked, and the displayed error.
Do not include API keys, recovery phrases or wallet vault files in reports.
Automated evidence and screenshots live in `artifacts/`.

## Automated checks

```sh
pnpm test
pnpm desktop:test
pnpm desktop:test:electron
```

The full SDK/MCP suite uses two workers by default to avoid compiler timeouts.
The native test launches three hidden Electron processes, uses its own local Studio/RPC fixtures,
imports an ABI, simulates an unsigned call, verifies metadata covers and custom JSON,
checks ordered release phases and combined gates, reads fixture token metadata at
one block, rejects stale draft evidence, verifies backup and module search,
and installs a keyless extension fixture. It also checks the EVM provider bridge,
rejections, relative wallet windows, Beacon pairing UI and cancellation. Beacon
pairing contacts its relay services. It does not invoke model providers,
install a real wallet, sign or submit a chain transaction.

For local runtime measurements, run `pnpm --filter @keel/desktop benchmark`.
See [PERFORMANCE.md](PERFORMANCE.md) for the sample, results and limits.
