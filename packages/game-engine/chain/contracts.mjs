// The KEEL contracts a game publishes to and is read back from: KeelHold stores
// every object (the shell, each module, the game's entry) and welds the
// game's root; KeelRawTokenURIBuilder reads the root back as one
// data:text/html document. On Sepolia they are already deployed; on the
// practice chain the sandbox deploys the same bytes (keel-contracts.json).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAbi } from "viem";
import { keelHoldAbi } from "@keel/sdk/abi";

const here = dirname(fileURLToPath(import.meta.url));

export const SEPOLIA_KEEL = Object.freeze({
  chainId: 11155111,
  KeelHold: "0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267",
  KeelRawTokenURIBuilder: "0x70b5984c19baec22beefb1c2e0bd75a41e1452e0",
  deployments: Object.freeze({
    KeelHold: "0xae9e37ce8705258f4395498747e03682207d3a4e04e23e734086fedd01d404ef",
    KeelRawTokenURIBuilder: "0x95500ae2ad8ce53b592a8b9b580285af06d75b7a12cbf1e4f1e9b3bb71d4c697",
  }),
});

/** What a game needs from the builder: the root check and the document read. */
export const RAW_BUILDER_ABI = Object.freeze([
  "constructor(address keelHold_)",
  "function keelHold() view returns (address)",
  "function preparedTokenURIFragmentValid(bytes32 objectId, bytes32 expectedDigest) view returns (bool)",
  "function harnessInlineURIWithContext(bytes32 objectId, bytes32 digest, bytes contextJSON) view returns (string)",
  "function contextURI(bytes contextJSON) pure returns (bytes)",
  "function preEncodedTokenURI(bytes32 objectId, bytes32 digest, bytes rawPrefix, bytes rawSuffix) view returns (string)",
]);

export const holdAbi = parseAbi(keelHoldAbi);
export const builderAbi = parseAbi(RAW_BUILDER_ABI);

/** The creation code of both contracts, as deployed on Sepolia. */
export function keelContracts() {
  const file = join(here, "keel-contracts.json");
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`The KEEL contract bytes are missing (${file}): run node packages/game-engine/chain/fetch-contracts.mjs once (read-only Sepolia).`, { cause: error }); }
}

/** Deploy KeelHold and the raw builder on a local chain (the practice sandbox). */
export async function deployKeelContracts({ publicClient, walletClient, account }) {
  const { contracts } = keelContracts();
  const deploy = async (abi, bytecode, args = []) => {
    const hash = await walletClient.deployContract({ account, chain: null, abi, bytecode, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deploying failed (${hash}).`);
    return { address: receipt.contractAddress, hash, gasUsed: receipt.gasUsed };
  };
  const hold = await deploy(holdAbi, contracts.KeelHold.bytecode);
  const builder = await deploy(builderAbi, contracts.KeelRawTokenURIBuilder.bytecode, [hold.address]);
  return { KeelHold: hold.address, KeelRawTokenURIBuilder: builder.address, transactions: { KeelHold: hold, KeelRawTokenURIBuilder: builder } };
}
