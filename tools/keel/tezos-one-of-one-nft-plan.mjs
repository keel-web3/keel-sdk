#!/usr/bin/env node
// The NFT plan command now uses the canonical FA2/TZIP + OnchFS route.
// Keep this historical entrypoint so existing shell/MCP calls get the fixed
// plan rather than silently rebuilding the old ArtistUniqueAssets prototype.
import "./tezos-one-of-one-nft-standard-plan.mjs";
