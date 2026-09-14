import {prepareSVGRenderer} from '@keel/sdk/svg-renderer-authoring';
import {RasterPrepareService} from './raster-prepare-service.mjs';
import { exportDirectImagePackage } from './direct-image-export.mjs';
import {renderLayeredSVG} from '@keel/sdk/layered-svg';
import {selectLayeredArt} from '@keel/sdk/layered-art';
import {layerCurationPlan} from '@keel/sdk/layered-curation';
import {LayerImageService} from './layer-image-service.mjs';
import {saveRenderedImage} from './rendered-image-save';
import { layeredHTML } from './layered-project.mjs';
import { exportLayeredPackage } from './layered-export.mjs';
import { app, BrowserWindow, ipcMain, protocol, session, dialog, safeStorage, shell, Menu } from 'electron';
import { readFile, mkdir, writeFile, rename, rm, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
const rasterImages=new RasterPrepareService(path.join(__dirname,'raster-prepare-worker.mjs'));
const layerImages=new LayerImageService(path.join(__dirname,'layer-image-worker.mjs'));
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { KEEL_DEPLOYMENTS, KEEL_MODULES, moduleAbi } from '@keel/sdk/infrastructure';
import { parseKeelCreatorOperationEnvelope } from '@keel/sdk/creator-collection-wallet';
import { KEEL_ENGINE_CATALOG } from '@keel/sdk/engine';
import { createTrackedContract, parseContractAbi, prepareContractControl } from '@keel/sdk/contract-controls';
import { WorkspaceStore, newProject, newTemplateProject } from './workspace.mjs';
import { serveWorkspace } from './workspace-service.mjs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { attachArtwork } from './creation-workflow.mjs';
import { mainnet, base, polygon, arbitrum, optimism, sepolia, baseSepolia } from 'viem/chains';
import { inspectContract, readControl, simulateControl } from './contract-rpc.mjs';
import { runLocalAgent, localAgentCommand, localAgentVersion, claudeSignInStatus } from './providers.mjs';
import { discoverCreatorContracts } from './creator-discovery.mjs';
import { WalletRuntime } from './wallet-runtime';
import { WALLET_SOURCES } from './wallet-extensions.mjs';
import { CURATED_WALLETS, downloadWallet } from './wallet-download.mjs';
import { WalletTransactions } from './wallet-transactions.mjs';
import { TezosWallets, TEZOS_MAINNET, TEZOS_SHADOWNET } from './tezos-wallets.mjs';
import { WalletBrowser } from './wallet-browser';
import { TEZOS_PAGE } from './wallet-pages.mjs';
import { invokeWalletPage } from './wallet-bridge';
import { toHex, stringToHex, verifyMessage } from 'viem';
import { AgentService } from './agent-service.mjs';
import { chatOptions, chatPatch } from './agent-store.mjs';
import { viewSchema } from './agent-tools.mjs';
import { exportWorkspace, inspectArchive, mergeArchive, MAX_ARCHIVE_BYTES } from './workspace-exchange.mjs';
import { inspectStudio, searchStudio } from './studio.mjs';
import { readImportFile, sourceFile, MAX_SOURCE_BYTES } from './file-import.mjs';
import { PreviewService } from './preview-service.mjs';
import { loadRuntimeModules, directRuntimeImports } from './runtime-files.mjs';
import { inspectNetwork, estimateNetworkCall } from './network.mjs';
import { sameState } from './editor-state.mjs';
import { metadataDocument, parseMetadata } from './metadata.mjs';
import { checkLocalProject, checkPublishedMetadata, projectFingerprint, remoteBytes } from './project-checks.mjs';
import { GameEngineService, findGameEngineRoot, findGameProjects, allowGamePermission } from './game-engine/game-engine-service.mjs';
import { gameProcedures } from './game-engine/game-procedures';
import { isGameProject } from './game-engine/game-project.mjs';
import { GameBuilderService, BUILDER_PREVIEW_HEADERS } from './game-engine/builder-service.mjs';
import { builderProcedures } from './game-engine/builder-procedures';
import { GameCodecService } from './game-engine/codec-service.mjs';
import { codecProcedures } from './game-engine/codec-procedures';
import { BUILDER_PREVIEW_HOST } from './game-engine/builder-project.mjs';
import { GameSoundService, SOUND_PREVIEW_HEADERS } from './game-engine/sound-service.mjs';
import { soundProcedures } from './game-engine/sound-procedures';
import { SOUND_PREVIEW_HOST } from './game-engine/sound-project.mjs';
import { GameLevelService, LEVEL_PREVIEW_HEADERS } from './game-engine/level-service.mjs';
import { levelProcedures } from './game-engine/level-procedures';
import { LEVEL_PREVIEW_HOST } from './game-engine/level-project.mjs';
import { alphaProcedures } from './game-engine/alpha-procedures';
import { LogRing, alphaPaths, engineLockOf, practiceChain } from './game-engine/alpha-service.mjs';
import { linkGamesFolder } from '../../../packages/game-engine/scripts/new-game.mjs';
// (Recent log lines for the Game engine page's Copy diagnostics; kept in memory, never sent.)
const logs = new LogRing().capture();
const gamePaths = () => alphaPaths({ sdkRoot: path.resolve(__dirname, '../../..'), userData: app.getPath('userData') });

protocol.registerSchemesAsPrivileged([
  { scheme: 'keel-cover', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'keel-editor', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'keel-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'keel-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
const UI = 'keel-editor://app/index.html';
const t = initTRPC.create();
let window: BrowserWindow;
let store: WorkspaceStore;
let workspaceService: Awaited<ReturnType<typeof serveWorkspace>> | undefined;
let wallets: WalletRuntime;
let walletRestore: Promise<void> = Promise.resolve();
let walletTransactions: WalletTransactions;
let tezosWallets: TezosWallets;
let beaconBrowser: WalletBrowser | undefined;
let agents: AgentService;
let pendingImport: { token: string; value: ReturnType<typeof inspectArchive> } | undefined;
let canonicalShell: any;
let previews: PreviewService;
let gameEngine: GameEngineService;
let gameBuilder: GameBuilderService;
let gameCodec: GameCodecService;
let gameSound: GameSoundService;
let gameLevel: GameLevelService;
function previewFor(project: any) {
  return previews.preview(project, store.read().state.objects);
}
function objectResponse(object: any, request: Request) {
  const headers = { 'content-type': object.type, 'content-length': String(object.byteLength), 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; sandbox allow-scripts" };
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, object.byteLength - Number(match[2])) : NaN;
    const end = match?.[1] && match?.[2] ? Math.min(Number(match[2]), object.byteLength - 1) : object.byteLength - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= object.byteLength) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${object.byteLength}` } });
    const file = store.objectFile(object.id);
    const body = file ? Readable.toWeb(createReadStream(file, { start, end })) : store.object(object.id).subarray(start, end + 1);
    return new Response(body as BodyInit, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${object.byteLength}`, 'content-length': String(end - start + 1) } });
  }
  return new Response(store.objectBody(object.id) as BodyInit, { headers });
}
const provider = z.enum(['codex', 'claude', 'openai', 'anthropic']);
const keyProvider = z.enum(['openai', 'anthropic']);
const networkInput = z.object({ label: z.string().trim().min(1).max(100), family: z.enum(['ethereum', 'tezos']), rpcUrl: z.string().url().max(2048), chainId: z.number().int().positive().optional(), network: z.string().max(64).optional(), holdAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), builderAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() }).strict();
function networkProfile(id: string) { const row = store.db.prepare('SELECT encrypted FROM network_profiles WHERE id=?').get(id) as any; if (!row || !credentialEncryptionAvailable()) throw new Error('Reconnect this network in Viewing or Release.'); return JSON.parse(safeStorage.decryptString(Buffer.from(row.encrypted))); }
const controlInput = z.object({ contract: z.unknown(), signature: z.string().max(4096), args: z.array(z.unknown()).max(64), valueWei: z.string().max(78).optional() }).strict();
const walletProcedure = t.procedure.use(async ({ next }) => { await walletRestore; return next(); });
const tezosWalletId = z.union([z.literal('beacon'), z.string().uuid()]);

async function chosenFile(limit: number, purpose = 'file') {
  const selection = await dialog.showOpenDialog(window, { title: `Import ${purpose}`, properties: ['openFile'] });
  if (selection.canceled || !selection.filePaths[0]) return null;
  return readImportFile(selection.filePaths[0], limit, purpose);
}

function keyAvailable(name: string) { return !!store.db.prepare('SELECT provider FROM credentials WHERE provider=?').get(name); }
function credentialEncryptionAvailable() { return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())); }
function readKey(name: string) {
  const row = store.db.prepare('SELECT encrypted FROM credentials WHERE provider=?').get(name);
  if (!row || !credentialEncryptionAvailable()) throw new Error('Save this provider key in Connections with operating system credential encryption first.');
  return safeStorage.decryptString(Buffer.from(row.encrypted as Uint8Array));
}

const router = t.router({
  networkPresets: t.procedure.query(() => [
    ...[mainnet, base, polygon, arbitrum, optimism, sepolia, baseSepolia].map(chain => ({ id: `evm-${chain.id}`, label: chain.name, family: 'ethereum', chainId: chain.id, rpcUrl: chain.rpcUrls.default.http[0], testnet: !!('testnet' in chain && chain.testnet) })),
    { ...TEZOS_MAINNET, testnet: false }, { ...TEZOS_SHADOWNET, testnet: true },
  ]),
  networkProfiles: t.procedure.query(() => store.db.prepare('SELECT id, label, family, chain_identity AS chainIdentity FROM network_profiles ORDER BY label').all()),
  connectNetwork: t.procedure.input(networkInput).mutation(async ({ input }) => {
    if (!credentialEncryptionAvailable()) throw new Error('Operating system encryption is required to save a custom RPC URL.');
    const snapshot = await inspectNetwork(input); const id = randomUUID();
    const profile = { ...input, ...(snapshot.family === 'ethereum' ? { chainId: snapshot.chainId } : { network: snapshot.network }) };
    store.db.prepare('INSERT INTO network_profiles VALUES (?,?,?,?,?)').run(id, input.label, input.family, String(snapshot.family === 'ethereum' ? snapshot.chainId : snapshot.network), safeStorage.encryptString(JSON.stringify(profile)));
    return { id, snapshot };
  }),
  liveNetwork: t.procedure.input(z.string().uuid()).query(({ input }) => inspectNetwork(networkProfile(input))),
  estimateOnNetwork: t.procedure.input(z.object({ profileId: z.string().uuid(), to: z.string().regex(/^0x[0-9a-fA-F]{40}$/), data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).max(2_000_002), value: z.string().regex(/^0x[0-9a-fA-F]+$/).max(66), from: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), purpose: z.enum(['publication', 'presentation-read']) }).strict()).mutation(({ input }) => estimateNetworkCall({ ...networkProfile(input.profileId), ...input })),
  practice: t.procedure.query(async () => { if (process.env.KEEL_DESKTOP_PRACTICE_RPC) return { rpcUrl: process.env.KEEL_DESKTOP_PRACTICE_RPC, chainId: 31337, account: '0x2222222222222222222222222222222222222222' }; const chain = await practiceChain(gamePaths()); return chain.running ? { rpcUrl: chain.rpc, chainId: chain.chainId, account: chain.account, sandbox: { KeelHold: chain.KeelHold, builder: chain.KeelRawTokenURIBuilder, viewer: chain.viewer } } : { rpcUrl: null, chainId: 31337, account: null }; }),
  exportWorkspace: t.procedure.mutation(async () => {
    const content = exportWorkspace(store);
    const selected = await dialog.showSaveDialog(window, { title: 'Export local workspace', defaultPath: 'keel-workspace.keel.json', filters: [{ name: 'KEEL workspace', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePath) return null;
    const temporary = `${selected.filePath}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, content, { flag: 'wx', mode: 0o600 }); await rename(temporary, selected.filePath); } finally { await rm(temporary, { force: true }); }
    return { saved: true, name: path.basename(selected.filePath) };
  }),
  reviewWorkspaceImport: t.procedure.mutation(async () => {
    pendingImport = undefined;
    const file = await chosenFile(MAX_ARCHIVE_BYTES); if (!file) return null;
    const value = inspectArchive(file.bytes.toString('utf8')); const token = randomUUID(); pendingImport = { token, value };
    return { token, digest: value.digest, name: file.name, projects: value.state.projects.length, contracts: value.state.contracts.length, objects: value.state.objects.length, memories: value.state.memories.length };
  }),
  discardWorkspaceImport: t.procedure.input(z.string().uuid()).mutation(({ input }) => {
    if (pendingImport?.token === input) pendingImport = undefined;
    return { discarded: true };
  }),
  importWorkspace: t.procedure.input(z.object({ token: z.string().uuid(), digest: z.string().length(64), revision: z.number().int().nonnegative() }).strict()).mutation(({ input }) => {
    if (!pendingImport || pendingImport.token !== input.token || pendingImport.value.digest !== input.digest) throw new Error('Review this import again before adding it.');
    const saved = mergeArchive(store, pendingImport.value, input.revision); pendingImport = undefined; return saved;
  }),
  diagnostics: t.procedure.mutation(async () => {
    const { runMcpSelfTest } = await import('@keel/mcp');
    const [codex, claude] = await Promise.all(['codex','claude'].map(async (name) => { try { return { ...await localAgentVersion(name) as any, ...(name === 'claude' ? await claudeSignInStatus() as any : {}) }; } catch (error) { return { provider: name, installed: false, message: error instanceof Error ? error.message : 'CLI unavailable' }; } }));
    const mcp = await runMcpSelfTest(path.join(app.getPath('userData'), 'agent-workspace'));
    return { checkedAt: new Date().toISOString(), storage: store.db.prepare('PRAGMA quick_check').get(), encryption: credentialEncryptionAvailable(), codex, claude, mcp, inference: 'not-performed', walletSigning: wallets.list().some(wallet => wallet.connection) ? 'connected' : 'not-connected' };
  }),
  checkCodex: t.procedure.mutation(async () => runLocalAgent('codex', '', path.join(app.getPath('userData'), 'agent-workspace'), { command: await localAgentCommand('codex'), diagnosticsOnly: true })),
  studioSettings: t.procedure.query(() => ({ url: (store.db.prepare("SELECT value FROM editor_settings WHERE key='studio-url'").get() as any)?.value ?? '' })),
  connectStudio: t.procedure.input(z.string().url().max(2048)).mutation(async ({ input }) => { const result = await inspectStudio(input); store.db.prepare("INSERT INTO editor_settings VALUES ('studio-url', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(result.studioUrl); return result; }),
  searchStudio: t.procedure.input(z.string().trim().min(1).max(160)).query(async ({ input }) => {
    const entry = store.db.prepare("SELECT value FROM editor_settings WHERE key='studio-url'").get() as any;
    if (!entry) throw new Error('Connect a Studio in Connections before searching its library.');
    return searchStudio(entry.value, input);
  }),
  agentChats: t.procedure.input(z.object({ archived: z.boolean().default(false), search: z.string().max(160).default(''), offset: z.number().int().min(0).default(0) }).strict()).query(({input})=>agents.store.list(input)),
  agentChat: t.procedure.input(z.string().uuid()).query(({input})=>agents.store.chat(input)),
  createAgentChat: t.procedure.input(chatOptions).mutation(({input})=>agents.create(input)),
  updateAgentChat: t.procedure.input(z.object({ id:z.string().uuid(), fields:chatPatch }).strict()).mutation(({input})=>agents.update(input.id,input.fields)),
  agentHistory: t.procedure.input(z.object({id:z.string().uuid(),before:z.number().int().positive().optional()}).strict()).query(({input})=>agents.store.history(input.id,input.before)),
  agentContext: t.procedure.input(z.object({id:z.string().uuid(),prompt:z.string().max(16000).default('')}).strict()).query(({input})=>agents.context(input.id,input.prompt)),
  agentView: t.procedure.input(viewSchema).mutation(({input})=>agents.setView(input)),
  startAgent: t.procedure.input(z.object({id:z.string().uuid(),prompt:z.string().trim().min(1).max(16000)}).strict()).mutation(({input})=>agents.start(input.id,input.prompt)),
  stopAgent: t.procedure.input(z.string().uuid()).mutation(({input})=>agents.stop(input)),
  applyAgentAction: t.procedure.input(z.object({id:z.string().uuid(),reviewed:z.literal(true)}).strict()).mutation(({input})=>agents.apply(input.id)),
  dismissAgentAction: t.procedure.input(z.string().uuid()).mutation(({input})=>agents.dismiss(input)),
  agentNavigationResult: t.procedure.input(z.object({id:z.string().uuid(),ok:z.boolean(),error:z.string().max(500).optional()}).strict()).mutation(({input})=>agents.navigationResult(input.id,input.ok,input.error)),
  walletExtensions: walletProcedure.query(async () => { await Promise.all(wallets.list().filter(record => record.connection).map(record => wallets.refresh(record.installationId).catch(() => null))); return ({ sources: WALLET_SOURCES, downloads: CURATED_WALLETS.map(({url,sha256,...source}) => source), installed: wallets.list() }); }),
  downloadWallet: walletProcedure.input(z.enum(['metamask', 'rabby', 'temple'])).mutation(({ input }) => downloadWallet(input, wallets.packages)),
  tezosWallets: walletProcedure.query(async () => {
    await Promise.all(tezosWallets.sessions().filter((row: any) => !row.pending).map((row: any) => tezosWallets.refresh(row.id).catch(() => null)));
    return { sessions: tezosWallets.sessions(), activity: tezosWallets.list() };
  }),
  connectTezosWallet: walletProcedure.input(z.object({ id: tezosWalletId, profileId: z.union([z.literal('tezos-mainnet'),z.literal(TEZOS_SHADOWNET.id),z.string().uuid()]) }).strict()).mutation(({input}) => tezosWallets.connect(input.id,input.profileId)),
  disconnectTezosWallet: walletProcedure.input(tezosWalletId).mutation(({input}) => tezosWallets.disconnect(input)),
  tezosWalletBalance: walletProcedure.input(tezosWalletId).query(({input}) => tezosWallets.balance(input)),
  verifyTezosWallet: walletProcedure.input(tezosWalletId).mutation(({input}) => tezosWallets.verify(input)),
  prepareTezosTransaction: walletProcedure.input(z.object({ walletId: tezosWalletId, label: z.string().trim().min(1).max(160), destination: z.string().max(64), amountMutez: z.string().regex(/^(0|[1-9][0-9]*)$/).max(30), entrypoint: z.string().max(31).optional(), parameters: z.string().max(200000).optional() }).strict()).mutation(({input}) => tezosWallets.prepare(input)),
  prepareTezosOperation: walletProcedure.input(z.object({ walletId: tezosWalletId, label: z.string().trim().min(1).max(160), operation: z.unknown() }).strict()).mutation(({input}) => tezosWallets.prepareOperation(input)),
  sendTezosTransaction: walletProcedure.input(z.object({ id: z.string().uuid(), reviewed: z.literal(true) }).strict()).mutation(({input}) => tezosWallets.send(input.id)),
  sendTezosOperation: walletProcedure.input(z.object({ id: z.string().uuid(), reviewed: z.literal(true) }).strict()).mutation(({input}) => tezosWallets.send(input.id)),
  cancelTezosTransaction: walletProcedure.input(z.string().uuid()).mutation(({input}) => tezosWallets.cancel(input)),
  cancelTezosOperation: walletProcedure.input(z.string().uuid()).mutation(({input}) => tezosWallets.cancel(input)),
  tezosReceipt: walletProcedure.input(z.string().uuid()).mutation(({input}) => tezosWallets.receipt(input)),
  connectWallet: walletProcedure.input(z.object({ id: z.string().uuid(), providerId: z.string().max(200).optional() }).strict()).mutation(({ input }) => wallets.connect(input.id, input.providerId)),
  refreshWallet: walletProcedure.input(z.string().uuid()).mutation(({ input }) => wallets.refresh(input)),
  disconnectWallet: walletProcedure.input(z.string().uuid()).mutation(({ input }) => wallets.disconnect(input)),
  walletBalance: walletProcedure.input(z.object({ id: z.string().uuid(), account: z.string().regex(/^0x[0-9a-fA-F]{40}$/), chainId: z.number().int().positive() }).strict()).query(({ input }) => wallets.request(input.id, 'eth_getBalance', [input.account, 'latest'], input)),
  switchWalletNetwork: walletProcedure.input(z.object({ id: z.string().uuid(), chainId: z.number().int().positive().safe() }).strict()).mutation(async ({ input }) => { await wallets.request(input.id, 'wallet_switchEthereumChain', [{ chainId: toHex(input.chainId) }]); return wallets.refresh(input.id); }),
  addWalletNetwork: walletProcedure.input(z.object({ id: z.string().uuid(), profileId: z.string().uuid(), symbol: z.string().trim().min(1).max(11) }).strict()).mutation(async ({ input }) => {
    const profile = networkProfile(input.profileId);
    if (profile.family !== 'ethereum') throw Error('Choose an EVM network for this wallet.');
    await inspectNetwork(profile);
    await wallets.request(input.id, 'wallet_addEthereumChain', [{ chainId: toHex(profile.chainId), chainName: profile.label, nativeCurrency: { name: input.symbol, symbol: input.symbol, decimals: 18 }, rpcUrls: [profile.rpcUrl] }]);
    return wallets.refresh(input.id);
  }),
  verifyWalletConnection: walletProcedure.input(z.object({ id: z.string().uuid(), account: z.string().regex(/^0x[0-9a-fA-F]{40}$/), chainId: z.number().int().positive() }).strict()).mutation(async ({ input }) => {
    const message = `KEEL wallet connection check\nAccount: ${input.account}\nChain: ${input.chainId}\nNonce: ${randomUUID()}\nThis message checks this local wallet connection. It does not authorize a transaction, login, or delegation.`;
    const signature = await wallets.request(input.id, 'personal_sign', [stringToHex(message), input.account], input);
    if (!await verifyMessage({ address: input.account as `0x${string}`, message, signature })) throw Error('Signature does not match the selected account.');
    return { verified: true, account: input.account, chainId: input.chainId, checkedAt: new Date().toISOString() };
  }),
  prepareWalletTransaction: walletProcedure.input(controlInput.extend({ installationId: z.string().uuid(), account: z.string().regex(/^0x[0-9a-fA-F]{40}$/), rpcUrl: z.string().url().max(2048) })).mutation(({ input }) => walletTransactions.prepare(input)),
  sendWalletTransaction: walletProcedure.input(z.object({ id: z.string().uuid(), reviewed: z.literal(true) }).strict()).mutation(({ input }) => walletTransactions.send(input.id)),
  cancelWalletTransaction: walletProcedure.input(z.string().uuid()).mutation(({ input }) => walletTransactions.cancel(input)),
  walletTransactions: walletProcedure.query(() => walletTransactions.list()),
  walletReceipt: walletProcedure.input(z.string().uuid()).mutation(({ input }) => walletTransactions.receipt(input)),
  walletBrowserInstall: t.procedure.input(z.enum(['metamask', 'rabby'])).mutation(async ({ input }) => { await shell.openExternal(WALLET_SOURCES.find((source) => source.id === input)!.url); return { opened: true }; }),
  reviewWalletExtension: walletProcedure.mutation(async () => {
    const selection = await dialog.showOpenDialog(window, { title: 'Select an unpacked wallet extension', properties: ['openDirectory'] });
    return selection.canceled || !selection.filePaths[0] ? null : wallets.packages.stage(selection.filePaths[0]);
  }),
  discardWalletExtension: walletProcedure.input(z.string().uuid()).mutation(async ({ input }) => { await wallets.packages.discard(input); return { discarded: true }; }),
  installWalletExtension: walletProcedure.input(z.object({ token: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), permissionsReviewed: z.literal(true) }).strict()).mutation(({ input }) => wallets.install(input.token, input.digest)),
  enableWalletExtension: walletProcedure.input(z.object({ id: z.string().uuid(), enabled: z.boolean() }).strict()).mutation(({ input }) => wallets.enabled(input.id, input.enabled)),
  openWalletExtension: walletProcedure.input(z.string().uuid()).mutation(({ input }) => wallets.open(input)),
  workspace: t.procedure.query(() => store.read()),
  save: t.procedure.input(z.object({ state: z.unknown(), revision: z.number().int().nonnegative() }).strict()).mutation(({ input }) => store.save(input.state, input.revision)),
  workspaceRevision: t.procedure.query(() => store.read().revision),
  workspaceConnection: t.procedure.query(() => ({connectionFile:path.join(app.getPath('userData'),'workspace-connection.json')})),
  createProject: t.procedure.input(z.object({ title: z.string().trim().min(1).max(160), template: z.enum(['image', 'edition', 'collection', 'interactive', 'layered', 'game']).optional(), revision: z.number().int() }).strict()).mutation(({ input }) => {
    const current = store.read(); const project = input.template ? newTemplateProject(input.title, input.template) : newProject(input.title);
    return store.save({ ...current.state, projects: [...current.state.projects, project] }, input.revision);
  }),
  catalog: t.procedure.query(() => ({ engine: KEEL_ENGINE_CATALOG, deployments: KEEL_DEPLOYMENTS, modules: KEEL_MODULES })),
  exportLayeredImage: t.procedure.input(z.object({name:z.string().max(160),dataUrl:z.string().max(90000000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/)}).strict()).mutation(async({input})=>{
    return saveRenderedImage(window,input.dataUrl,input.name);
  }),
  prepareLayerAsset: t.procedure.input(z.object({objectId:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int()}).strict()).mutation(async({input})=>{
    const current=store.read();if(current.revision!==input.revision)throw Error('Workspace changed. Reload before preparing a layer.');
    const source=current.state.objects.find((o:any)=>o.id===input.objectId);if(!source)throw Error('Original image is unavailable.');
    if(source.type!=='image/png')return {workspace:current,object:source,message:source.type==='image/webp'?'Using the original WebP. Its original encoding has not been certified lossless.':'Original preserved. Automatic lossless optimization supports PNG layers.'};
    try{await store.verifyObject(source.id);const converted:any=await layerImages.convert(store.object(source.id));const updated=store.importObject(converted.bytes,source.name,'image/png',input.revision);return {workspace:updated,object:updated.state.objects.find((o:any)=>o.id===converted.digest),message:`Lossless PNG verified · ${converted.originalBytes.toLocaleString()} → ${converted.storedBytes.toLocaleString()} bytes. Original PNG kept in Files.`,proof:{sourceDigest:converted.sourceDigest,imageStreamDigest:converted.imageStreamDigest,proof:converted.proof}};}catch(error){if(store.read().revision!==input.revision)throw error;return {workspace:store.read(),object:source,message:(error as Error).message};}
  }),
  prepareRasterAPNG: t.procedure.input(z.object({projectId:z.string().uuid(),frames:z.array(z.string().max(90000000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)).min(1).max(256),tokenId:z.string().regex(/^[0-9]+$/).max(100)}).strict().refine(v=>v.frames.reduce((n,s)=>n+s.length,0)<=90000000,'APNG exceeds the local preparation budget.')).mutation(async({input})=>{
    const project=store.read().state.projects.find((p:any)=>p.id===input.projectId);if(!project?.layered)throw Error('Open a layered project first.');
    if(project.layered.reveal.encrypted)throw Error('These layers are private until reveal. Plaintext APNG export is disabled.');
    const selected=await dialog.showOpenDialog(window,{title:'Save layer-build APNG',properties:['openDirectory','createDirectory']});if(selected.canceled||!selected.filePaths[0])return null;
    return rasterImages.prepare({kind:'apng',frames:input.frames.map(frame=>Buffer.from(frame.split(',')[1]!,'base64')),directory:path.join(selected.filePaths[0],`keel-apng-${randomUUID()}`),source:{projectId:project.id,tokenId:input.tokenId,manifest:project.layered}});
  }),
  prepareRasterPreview: t.procedure.input(z.object({projectId:z.string().uuid(),dataUrl:z.string().max(90000000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/),stripRows:z.number().int().min(1).max(256).default(16),tokenId:z.string().regex(/^[0-9]+$/).max(100)}).strict()).mutation(async({input})=>{
    const project=store.read().state.projects.find((p:any)=>p.id===input.projectId);if(!project?.layered)throw Error('Open a layered project first.');
    if(project.layered.reveal.encrypted)throw Error('These layers are private until reveal. Plaintext strip export is disabled.');
    const selected=await dialog.showOpenDialog(window,{title:'Prepare reusable PNG strips',properties:['openDirectory','createDirectory']});if(selected.canceled||!selected.filePaths[0])return null;
    return rasterImages.prepare({bytes:Buffer.from(input.dataUrl.split(',')[1]!,'base64'),stripRows:input.stripRows,directory:path.join(selected.filePaths[0],`keel-png-strips-${randomUUID()}`),source:{projectId:project.id,tokenId:input.tokenId,manifest:project.layered}});
  }),
  exportDirectImagePackage: t.procedure.input(z.string().uuid()).mutation(async({input})=>{
    const project=store.read().state.projects.find((p:any)=>p.id===input);if(!project?.layered)throw Error('Open a layered project first.');
    const selected=await dialog.showOpenDialog(window,{title:'Prepare direct image files',properties:['openDirectory','createDirectory']});if(selected.canceled||!selected.filePaths[0])return null;
    return exportDirectImagePackage(store,project,selected.filePaths[0]);
  }),
  exportLayeredSVG: t.procedure.input(z.object({projectId:z.string().uuid(),tokenId:z.string().regex(/^[0-9]+$/).max(100),overrides:z.record(z.string(),z.string()).default({}),variantOverrides:z.record(z.string(),z.string()).default({})}).strict()).mutation(async({input})=>{
    const current=store.read(),project=current.state.projects.find((p:any)=>p.id===input.projectId);if(!project?.layered)throw Error('Open a layered project first.');
    const selection=await selectLayeredArt(project.layered,project.layered.seed,input.tokenId,input.overrides,input.variantOverrides);
    const result=await renderLayeredSVG(project.layered,selection,async id=>{if(!project.objectIds.includes(id))throw Error('Layer is not attached.');await store.verifyObject(id);const object=current.state.objects.find((o:any)=>o.id===id);if(!object)throw Error('Layer missing.');return {bytes:store.object(id),type:object.type};});
    const selected=await dialog.showSaveDialog(window,{title:'Save layered SVG image',defaultPath:'artwork.svg',filters:[{name:'SVG image',extensions:['svg']}]});if(selected.canceled||!selected.filePath)return null;
    await writeFile(selected.filePath,result.source,{flag:'wx'});return {saved:true,message:'Saved a standalone SVG image. Use Save PNG for a PNG copy.'};
  }),
  exportLayeredPackage: t.procedure.input(z.string().uuid()).mutation(async ({input}) => {
    const project=store.read().state.projects.find((p:any)=>p.id===input);if(!project?.layered)throw Error('Layered project not found.');
    const selected=await dialog.showOpenDialog(window,{title:'Choose where to prepare the KEEL publication folder',properties:['openDirectory','createDirectory']});if(selected.canceled||!selected.filePaths[0])return null;
    return exportLayeredPackage(store,project,selected.filePaths[0],{available:credentialEncryptionAvailable,encrypt:(v:string)=>safeStorage.encryptString(v)},path.join(__dirname,'runtime-modules',`${project.runtimeModules.find((m:{id:string})=>/^keel-layered-runtime-v\d+$/.test(m.id))?.id ?? 'keel-layered-runtime-v4'}.js`));
  }),
  exportLayerCuration: t.procedure.input(z.string().uuid()).mutation(async({input})=>{const project=store.read().state.projects.find((p:any)=>p.id===input);if(!project?.layerCuration)throw Error('Create a candidate pool first.');const plan=await layerCurationPlan(project.layerCuration);const selected=await dialog.showSaveDialog(window,{title:'Save private collection set plan',defaultPath:'PRIVATE-keel-set-plan.json',filters:[{name:'Collection plan',extensions:['json']}]});if(selected.canceled||!selected.filePath)return null;await writeFile(selected.filePath,JSON.stringify(plan,null,2),{mode:0o600,flag:'wx'});return {saved:true};}),
  exportLayeredRecovery: t.procedure.input(z.string().uuid()).mutation(async ({input}) => {
    if(!credentialEncryptionAvailable())throw Error('OS-protected storage is unavailable.');
    const exists=store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='layered_secrets'").get();if(!exists)throw Error('Prepare an encrypted publication folder first.');
    const rows=store.db.prepare('SELECT encrypted FROM layered_secrets WHERE project_id=? ORDER BY rowid').all(input) as any[];if(!rows.length)throw Error('No prepared reveal keys for this project.');
    const selected=await dialog.showSaveDialog(window,{title:'Save PRIVATE reveal recovery keys — keep separate from publication',defaultPath:'PRIVATE-keel-reveal-keys.json'});if(selected.canceled||!selected.filePath)return null;
    await writeFile(selected.filePath,JSON.stringify({private:true,projectId:input,keys:rows.map(r=>JSON.parse(safeStorage.decryptString(Buffer.from(r.encrypted))))},null,2),{mode:0o600,flag:'wx'});return {saved:true};
  }),
  importAbi: t.procedure.mutation(async () => { const file = await chosenFile(512_000); return file ? { name: file.name, abi: parseContractAbi(file.bytes.toString('utf8')) } : null; }),
  importCreatorOperation: t.procedure.mutation(async () => {
    const file = await chosenFile(2_000_000); if (!file) return null;
    const operation = parseKeelCreatorOperationEnvelope(JSON.parse(file.bytes.toString('utf8')));
    if (!operation.readback) throw new Error('This creator operation has no recorded collection read-back yet. Keep it in recovery until the collection is identified.');
    const common = { chainId: operation.chainId, source: 'creator-operation' as const, notes: `Imported operation ${operation.operationId}; recorded creator ${operation.creator}. Imported receipts and authority require fresh chain verification.` };
    return [
      createTrackedContract({ ...common, address: operation.readback.tokenContract, name: `Collection ${operation.readback.collectionId}`, kind: 'collection', abi: [] }),
      createTrackedContract({ ...common, address: operation.factoryAddress, name: 'My creator factory', kind: 'default', abi: await moduleAbi('keel-die', 'KeelCreatorFactory') }),
      createTrackedContract({ ...common, address: operation.rendererAddress, name: 'My token renderer', kind: 'default', abi: await moduleAbi('keel-die', 'KeelArtifactTokenRenderer') }),
    ];
  }),
  importProjectFile: t.procedure.input(z.object({ revision: z.number().int() }).strict()).mutation(async ({ input }) => {
    const choice = await dialog.showOpenDialog(window, { title: 'Import a file or asset', properties: ['openFile'] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const next = await store.importFile(choice.filePaths[0], input.revision);
    const object = next.state.objects.at(-1)!;
    let source;
    if (object.byteLength <= MAX_SOURCE_BYTES && object.name.length <= 160 && !object.name.includes('\\') && ['text/html', 'text/css', 'text/javascript', 'application/json', 'text/plain'].includes(object.type)) {
      try { source = sourceFile({ name: object.name, bytes: store.object(object.id) }); } catch { /* Non-text bytes remain intact as an asset. */ }
    }
    return { workspace: next, object, source };
  }),
  importArtwork: t.procedure.input(z.object({ projectId: z.string().uuid(), revision: z.number().int() }).strict()).mutation(async ({ input }) => {
    const current = store.read();
    if (current.revision !== input.revision) throw Error('Your workspace changed. Save again before importing.');
    const project = current.state.projects.find((item: any) => item.id === input.projectId);
    if (!project) throw Error('Project not found.');
    const multiple = project.creation?.template === 'collection';
    const selection = await dialog.showOpenDialog(window, { title: multiple ? 'Add artwork to your collection' : 'Choose your artwork', properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'] });
    if (selection.canceled || !selection.filePaths.length) return null;
    let revision = input.revision; const errors: string[] = []; let imported = 0;
    for (const file of selection.filePaths) {
      try {
        const next = await store.importFile(file, revision); revision = next.revision;
        const draft = next.state.projects.find((item: any) => item.id === input.projectId)!;
        const updated = attachArtwork(draft, [next.state.objects.at(-1)!]);
        const saved = store.save({ ...next.state, projects: next.state.projects.map((item: any) => item.id === draft.id ? updated : item) }, revision);
        revision = saved.revision; imported++;
      } catch (error) { errors.push(`${path.basename(file)}: ${(error as Error).message}`); break; }
    }
    return { workspace: store.read(), imported, errors };
  }),
  importObject: t.procedure.input(z.object({ revision: z.number().int() }).strict()).mutation(async ({ input }) => {
    const choice = await dialog.showOpenDialog(window, { title: 'Import an asset — any file type', properties: ['openFile'] });
    return choice.canceled || !choice.filePaths[0] ? null : store.importFile(choice.filePaths[0], input.revision);
  }),
  importMetadata: t.procedure.mutation(async () => { const file = await chosenFile(2_000_000); return file ? { name: file.name, metadata: parseMetadata(file.bytes.toString('utf8')) } : null; }),
  exportMetadata: t.procedure.input(z.string().uuid()).mutation(async ({ input }) => {
    const project = store.read().state.projects.find((item: any) => item.id === input); if (!project) throw new Error('Project not found.');
    const selection = await dialog.showSaveDialog(window, { title: 'Export draft metadata', defaultPath: 'metadata.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (selection.canceled || !selection.filePath) return null;
    await writeFile(selection.filePath, JSON.stringify(metadataDocument(project), null, 2)); return { name: path.basename(selection.filePath) };
  }),
  checkProject: t.procedure.input(z.object({ projectId: z.string().uuid(), onchain: z.boolean().default(false) }).strict()).mutation(async ({ input }) => {
    const snapshot = store.read(); const project = snapshot.state.projects.find((item: any) => item.id === input.projectId); if (!project) throw new Error('Project not found.');
    const result: any = await checkLocalProject(project, snapshot.state.objects, (id: string) => store.verifyObject(id));
    if (input.onchain) {
      if (!project.publication || !project.targetNetworkId) throw new Error('Save the published token and choose its network before running an onchain check.');
      result.onchain = await checkPublishedMetadata(networkProfile(project.targetNetworkId), project.publication);
      if (result.onchain.document) result.onchain.checks.push({ id: 'draft-match', title: 'Published metadata matches this draft', status: sameState(result.onchain.document, metadataDocument(project)) ? 'pass' : 'attention', detail: sameState(result.onchain.document, metadataDocument(project)) ? 'The JSON values match the saved draft.' : 'The published document differs. Review it before preparing an update or adopting it as the draft.' });
    }
    store.db.prepare('INSERT INTO project_checks (project_id, fingerprint, body) VALUES (?,?,?)').run(input.projectId, result.fingerprint, JSON.stringify(result));
    store.db.prepare('DELETE FROM project_checks WHERE project_id=? AND id NOT IN (SELECT id FROM project_checks WHERE project_id=? ORDER BY id DESC LIMIT 10)').run(input.projectId, input.projectId);
    return result;
  }),
  projectChecks: t.procedure.input(z.string().uuid()).query(({ input }) => {
    const project = store.read().state.projects.find((item: any) => item.id === input); if (!project) throw new Error('Project not found.');
    return (store.db.prepare('SELECT fingerprint, body FROM project_checks WHERE project_id=? ORDER BY id DESC LIMIT 10').all(input) as any[]).map((row) => ({ ...JSON.parse(row.body), current: row.fingerprint === projectFingerprint(project) }));
  }),
  projectPresentation: t.procedure.input(z.string().uuid()).query(async ({ input }) => { const project = store.read().state.projects.find((item: any) => item.id === input); if (!project) throw new Error('Project not found.'); const result = project.game ? await gameEngine.presentation(project) : await previewFor(project); return { ...result, html: undefined }; }),
  exportObject: t.procedure.input(z.string().regex(/^[a-f0-9]{64}$/)).mutation(async ({ input }) => {
    const object = store.read().state.objects.find((item: any) => item.id === input); if (!object) throw new Error('Object not found.');
    await store.verifyObject(input);
    const selected = await dialog.showSaveDialog(window, { title: 'Export original bytes', defaultPath: object.name });
    if (selected.canceled || !selected.filePath) return null;
    const temporary = `${selected.filePath}.${randomUUID()}.tmp`;
    try { const file = store.objectFile(input); if (file) await copyFile(file, temporary); else await writeFile(temporary, store.object(input), { flag: 'wx', mode: 0o600 }); await rename(temporary, selected.filePath); } finally { await rm(temporary, { force: true }); }
    return { saved: true, name: object.name, byteLength: object.byteLength };
  }),
  defaultContract: t.procedure.input(z.number().int().nonnegative()).query(async ({ input }) => {
    const deployment = KEEL_DEPLOYMENTS[input]; if (!deployment) throw new Error('Choose a recorded deployment.');
    return createTrackedContract({ chainId: deployment.chainId, address: deployment.address, name: `${deployment.contract} · ${deployment.instance}`, kind: 'default', source: 'sdk-deployment', abi: await moduleAbi(deployment.module, deployment.contract), notes: `SDK deployment record, ${deployment.module}. Historical record; verify live code and roles.` });
  }),
  contractReview: t.procedure.input(controlInput).mutation(({ input }) => prepareContractControl({ ...input, contract: createTrackedContract(input.contract as never) })),
  contractRead: t.procedure.input(controlInput.extend({ rpcUrl: z.string().url().max(2048) })).mutation(({ input }) => readControl(input)),
  svgRendererExport:t.procedure.input(z.object({recipe:z.unknown()}).strict()).mutation(async({input})=>{
    const prepared=prepareSVGRenderer(input.recipe);
    const selected=await dialog.showSaveDialog(window,{title:'Export SVG renderer',defaultPath:prepared.fileName,filters:[{name:'Solidity',extensions:['sol']}]});
    if(selected.canceled||!selected.filePath)return null;
    await writeFile(selected.filePath,prepared.solidity);return {fileName:prepared.fileName,status:'exported',deployed:false};
  }),
  contractSimulate: t.procedure.input(controlInput.extend({ rpcUrl: z.string().url().max(2048), account: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })).mutation(({ input }) => simulateControl(input)),
  contractInspect: t.procedure.input(z.object({ contract: z.unknown(), rpcUrl: z.string().url().max(2048) }).strict()).mutation(({ input }) => inspectContract(input.contract, input.rpcUrl)),
  discoverCreator: t.procedure.input(z.object({ chainId: z.number().int().positive(), factoryAddress: z.string().max(42), creator: z.string().max(42), rpcUrl: z.string().url().max(2048) }).strict()).query(({ input }) => discoverCreatorContracts(input)),
  discoverProjectCollections: t.procedure.input(z.object({ profileId: z.string().uuid(), creator: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).strict()).query(async ({ input }) => {
    const profile = networkProfile(input.profileId);
    if (profile.family !== 'ethereum') throw Error('Collection discovery needs a supported factory on this network.');
    const addresses = new Set(KEEL_DEPLOYMENTS.filter(item => item.chainId === profile.chainId && item.contract === 'KeelCreatorFactory').map(item => item.address.toLowerCase()));
    for (const contract of store.read().state.contracts) if (contract.chainId === profile.chainId && contract.abi.some((item: any) => item.type === 'function' && item.name === 'creatorCollectionCount')) addresses.add(contract.address.toLowerCase());
    const found = await Promise.allSettled([...addresses].slice(0, 8).map(factoryAddress => discoverCreatorContracts({ chainId: profile.chainId, rpcUrl: profile.rpcUrl, creator: input.creator, factoryAddress })));
    return { results: found.flatMap(item => item.status === 'fulfilled' ? [item.value] : []), errors: found.flatMap(item => item.status === 'rejected' ? [String(item.reason?.message ?? item.reason)] : []), factories: Math.min(addresses.size, 8), truncated: addresses.size > 8 };
  }),
  connections: t.procedure.query(() => ({ openai: keyAvailable('openai'), anthropic: keyAvailable('anthropic'), encryption: credentialEncryptionAvailable() })),
  saveKey: t.procedure.input(z.object({ provider: keyProvider, key: z.string().min(16).max(4096) }).strict()).mutation(({ input }) => {
    if (!credentialEncryptionAvailable()) throw new Error('Operating system credential encryption is unavailable.');
    store.db.prepare('INSERT INTO credentials VALUES (?, ?) ON CONFLICT(provider) DO UPDATE SET encrypted=excluded.encrypted').run(input.provider, safeStorage.encryptString(input.key));
    return { saved: true };
  }),
  deleteKey: t.procedure.input(keyProvider).mutation(({ input }) => { store.db.prepare('DELETE FROM credentials WHERE provider=?').run(input); return { removed: true }; }),
  ...gameProcedures(t, () => gameEngine),
  ...builderProcedures(t, () => gameBuilder, () => store),
  ...codecProcedures(t, () => gameCodec, () => store),
  ...soundProcedures(t, () => gameSound),
  ...levelProcedures(t, () => gameLevel, () => store),
  ...alphaProcedures(t, { engine: () => gameEngine, store: () => store, paths: gamePaths, logs, newProject: (title: string) => newTemplateProject(title, 'game'), navigate: (projectId: string) => { if (window && !window.isDestroyed()) window.webContents.send('keel:agent-event', { type: 'workspace-navigate', target: { page: 'Projects', projectId, tab: 'Game' } }); }, openLink: (url: string) => shell.openExternal(url), versions: () => ({ editor: app.getVersion(), electron: process.versions.electron ?? '', chrome: process.versions.chrome ?? '', node: process.versions.node, platform: `${process.platform} ${process.arch}`, sdkRoot: gamePaths().sdkRoot }) }),
});

export type AppRouter = typeof router;
const paths = new Set(Object.keys(router._def.procedures));

async function start() {
  const dataDir = process.env.KEEL_DESKTOP_DATA_DIR;
  if (dataDir && path.isAbsolute(dataDir)) app.setPath('userData', dataDir);
  await app.whenReady();
  await mkdir(path.join(app.getPath('userData'), 'agent-workspace'), { recursive: true, mode: 0o700 });
  store = new WorkspaceStore(path.join(app.getPath('userData'), 'workspace.sqlite'));
  const connectionDirectory = await mkdtemp(path.join(tmpdir(), 'keel-workspace-'));
  const workspaceSocket = process.platform === 'win32' ? `\\\\.\\pipe\\keel-workspace-${randomUUID()}` : path.join(connectionDirectory, 'workspace.sock');
  workspaceService = await serveWorkspace({store,socketPath:workspaceSocket,changed:()=>{if(window&&!window.isDestroyed())window.webContents.send('keel:agent-event',{type:'workspace'});},openProject:(projectId:string)=>{
    if(!window||window.isDestroyed())throw Error('The editor window is not available.');
    window.show();window.focus();window.webContents.send('keel:agent-event',{type:'workspace-navigate',target:{page:'Projects',projectId,tab:'Preview'}});
  }});
  await writeFile(path.join(app.getPath('userData'), 'workspace-connection.json'), JSON.stringify({socketPath:workspaceSocket,pid:process.pid}), {mode:0o600});
  store.db.exec('CREATE TABLE IF NOT EXISTS credentials (provider TEXT PRIMARY KEY, encrypted BLOB NOT NULL)');
  store.db.exec('CREATE TABLE IF NOT EXISTS editor_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  store.db.exec('CREATE TABLE IF NOT EXISTS project_checks (id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, fingerprint TEXT NOT NULL, body TEXT NOT NULL)');
  store.db.exec('CREATE TABLE IF NOT EXISTS network_profiles (id TEXT PRIMARY KEY, label TEXT NOT NULL, family TEXT NOT NULL, chain_identity TEXT NOT NULL, encrypted BLOB NOT NULL)');
  canonicalShell = JSON.parse(await readFile(path.join(__dirname, 'canonical-shell.json'), 'utf8'));
  for (const part of ['prefix', 'suffix']) canonicalShell[part].bytes = Buffer.from(canonicalShell[part].bytes, 'base64');
  previews = new PreviewService({ workerPath: path.join(__dirname, 'preview-worker.cjs'), databasePath: path.join(app.getPath('userData'), 'workspace.sqlite'), objectDirectory: store.objectDirectory!, shell: canonicalShell, runtimeDirectory: path.join(__dirname, 'runtime-modules') });
  const games = gamePaths();
  await mkdir(games.gamesDir, { recursive: true });
  try { linkGamesFolder({ sdkRoot: games.sdkRoot, gamesDir: games.gamesDir }); } catch (error) { console.warn(`Your games folder can't reach the engine yet: ${(error as Error).message}`); }
  gameEngine = new GameEngineService({ workerPath: path.join(__dirname, 'game-engine-worker.mjs'), shell: canonicalShell, chainDir: games.chainDir, projects: [...findGameProjects([path.resolve(app.getAppPath(), '../../examples/game-engine'), path.resolve(__dirname, '../../../examples/game-engine')]), games.gamesDir], ...findGameEngineRoot([path.resolve(app.getAppPath(), '../../../keel-engine'), path.resolve(__dirname, '../../../../keel-engine')], [engineLockOf(games).dir]) });
  gameBuilder = new GameBuilderService({ workerPath: path.join(__dirname, 'game-builder-worker.mjs'), engine: gameEngine });
  gameCodec = new GameCodecService({ workerPath: path.join(__dirname, 'game-codec-worker.mjs'), engine: gameEngine });
  gameSound = new GameSoundService({ workerPath: path.join(__dirname, 'game-sound-worker.mjs'), engine: gameEngine });
  gameLevel = new GameLevelService({ workerPath: path.join(__dirname, 'game-level-worker.mjs'), engine: gameEngine });
  wallets = new WalletRuntime(store.db, path.join(app.getPath('userData'), 'wallet-extensions'));
  walletTransactions = new WalletTransactions(store.db, wallets, {
    encrypt: (value: string) => { if (!credentialEncryptionAvailable()) throw Error('Operating system encryption is required for wallet transaction recovery.'); return safeStorage.encryptString(value); },
    decrypt: (value: Uint8Array) => safeStorage.decryptString(Buffer.from(value)),
  });
  tezosWallets = new TezosWallets(store.db, async (id: string, method: string, input: any, show = false) => {
    let surface: BrowserWindow;
    if (id === 'beacon') {
      if (!beaconBrowser) {
        const profile = session.fromPartition('persist:keel-beacon');
        profile.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
        profile.setPermissionCheckHandler(()=>false);
        profile.on('will-download',event=>event.preventDefault());
        beaconBrowser = new WalletBrowser(profile,'KEEL · Tezos wallets');
      }
      surface = await beaconBrowser.beaconWindow(show);
    } else surface = await wallets.tezosSurface(id,show);
    const result = await invokeWalletPage(surface,TEZOS_PAGE,`window.keelTezos.request(${JSON.stringify(method)},${JSON.stringify(input ?? null)})`);
    if (result.error) throw Object.assign(new Error(result.error.message),{code:result.error.code});
    return result.result;
  }, networkProfile, {
    encrypt: (value: string) => { if (!credentialEncryptionAvailable()) throw Error('Operating system encryption is required for transaction recovery.'); return safeStorage.encryptString(value); },
    decrypt: (value: Uint8Array) => safeStorage.decryptString(Buffer.from(value)),
  });
  // Restore optional extensions without holding up the editor's first paint.
  // Extension actions still wait for integrity verification to finish.
  walletRestore = wallets.restore();
  void walletRestore.catch(() => {}); // The wallet procedures surface any restore failure.
  const assets: Record<string, string> = { '/index.html': 'text/html', '/renderer.js': 'text/javascript', '/styles.css': 'text/css', '/StratusText-Regular.woff2': 'font/woff2', '/StratusTitle-Regular.woff2': 'font/woff2' };
  protocol.handle('keel-editor', async (request) => {
    const url = new URL(request.url); const type = assets[url.pathname];
    if (url.host !== 'app' || !type) return new Response('Not found', { status: 404 });
    const bytes = await readFile(path.join(__dirname, url.pathname.slice(1)));
    return new Response(bytes, { headers: { 'content-type': type, 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: keel-asset: keel-cover:; media-src data:; frame-src keel-preview: keel-asset:; connect-src keel-asset:; base-uri 'none'; form-action 'none'" } });
  });
  const shellHeaders = { 'content-type': 'text/html', 'access-control-allow-origin': '*', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; font-src data:; img-src data: blob:; media-src data: blob:; frame-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-pointer-lock" };
  const previewFailure = (error: unknown) => new Response(`<p style="padding:24px;font:14px system-ui;color:#cad2ee;background:#090b13">${String(error instanceof Error ? error.message : error).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`, { status: 422, headers: shellHeaders });
  const coverCache = new Map<string, { bytes: Buffer; type: string; at: number }>();
  protocol.handle('keel-cover', async (request) => {
    const url = new URL(request.url);
    const project = store.read().state.projects.find((item: any) => item.id === url.hostname);
    if (!project || url.pathname !== '/image' || !project.metadata.image) return new Response('Cover unavailable', { status: 404 });
    try {
      const key = project.metadata.image;
      let cached = coverCache.get(key);
      if (!cached || Date.now() - cached.at > 300_000) {
        const loaded = await remoteBytes(key, 12_000_000);
        if (!/^image\/(png|jpeg|gif|webp|avif|svg\+xml|bmp)$/.test(loaded.type)) throw new Error('The cover URL did not return an image.');
        cached = { ...loaded, at: Date.now() };
        coverCache.delete(key); coverCache.set(key, cached);
        while (coverCache.size > 24 || [...coverCache.values()].reduce((sum, item) => sum + item.bytes.length, 0) > 48_000_000) coverCache.delete(coverCache.keys().next().value!);
      }
      return new Response(new Uint8Array(cached.bytes), { headers: { 'content-type': cached.type, 'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff' } });
    } catch { return new Response('Cover could not be loaded. Import an image or check the metadata URI.', { status: 422 }); }
  });
  protocol.handle('keel-asset', async (request) => {
    const url = new URL(request.url);
    const object = store.read().state.objects.find((item: any) => item.id === url.hostname);
    if (!object) return new Response('Asset not found.', { status: 404 });
    if (url.pathname === '/raw') return objectResponse(object, request);
    if (url.pathname !== '/view') return new Response('Not found.', { status: 404 });
    try { const preview = await previewFor({ id: `asset-${object.id}`, files: [], objectIds: [object.id], presentation: { shell: 'canonical', delivery: 'auto', entryObjectId: object.id } }); return new Response(preview.html, { headers: shellHeaders }); } catch (error) { return previewFailure(error); }
  });
  protocol.handle('keel-preview', async (request) => {
    const url = new URL(request.url); const projectId = url.hostname;
    if (projectId === BUILDER_PREVIEW_HOST) { try { return new Response(await gameBuilder.preview(), { headers: BUILDER_PREVIEW_HEADERS }); } catch (error) { return previewFailure(error); } }
    if (projectId === SOUND_PREVIEW_HOST) { try { return new Response(await gameSound.page(), { headers: SOUND_PREVIEW_HEADERS }); } catch (error) { return previewFailure(error); } }
    if (projectId === LEVEL_PREVIEW_HOST) { try { return new Response(await gameLevel.page(), { headers: LEVEL_PREVIEW_HEADERS }); } catch (error) { return previewFailure(error); } }
    const project = store.read().state.projects.find((p: { id: string }) => p.id === projectId);
    if (!project) return new Response('Project not found.', { status: 404 });
    const name = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
    if (name === 'index.html' && isGameProject(project)) { try { return new Response(new Uint8Array(await gameEngine.document(project)), { headers: shellHeaders }); } catch (error) { return previewFailure(error); } }
    if (name === 'index.html' && project.presentation.shell === 'canonical') {
      try { return new Response((await previewFor(project)).html, { headers: shellHeaders }); } catch (error) { return previewFailure(error); }
    }
    if (name === 'index.html' && project.presentation.entryObjectId) {
      const object = store.read().state.objects.find((item: any) => item.id === project.presentation.entryObjectId);
      if (object) return objectResponse(object, request);
    }
    if (name.startsWith('objects/')) {
      const id = name.slice(8); const object = store.read().state.objects.find((object: { id: string }) => object.id === id);
      if (!object || !project?.objectIds.includes(id)) return new Response('Object is not attached to this project.', { status: 404 });
      return objectResponse(object, request);
    }
    const file = name === 'index.html' && project.layered ? {type:'text/html',content:layeredHTML(project.layered,undefined,true,Object.fromEntries(store.read().state.objects.map((o:any)=>[o.id,o.type])))} : project?.files.find((f: { name: string }) => f.name === name);
    if (!file && project.runtimeModules?.length) {
      try {
        const modules = await loadRuntimeModules(project.runtimeModules, path.join(__dirname, 'runtime-modules'));
        const module = modules.find(item => item.aliases.includes(name));
        if (module) return new Response(new Uint8Array(module.bytes), { headers: { 'content-type': module.mediaType, 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
      } catch (error) { return previewFailure(error); }
    }
    if (!file) return new Response('Save an index.html file to preview this project.', { status: 404 });
    const origin = `keel-preview://${projectId}`;
    return new Response(file.type === 'text/html' ? directRuntimeImports(file.content, project.runtimeModules, origin) : file.content, { headers: { 'content-type': file.type, 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' ${origin}; style-src 'unsafe-inline' ${origin}; img-src data: ${origin}; media-src data: ${origin}; connect-src ${origin}; frame-src 'none'; worker-src blob: ${origin}; base-uri 'none'; form-action 'none'; sandbox allow-scripts` } });
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => callback(allowGamePermission(permission, details, webContents)));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['keel-editor:', 'keel-preview:', 'keel-asset:', 'keel-cover:', 'data:', 'blob:', 'about:'].includes(new URL(details.url).protocol) }));
  window = new BrowserWindow({ show: process.env.KEEL_DESKTOP_TEST_HIDDEN !== '1', width: 1512, height: 982, minWidth: 920, minHeight: 640, title: 'KEEL Editor', backgroundColor: '#0c0d10', titleBarStyle: 'hiddenInset', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, { type: 'question', title: 'Unsaved project changes', message: 'Keep editing to save your project changes.', buttons: ['Keep editing', 'Close without saving'], defaultId: 0, cancelId: 0, noLink: true });
    if (choice === 1) event.preventDefault();
  });
  const caller = router.createCaller({});
  agents = new AgentService({ workspace:store, emit:(event:any)=>{if(window&&!window.isDestroyed())window.webContents.send('keel:agent-event',event);}, hooks:{
    workRoot:path.join(app.getPath('userData'),'agent-workspace'), readKey,
    networks:()=>store.db.prepare('SELECT id,label,family,chain_identity AS chainIdentity FROM network_profiles').all(),
    wallets:()=>({evm:wallets.list().map(item=>({installationId:item.installationId,name:item.name,connection:item.connection})),tezos:tezosWallets.sessions().map((item:any)=>({id:item.id,address:item.address,network:item.network}))}),
    checkProject:(projectId:string)=>caller.checkProject({projectId,onchain:false}),
    preview:(projectId:string)=>caller.projectPresentation(projectId),
    findModules:(query:string)=>caller.searchStudio(query),
    networkStatus:(id:string)=>caller.liveNetwork(id),
    readContract:(input:any)=>caller.contractRead({contract:input.contract,signature:input.signature,args:input.args,rpcUrl:networkProfile(input.profileId).rpcUrl}),
    openWallet:async(id:string)=>{await walletRestore;await wallets.open(id);return {opened:true};},
    prepareTransaction:(input:any)=>caller.prepareWalletTransaction({contract:input.contract,signature:input.signature,args:input.args,valueWei:input.valueWei,installationId:input.installationId,account:input.account,rpcUrl:networkProfile(input.profileId).rpcUrl}),
    prepareTezos:(input:any)=>caller.prepareTezosTransaction(input),
    prepareTezosOperation:(input:any)=>caller.prepareTezosOperation(input),
    sendTransaction:(id:string)=>caller.sendWalletTransaction({id,reviewed:true}),
    sendTezos:(id:string)=>caller.sendTezosTransaction({id,reviewed:true}),
    cancelReview:(family:string,id:string)=>family==='tezos'?caller.cancelTezosTransaction(id):caller.cancelWalletTransaction(id),
    game:gameEngine,
    gameBuilder,
    gameCodec,
    gameSound,
    gameLevel,
  }});
  ipcMain.handle('keel:request', async (event, value: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== UI) throw new Error('Untrusted editor request.');
    const request = z.object({ path: z.string(), input: z.unknown().optional() }).strict().parse(value);
    if (!paths.has(request.path)) throw new Error('Unknown editor operation.');
    return (caller as any)[request.path](request.input);
  });
  window.webContents.on('context-menu',(_event,params)=>{if(params.mediaType==='image'&&params.srcURL.startsWith('data:image/png;base64,')){Menu.buildFromTemplate([{label:'Save image as PNG…',click:()=>{void saveRenderedImage(window,params.srcURL).catch(error=>dialog.showErrorBox('Image could not be saved',error.message));}}]).popup({window});}});
  await window.loadURL(UI);
}
if (process.env.KEEL_DESKTOP_DATA_DIR && path.isAbsolute(process.env.KEEL_DESKTOP_DATA_DIR)) app.setPath('userData', process.env.KEEL_DESKTOP_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
else { app.on('second-instance', () => { window?.show(); window?.focus(); }); void start().catch((error) => { console.error(error); app.quit(); }); }
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { agents?.close(); });
app.on('will-quit', () => { void workspaceService?.close(); layerImages.close(); rasterImages.close(); previews?.close(); gameEngine?.close(); gameBuilder?.close(); gameCodec?.close(); gameSound?.close(); gameLevel?.close(); store?.close(); });
