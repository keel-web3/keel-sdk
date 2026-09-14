#!/usr/bin/env node
/**
 * Prepare the canonical KeelCollectionFA2 Tezos NFT artifact for the KEEL
 * one-of-one lane. This copies only the compiled contract artifact into the
 * review bundle and leaves receipt-bound addresses unresolved; it does not
 * sign or submit anything.
 */
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_BUNDLE = "/Users/ravonus/.codex/visualizations/2026/09/08/01a07ece-e1bd-76c1-867d-0187e66f986f/keel-tezos-one-of-one-q45-standard-eth-modules-v1";
const DEFAULT_SOURCE = "/Users/ravonus/dev/keel-contracts/out/tezos-one-of-one/targets/one_of_one_collection";
const DEFAULT_POSTER = "/private/tmp/keel-tezos-poster.jpg";
const ADMIN_PLACEHOLDER = "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx";

function valueAfter(flag, argv) {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new TypeError(`${flag} requires a value.`);
  return value;
}

function assertFlags(argv) {
  const withValues = new Set(["--bundle", "--source-dir", "--poster"]);
  for (let index = 0; index < argv.length; index += 1) {
    if (!withValues.has(argv[index])) throw new TypeError(`Unsupported option: ${argv[index]}`);
    index += 1;
  }
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  if (argv.length === 0 || argv.includes("--help")) {
    process.stdout.write("Usage: pnpm keel:tezos-one-of-one:nft:prepare -- --bundle DIR [--source-dir DIR] [--poster FILE]\n");
    return;
  }
  assertFlags(argv);
  const bundle = path.resolve(valueAfter("--bundle", argv) ?? DEFAULT_BUNDLE);
  const sourceDir = path.resolve(valueAfter("--source-dir", argv) ?? DEFAULT_SOURCE);
  const poster = path.resolve(valueAfter("--poster", argv) ?? DEFAULT_POSTER);
  const target = path.join(bundle, "tezos-contracts", "one_of_one_standard_collection");
  await mkdir(target, { recursive: true });

  const [codeText, storageText, contractTz, posterInfo] = await Promise.all([
    readFile(path.join(sourceDir, "step_001_cont_0_contract.json"), "utf8"),
    readFile(path.join(sourceDir, "step_001_cont_0_storage.json"), "utf8"),
    readFile(path.join(sourceDir, "step_001_cont_0_contract.tz"), "utf8"),
    stat(poster),
  ]);
  if (posterInfo.size < 1 || posterInfo.size > 1_000_000) throw new TypeError("The NFT poster must be a non-empty file no larger than 1 MB.");

  const code = JSON.parse(codeText);
  const storage = JSON.parse(storageText);

  await Promise.all([
    writeFile(path.join(target, "contract.json"), `${JSON.stringify(code, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(target, "storage.json"), `${JSON.stringify(storage, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(target, "contract.tz"), contractTz, { flag: "wx" }),
    copyFile(poster, path.join(target, "display.jpg")),
    writeFile(path.join(target, "prototype.json"), `${JSON.stringify({
      schema: "keel.tezos.native-nft-prototype@2",
      source: "keel-contracts/out/tezos-one-of-one/targets/one_of_one_collection/step_001_cont_0_contract.json",
      contract: "KeelCollectionFA2",
      ledger: "(owner, token_id) -> amount",
      metadataRoute: "onchfs://<hex file CID>",
      compatibilityRoute: "keel+tezos://<network>/<hold>/harness/<harness-id>",
      adminPlaceholder: ADMIN_PLACEHOLDER,
      poster: { path: "display.jpg", byteLength: posterInfo.size, mediaType: "image/jpeg" },
    }, null, 2)}\n`, { flag: "wx" }),
  ]);
  process.stdout.write(`${JSON.stringify({ target, contract: path.join(target, "contract.json"), storage: path.join(target, "storage.json"), posterBytes: posterInfo.size }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
