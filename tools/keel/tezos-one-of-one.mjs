#!/usr/bin/env node
/**
 * Prepare a Tezos KEEL 1/1 media bundle using the compact animation workflow.
 *
 * The stored object is animated AVIF (or WebP), palette/timing sidecars, and
 * the same reusable GIF encoder module used by the ETH one-of-one workflow.
 * The canonical KEEL entry auto-reconstructs the GIF for display; it does not
 * add a download control. This command does not optimize a GIF directly and
 * never selects, signs, submits, or reads back a Tezos contract.
 */
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createIntegrity } from "@keel/protocol";
import { buildKeelTezosRecursiveObject } from "../../packages/studio-core/dist/index.js";
import {
  buildKeelInlineLocalDocument,
  buildKeelInlineModuleFragment,
  buildKeelInlineShellFragments,
} from "../../packages/sdk/dist/inline-viewer-graph.js";

const execFileAsync = promisify(execFile);
const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GIF_MODULE_ID = "keel.gif-encoder";
const GIF_MODULE_VERSION = "1.0.0";
const TEZOS_NETWORKS = Object.freeze({
  tez: "NetXdQprcVkpaWU",
  "ghostnet-tez": "NetXjD3HPJJjmcd",
});

function fail(message) {
  throw new TypeError(message);
}

function valueAfter(flag, argv) {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${flag} requires a value.`);
  return value;
}

function requiredValue(flag, argv) {
  const value = valueAfter(flag, argv);
  if (value === undefined || value.length === 0) fail(`Missing ${flag}.`);
  return value;
}

function assertNoUnknownFlags(argv) {
  const flagsWithValues = new Set([
    "--input", "--output-dir", "--media", "--media-type", "--palette", "--metadata",
    "--gif-module", "--classic-module", "--python", "--quality", "--speed", "--network",
    "--creator", "--title", "--description",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) fail(`Unexpected argument: ${current}`);
    if (!flagsWithValues.has(current)) fail(`Unsupported option: ${current}`);
    index += 1;
  }
}

async function regularFile(input, label, maxBytes = MAX_INPUT_BYTES) {
  const requested = path.resolve(input);
  const resolved = await realpath(requested);
  const info = await stat(resolved);
  if (!info.isFile() || info.size < 1 || info.size > maxBytes) {
    fail(`${label} must be a regular file from 1 through ${maxBytes} bytes.`);
  }
  return { requested, resolved, info };
}

function networkDescriptor(input) {
  if (input === undefined) return { name: null, identity: null };
  const identity = TEZOS_NETWORKS[input] ?? input;
  if (!/^Net[1-9A-HJ-NP-Za-km-z]{12}$/u.test(identity)) {
    fail("--network must be tez, ghostnet-tez, or an exact Tezos Net... identity.");
  }
  return { name: TEZOS_NETWORKS[input] === undefined ? null : input, identity };
}

function mediaTypeFor(input, explicit) {
  if (explicit !== undefined) {
    if (explicit !== "image/avif" && explicit !== "image/webp") fail("--media-type must be image/avif or image/webp.");
    return explicit;
  }
  if (input.endsWith(".webp")) return "image/webp";
  if (input.endsWith(".avif")) return "image/avif";
  fail("--media-type is required when --media does not end in .avif or .webp.");
}

function outputMediaName(mediaType) {
  return mediaType === "image/webp" ? "animation.webp" : "animation.avif";
}

function htmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function scriptJSON(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function canonicalAnimationEntry({ title, description, mediaType }) {
  const safeTitle = htmlText(title);
  const mediaTypeLiteral = scriptJSON(mediaType);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#020708}main{display:grid;width:100%;height:100%;place-items:center}img{display:block;width:100%;height:100%;object-fit:contain;image-rendering:auto}
  </style>
</head>
<body>
  <main><img id="art" alt="${safeTitle}"></main>
  <script>
  (()=>{
    const art=document.querySelector('#art');
    const content=globalThis.__KEEL_CONTENT__,api=globalThis.KEELGif??globalThis.__KEEL_MODULES__?.['${GIF_MODULE_ID}'];
    const run=async()=>{
      if(!content)return;
      art.src=content.url('keel.animation');
      art.dataset.gifState='native-avif';
      if(!api||typeof ImageDecoder!=='function')return;
      const animation=content.bytes('keel.animation'),paletteBytes=content.bytes('keel.palette'),meta=JSON.parse(new TextDecoder().decode(content.bytes('keel.timing'))),palette=[];
      for(let i=0;i+2<paletteBytes.length;i+=3)palette.push([paletteBytes[i],paletteBytes[i+1],paletteBytes[i+2]]);
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const decoder=new ImageDecoder({data:animation,type:${mediaTypeLiteral},preferAnimation:true,colorSpaceConversion:'none'});
      await decoder.tracks.ready;
      const map=api.createPaletteMapper(palette),gif=api.createDeltaEncoder(meta.width,meta.height,palette,meta.loop),canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
      canvas.width=meta.width;canvas.height=meta.height;
      for(let i=0;i<meta.frames;i++){
        const result=await decoder.decode({frameIndex:i,completeFramesOnly:true}),frame=result.image;
        context.drawImage(frame,0,0);frame.close();
        gif.writeFrame(map(context.getImageData(0,0,meta.width,meta.height).data),meta.durations[i]);
      }
      decoder.close();
      const gifBytes=gif.finish();
      globalThis.__KEEL_GIF_BYTE_LENGTH__=gifBytes.byteLength;
      art.dataset.gifBytes=String(gifBytes.byteLength);
      art.dataset.gifType='image/gif';
      art.dataset.gifState='ready';
      art.src=URL.createObjectURL(new Blob([gifBytes],{type:'image/gif'}));
    };
    run().catch(()=>{art.dataset.gifState='native-avif'});
  })();
  </script>
</body>
</html>`;
}

async function buildCanonicalAnimationShell({ mediaBytes, mediaType, paletteBytes, metadataBytes, moduleBytes, classicModuleBytes, title, description }) {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot: REPOSITORY_ROOT });
  const module = await buildKeelInlineModuleFragment({
    moduleId: GIF_MODULE_ID,
    version: GIF_MODULE_VERSION,
    mediaType: "text/javascript",
    aliases: [GIF_MODULE_ID],
    decodedBytes: classicModuleBytes ?? moduleBytes,
    compression: "gzip",
    execution: classicModuleBytes === null ? "module" : "classic",
    phase: "runtime",
    weight: 10,
  });
  const local = await buildKeelInlineLocalDocument({
    shell,
    modules: [module],
    assets: [
      { id: "keel.animation", mediaType, source: mediaBytes, compression: "gzip" },
      { id: "keel.palette", mediaType: "application/octet-stream", source: paletteBytes, compression: "none" },
      { id: "keel.timing", mediaType: "application/json", source: metadataBytes, compression: "gzip" },
    ],
    entry: {
      id: "keel.animation-entry",
      mediaType: "text/html",
      source: new TextEncoder().encode(canonicalAnimationEntry({ title, description, mediaType })),
    },
  });
  return { local, module };
}

function bytesToHex(bytes) {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

async function copyExclusive(source, target) {
  try {
    await copyFile(source, target, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code === "EEXIST") fail(`Refusing to overwrite existing output: ${target}`);
    throw error;
  }
}

async function runLocalAvifEncoder({ input, outputDir, python, quality, speed }) {
  const helper = new URL("./encode-animated-avif.py", import.meta.url).pathname;
  await execFileAsync(python, [helper, "--input", input.resolved, "--output-dir", outputDir, "--quality", quality, "--speed", speed], { maxBuffer: 2 * 1024 * 1024 });
}

async function readMetadata(metadata) {
  let value;
  try {
    value = JSON.parse(await readFile(metadata.resolved, "utf8"));
  } catch (error) {
    fail(`Could not parse --metadata JSON: ${error.message}`);
  }
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || !Number.isInteger(value.frames) || value.frames < 1) fail("--metadata must contain integer width, height, and frames fields.");
  if (!Array.isArray(value.durations) || value.durations.length !== value.frames) fail("--metadata durations must contain one entry per frame.");
  return value;
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  if (argv.includes("--help") || argv.length === 0) {
    process.stdout.write("Usage: pnpm keel:tezos-one-of-one -- --input source.gif --output-dir DIR --gif-module /path/gif-module.mjs [--media animation.avif --palette palette.bin --metadata source-metadata.json] [--media-type image/avif|image/webp] [--classic-module /path/gif-module.classic.min.js] [--quality 45] [--speed 6] [--network tez|ghostnet-tez|Net...] [--creator tz...] [--title TEXT] [--description TEXT]\n");
    return;
  }
  assertNoUnknownFlags(argv);
  const input = await regularFile(requiredValue("--input", argv), "--input");
  const outputDir = path.resolve(requiredValue("--output-dir", argv));
  const network = networkDescriptor(valueAfter("--network", argv));
  const creator = valueAfter("--creator", argv);
  if (creator !== undefined && !/^tz[1-4][1-9A-HJ-NP-Za-km-z]{30,36}$/u.test(creator)) fail("--creator must be a Tezos tz1/tz2/tz3/tz4 address.");
  const title = valueAfter("--title", argv) ?? "Untitled Tezos KEEL 1/1";
  const description = valueAfter("--description", argv) ?? "Native Tezos KEEL one-of-one media preparation.";
  const quality = valueAfter("--quality", argv) ?? "45";
  const speed = valueAfter("--speed", argv) ?? "6";
  if (!/^\d+$/u.test(quality) || !/^\d+$/u.test(speed)) fail("--quality and --speed must be integers.");
  const gifModule = await regularFile(requiredValue("--gif-module", argv), "--gif-module");
  const classicModuleInput = valueAfter("--classic-module", argv);
  const classicModule = classicModuleInput === undefined ? null : await regularFile(classicModuleInput, "--classic-module");
  await mkdir(outputDir, { recursive: true });

  const mediaInput = valueAfter("--media", argv);
  const paletteInput = valueAfter("--palette", argv);
  const metadataInput = valueAfter("--metadata", argv);
  if (mediaInput === undefined || paletteInput === undefined || metadataInput === undefined) {
    if (mediaInput !== undefined || paletteInput !== undefined || metadataInput !== undefined) fail("--media, --palette, and --metadata must be supplied together.");
    if (valueAfter("--media-type", argv) === "image/webp") fail("the built-in encoder prepares AVIF; supply an explicit WebP bundle instead.");
    await runLocalAvifEncoder({ input, outputDir, python: valueAfter("--python", argv) ?? "python3", quality, speed });
  }

  const mediaPath = mediaInput === undefined ? path.join(outputDir, "animation.avif") : mediaInput;
  const palettePath = paletteInput === undefined ? path.join(outputDir, "palette.bin") : paletteInput;
  const metadataPath = metadataInput === undefined ? path.join(outputDir, "source-metadata.json") : metadataInput;
  const media = await regularFile(mediaPath, "--media");
  const palette = await regularFile(palettePath, "--palette", 16 * 1024 * 1024);
  const metadata = await regularFile(metadataPath, "--metadata", 16 * 1024 * 1024);
  const mediaType = mediaTypeFor(media.resolved, valueAfter("--media-type", argv));
  const mediaName = outputMediaName(mediaType);
  const sourceOutput = path.join(outputDir, "source.gif");
  const mediaOutput = path.join(outputDir, mediaName);
  const paletteOutput = path.join(outputDir, "palette.bin");
  const metadataOutput = path.join(outputDir, "source-metadata.json");
  const moduleOutput = path.join(outputDir, "gif-module.mjs");
  const classicOutput = classicModule === null ? null : path.join(outputDir, "gif-module.classic.min.js");
  const reportOutput = path.join(outputDir, "keel-tezos-one-of-one.json");
  if (mediaInput !== undefined) {
    await copyExclusive(input.resolved, sourceOutput);
    await copyExclusive(media.resolved, mediaOutput);
    await copyExclusive(palette.resolved, paletteOutput);
    await copyExclusive(metadata.resolved, metadataOutput);
  }
  await copyExclusive(gifModule.resolved, moduleOutput);
  if (classicModule !== null) await copyExclusive(classicModule.resolved, classicOutput);
  const source = await regularFile(sourceOutput, "source.gif");
  const storedMedia = await regularFile(mediaOutput, mediaName);
  const storedPalette = await regularFile(paletteOutput, "palette.bin");
  const storedMetadata = await regularFile(metadataOutput, "source-metadata.json");
  const mediaMetadata = await readMetadata(storedMetadata);
  const sourceBytes = new Uint8Array(await readFile(source.resolved));
  const mediaBytes = new Uint8Array(await readFile(storedMedia.resolved));
  const paletteBytes = new Uint8Array(await readFile(storedPalette.resolved));
  const metadataBytes = new Uint8Array(await readFile(storedMetadata.resolved));
  const moduleBytes = new Uint8Array(await readFile(moduleOutput));
  const classicModuleBytes = classicOutput === null ? null : new Uint8Array(await readFile(classicOutput));
  const object = await buildKeelTezosRecursiveObject(mediaBytes, mediaType);
  const nodeBytes = object.nodes.reduce((sum, node) => sum + node.encoded.byteLength, 0);
  const canonicalShell = await buildCanonicalAnimationShell({
    mediaBytes,
    mediaType,
    paletteBytes,
    metadataBytes,
    moduleBytes,
    classicModuleBytes,
    title,
    description,
  });
  const canonicalShellPath = path.join(outputDir, "canonical-shell.html");
  await writeFile(canonicalShellPath, canonicalShell.local.rootBytes, { flag: "wx" });
  const canonicalPartSummary = canonicalShell.local.parts.map((part) => ({
    kind: part.kind,
    role: part.role,
    ...(part.moduleId === undefined ? {} : { moduleId: part.moduleId }),
    byteLength: part.byteLength,
    integrity: part.integrity,
  }));
  const report = {
    schema: "keel-tezos-one-of-one-avif-preparation@2",
    status: "local-review-only",
    family: "tezos",
    network,
    creator: creator ?? null,
    collection: { standard: "FA2", editionSize: 1, tokenId: null, status: "requires-explicit-tezos-collection-adapter" },
    metadataDraft: { name: title, description, artifactMediaType: mediaType, artifactObjectId: object.id },
    media: {
      source: { path: "source.gif", mediaType: "image/gif", integrity: await createIntegrity(sourceBytes) },
      stored: { path: mediaName, mediaType, integrity: await createIntegrity(mediaBytes) },
      palette: { path: "palette.bin", mediaType: "application/octet-stream", integrity: await createIntegrity(new Uint8Array(await readFile(storedPalette.resolved))) },
      timing: { path: "source-metadata.json", frames: mediaMetadata.frames, width: mediaMetadata.width, height: mediaMetadata.height, durationMs: mediaMetadata.durationMs ?? mediaMetadata.durations.reduce((sum, duration) => sum + duration, 0), loop: mediaMetadata.loop ?? 0 },
      runtime: {
        moduleId: GIF_MODULE_ID,
        version: GIF_MODULE_VERSION,
        module: classicOutput === null ? "gif-module.mjs" : "gif-module.classic.min.js",
        moduleIntegrity: await createIntegrity(classicModuleBytes ?? moduleBytes),
        behavior: "auto-reconstruct-and-display",
        downloadControl: false,
        reconstructs: "image/gif Blob from decoded animated media, palette, and exact source timings",
        fallback: mediaType,
      },
      sourceBytes: sourceBytes.byteLength,
      storedBytes: mediaBytes.byteLength,
      percentSaved: Math.round(((sourceBytes.byteLength - mediaBytes.byteLength) / sourceBytes.byteLength) * 10_000) / 100,
    },
    storage: { mode: "native-tezos-recursive-object", objectProtocol: "keel.tezos.object.v1", objectId: object.id, rootNode: object.rootNode, decodedSha256: object.decodedSha256, decodedByteLength: object.decodedByteLength, manifestHex: bytesToHex(object.manifest), nodeCount: object.nodes.length, encodedNodeBytes: nodeBytes, leafBytes: 12_000, fanout: 16, nodeInventory: object.nodes.map((node) => ({ id: node.id, kind: node.kind, encodedByteLength: node.encoded.byteLength, decodedByteLength: node.decodedByteLength, children: node.children })) },
    verification: {
      canonicalShellSource: "packages/sdk/src/inline-viewer-graph.ts + packages/sdk/src/verification-shell.ts",
      customShell: false,
      shellStatus: "local-canonical-shell-built",
      localPath: "canonical-shell.html",
      localRootIntegrity: canonicalShell.local.rootIntegrity,
      localByteLength: canonicalShell.local.byteLength,
      composition: canonicalPartSummary,
      runtimeModule: {
        moduleId: GIF_MODULE_ID,
        version: GIF_MODULE_VERSION,
        execution: classicModuleBytes === null ? "module" : "classic",
        source: classicModuleBytes === null ? "gif-module.mjs" : "gif-module.classic.min.js",
        integrity: canonicalShell.module.item.integrity,
        catalogStatus: "requires-selected-tezos-chain-module-readback-before-publication",
      },
      browserVerifier: "tests/sdk-verification-shell-browser.test.mjs",
      publicationRequirement: "Omit viewer at Studio staging so the selected Tezos catalog supplies the registered shell; do not upload this local shell as a replacement.",
    },
    publication: { signed: false, submitted: false, receipt: null, readback: null, blocker: "No Tezos FA2 collection adapter, selected contract, or creator-approved network operation was supplied." },
  };
  await writeFile(reportOutput, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ report: reportOutput, media: mediaOutput, objectId: object.id, storedBytes: mediaBytes.byteLength, percentSaved: report.media.percentSaved }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
