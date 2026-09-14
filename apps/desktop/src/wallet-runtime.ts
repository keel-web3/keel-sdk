import { BrowserWindow, session, type Session } from 'electron';
import { WalletExtensionPackages } from './wallet-extensions.mjs';
import { WalletBrowser } from './wallet-browser';
import { WALLET_PAGE } from './wallet-provider-page.mjs';
import { invokeWalletPage } from './wallet-bridge';
import { access, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Each installation retains its own vault/cookies, even while disabled.
export class WalletRuntime {
  packages: WalletExtensionPackages;
  private profiles = new Map<string, Session>();
  private browsers = new Map<string, WalletBrowser>();
  private connections = new Map<string, { providerId: string; accounts: string[]; chainId: number }>();
  private pending = new Set<string>();
  private windows = new Map<string, BrowserWindow>();
  private status = new Map<string, { loaded: boolean; extensionId?: string; error?: string }>();
  constructor(private db: any, private root: string) {
    this.packages = new WalletExtensionPackages(root);
    db.exec('CREATE TABLE IF NOT EXISTS wallet_extensions (id TEXT PRIMARY KEY, record TEXT NOT NULL)');
  }
  records(): any[] { return this.db.prepare('SELECT record FROM wallet_extensions ORDER BY id').all().map((row: any) => JSON.parse(row.record)); }
  list() { return this.records().map((record) => ({ ...record, ...this.status.get(record.installationId), connection: this.connections.get(record.installationId), pending: this.pending.has(record.installationId), signingBridge: this.connections.has(record.installationId) ? 'connected' : 'not-connected' })); }
  private save(record: any) { this.db.prepare('INSERT INTO wallet_extensions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(record.installationId, JSON.stringify(record)); }
  private profile(id: string, imported = false) {
    if (this.profiles.has(id)) return this.profiles.get(id)!;
    const profile = imported ? session.fromPath(path.join(this.root, 'profiles', id)) : session.fromPartition(`persist:keel-wallet-${id}`);
    profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    profile.setPermissionCheckHandler(() => false);
    profile.on('will-download', (event) => event.preventDefault());
    profile.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const ownExtension = url.protocol === 'chrome-extension:' && !!profile.extensions.getExtension(url.hostname);
      const localRpc = ['http:', 'ws:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      callback({ cancel: !(['https:', 'wss:', 'data:', 'blob:', 'about:'].includes(url.protocol) || localRpc || ownExtension) });
    });
    this.profiles.set(id, profile); return profile;
  }
  private async load(record: any) {
    try {
      await this.packages.verify(record);
      let packagePath = this.packages.directory(record.installationId);
      if (record.preservedPackagePath) {
        // An adopted unpacked wallet's ID is derived from its original path.
        // Keep that exact identity; the immutable backup can restore its code if
        // the old temporary location is cleared. Never replace existing bytes.
        if (!record.importedProfile || !path.isAbsolute(record.preservedPackagePath)) throw Error('Invalid preserved wallet installation.');
        packagePath = record.preservedPackagePath;
        try { await access(packagePath); } catch {
          await mkdir(path.dirname(packagePath), { recursive: true, mode: 0o700 });
          await cp(this.packages.directory(record.installationId), packagePath, { recursive: true, force: false, errorOnExist: true });
        }
        await this.packages.verifyDirectory(packagePath, record.digest);
      }
      const profile = this.profile(record.installationId, record.importedProfile === true);
      const browser = this.browsers.get(record.installationId) ?? new WalletBrowser(profile, record.name);
      this.browsers.set(record.installationId, browser);
      // Allow extension startup requests only after Electron determines the package identity.
      const extension = await profile.extensions.loadExtension(packagePath, { allowFileAccess: false });
      browser.extensionId = extension.id;
      if (record.extensionId && record.extensionId !== extension.id) { profile.extensions.removeExtension(extension.id); throw new Error('Extension identity changed. The original wallet profile is preserved.'); }
      this.status.set(record.installationId, { loaded: true, extensionId: extension.id });
      this.save({ ...record, extensionId: extension.id });
    } catch (error) { this.status.set(record.installationId, { loaded: false, error: error instanceof Error ? error.message : 'Extension failed to load.' }); }
  }
  async restore() {
    await this.packages.clearAbandonedReviews();
    for (const record of this.records()) if (record.enabled) await this.load(record);
  }
  async install(token: string, digest: string) {
    if (this.records().some((record) => record.digest === digest)) throw new Error('This exact extension is already installed. Enable its existing profile.');
    const record = await this.packages.install(token, digest);
    this.save(record); await this.load(record); return this.list();
  }
  async enabled(id: string, enabled: boolean) {
    if (this.pending.has(id)) throw Error('Finish or reject the pending request in your wallet first.');
    const record = this.records().find((record) => record.installationId === id);
    if (!record) throw new Error('Unknown installed extension.');
    if (enabled && this.status.get(id)?.loaded) return this.list();
    this.save({ ...record, enabled });
    if (enabled) await this.load({ ...record, enabled });
    else {
      this.connections.delete(id); this.browsers.get(id)?.close();
      this.windows.get(id)?.close(); this.windows.delete(id);
      const extensionId = this.status.get(id)?.extensionId;
      if (extensionId) this.profiles.get(id)?.extensions.removeExtension(extensionId);
      this.status.set(id, { loaded: false });
    }
    return this.list();
  }
  async open(id: string) {
    const record = this.records().find((record) => record.installationId === id);
    const status = this.status.get(id);
    if (!record?.enabled || !status?.loaded || !status.extensionId) throw new Error('Enable this extension before opening it.');
    if (!record.entryPage) throw new Error('This extension declares no start page supported by this editor. Use its normal browser version.');
    await this.packages.verify(record);
    const approval = [...this.browsers.get(id)!.windows.values()].find(window => !window.isDestroyed() && /\/(notification|confirm)\.html/.test(window.webContents.getURL()));
    if (approval) { approval.show(); approval.focus(); return { opened: true }; }
    const existing = this.windows.get(id); if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return { opened: true }; }
    const origin = `chrome-extension://${status.extensionId}/`;
    // MetaMask's full start page handles onboarding and recovery; its small action
    // popup is intended for an already configured wallet.
    const page = record.startPage ?? record.entryPage;
    const window = await this.browsers.get(id)!.create(origin + page, { width: 520, height: 800 });
    window.on('closed', () => this.windows.delete(id));
    this.windows.set(id, window);
    return { opened: true };
  }
  private async surface(id: string) {
    if (!this.status.get(id)?.loaded || !this.records().some(record => record.installationId === id && record.enabled)) throw Error('Enable this wallet first.');
    return this.browsers.get(id)!.providerWindow();
  }
  async tezosSurface(id: string, show = false) {
    if (!this.status.get(id)?.loaded || !this.records().some(record => record.installationId === id && record.enabled)) throw Error('Enable this wallet first.');
    return this.browsers.get(id)!.beaconWindow(show);
  }
  private async invoke(id: string, providerId: string, method: string, params: any[] = []) {
    const window = await this.surface(id);
    if (window.webContents.getURL() !== WALLET_PAGE) throw Error('Wallet connection page changed. Reconnect your wallet.');
    const result = await invokeWalletPage(window, WALLET_PAGE, `window.keelWallet.request(${JSON.stringify(providerId)},${JSON.stringify(method)},${JSON.stringify(params)})`);
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.result;
  }
  async discover(id: string) {
    const window = await this.surface(id);
    for (let attempt = 0; attempt < 30; attempt++) {
      const providers = await window.webContents.executeJavaScript('window.keelWallet?.discover()');
      if (providers?.length) return providers;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('This extension has not provided an EVM wallet connection. Finish its setup, then try again.');
  }
  async connect(id: string, providerId?: string) {
    if (this.pending.has(id)) throw Error('Finish the open wallet request first.');
    this.pending.add(id);
    try {
      const providers = await this.discover(id);
      if (!providerId && providers.length > 1) return { providers };
      providerId ??= providers[0].id;
      const accounts = await this.invoke(id, providerId!, 'eth_requestAccounts');
      if (!Array.isArray(accounts) || !accounts.length || accounts.some(account => !/^0x[0-9a-fA-F]{40}$/.test(account))) throw Error('The wallet did not share an EVM account.');
      const chainId = Number(BigInt(await this.invoke(id, providerId!, 'eth_chainId')));
      if (!Number.isSafeInteger(chainId) || chainId < 1) throw Error('The wallet returned an invalid network.');
      this.connections.set(id, { providerId: providerId!, accounts, chainId });
      return { connection: this.connections.get(id) };
    } finally { this.pending.delete(id); }
  }
  async refresh(id: string) {
    const connection = this.connections.get(id);
    if (!connection) return null;
    try {
      const accounts = await this.invoke(id, connection.providerId, 'eth_accounts');
      const chainId = Number(BigInt(await this.invoke(id, connection.providerId, 'eth_chainId')));
      if (!Array.isArray(accounts) || accounts.some(account => !/^0x[0-9a-fA-F]{40}$/.test(account)) || !Number.isSafeInteger(chainId) || chainId < 1) throw Error('Invalid wallet connection.');
      if (!accounts.length) { this.connections.delete(id); return null; }
      const next = { ...connection, accounts, chainId }; this.connections.set(id, next); return next;
    } catch (error) { this.connections.delete(id); throw error; }
  }
  async disconnect(id: string) {
    if (this.pending.has(id)) throw Error('Reject or finish the open request in your wallet first.');
    const connection = this.connections.get(id);
    if (connection) {
      try { await this.invoke(id, connection.providerId, 'wallet_revokePermissions', [{ eth_accounts: {} }]); }
      catch (error) { if ((error as any).code !== -32601 && (error as any).code !== 4200) throw error; }
    }
    this.connections.delete(id);
    const surface = this.browsers.get(id)?.connection; surface?.close();
    return { disconnected: true };
  }
  async request(id: string, method: string, params: any[], expected?: { account: string; chainId: number }) {
    if (!['eth_sendTransaction', 'personal_sign', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'eth_getBalance'].includes(method)) throw Error('Unsupported wallet request.');
    if (this.pending.has(id)) throw Error('Finish the open wallet request first.');
    this.pending.add(id);
    try {
      const connection = await this.refresh(id);
      if (!connection) throw Error('Connect your wallet first.');
      if (expected && (connection.chainId !== expected.chainId || !connection.accounts.some(account => account.toLowerCase() === expected.account.toLowerCase()))) throw Error('Wallet account or network changed. Prepare a new review.');
      return await this.invoke(id, connection.providerId, method, params);
    } finally { this.pending.delete(id); }
  }
}
