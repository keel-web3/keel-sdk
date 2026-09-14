import { BrowserWindow, ipcMain, powerMonitor, shell, type Session, type WebContents } from 'electron';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { WALLET_PAGE, WALLET_ORIGIN, walletPage } from './wallet-provider-page.mjs';
import { TEZOS_PAGE, TEZOS_SCRIPT, tezosPage, tezosHandoff } from './wallet-pages.mjs';

const CHANNEL = 'keel:wallet-browser';
const hosts = new Map<Session, WalletBrowser>();
let registered = false;

// Browser APIs scoped to one installed wallet, never to the editor or previews.
export class WalletBrowser {
  windows = new Map<number, BrowserWindow>();
  private active?: number;
  private badge = '';
  private title = '';
  private popup = '';
  private workers = new Set<number>();
  private idleThreshold = 60;
  private idleState = 'active';
  extensionId = '';
  connection?: BrowserWindow;
  beacon?: BrowserWindow;
  constructor(readonly profile: Session, private name: string) {
    hosts.set(profile, this);
    const idleTimer = setInterval(() => {
      const state = powerMonitor.getSystemIdleState(this.idleThreshold);
      if (state !== 'unknown' && state !== this.idleState) { this.idleState = state; this.emit('idle.onStateChanged', state); }
    }, 10000);
    idleTimer.unref();
    if (!registered) {
      ipcMain.handle(CHANNEL, (event, method, args) => {
        const host = hosts.get(event.sender.session);
        if (!host || event.senderFrame !== event.sender.mainFrame || !host.owns(event.senderFrame.url)) throw Error('Untrusted wallet browser request.');
        return host.call(method, args, event.sender);
      }); registered = true;
    }
    for (const type of ['frame', 'service-worker'] as const) profile.registerPreloadScript({ type, filePath: path.join(__dirname, 'wallet-browser-preload.cjs') });
    profile.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
      if (runningStatus !== 'starting' && runningStatus !== 'running') return;
      if (this.workers.has(versionId)) return;
      const worker = profile.serviceWorkers.getWorkerFromVersionID(versionId);
      if (!worker || !worker.scriptURL.startsWith('chrome-extension://')) return;
      worker.ipc.handle(CHANNEL, (_event, method, args) => {
        if (!this.owns(worker.scriptURL)) throw Error('Untrusted wallet worker.');
        return this.call(method, args);
      });
      this.workers.add(versionId);
    });
    profile.protocol.handle('https', async (request) => {
      if (new URL(request.url).origin !== WALLET_ORIGIN) {
        try { return await profile.fetch(request.url, { method: request.method, headers: request.headers, ...(!['GET','HEAD'].includes(request.method) ? { body: await request.arrayBuffer() } : {}), bypassCustomProtocolHandlers: true }); }
        catch { return new Response('Wallet network request failed.', { status: 502 }); }
      }
      if (request.url === TEZOS_SCRIPT) return new Response(await readFile(path.join(__dirname, 'wallet-beacon.js')), { headers: { 'content-type': 'text/javascript' } });
      if (request.url === TEZOS_PAGE) return new Response(tezosPage, { headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: https:; connect-src https: wss:; worker-src blob:; frame-src https://verify.walletconnect.org; base-uri 'none'; form-action 'none'" } });
      if (request.url !== WALLET_PAGE) return new Response('Not found', { status: 404 });
      return new Response(walletPage, { headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" } });
    });
  }
  owns(url: string) { return !!this.extensionId && url.startsWith(`chrome-extension://${this.extensionId}/`); }
  private allowed(url: string) { return this.owns(url) || url === WALLET_PAGE || url === TEZOS_PAGE || (!!this.beacon && tezosHandoff(url) === 'window'); }
  private handoff(url: string) {
    if (this.beacon && tezosHandoff(url) === 'external') { void shell.openExternal(url).catch(() => {}); return; }
    if (this.allowed(url)) void this.create(url).catch(() => {});
  }
  private resolve(url: unknown) {
    if (typeof url !== 'string' || !url || url.length > 8192) throw Error('Invalid wallet page.');
    const resolved = new URL(url, `chrome-extension://${this.extensionId}/`).href;
    if (!this.allowed(resolved)) throw Error('This wallet requested a page outside its app.');
    return resolved;
  }
  private window(id?: number) {
    const window = this.windows.get(id === -2 || id === undefined ? this.active! : id);
    if (!window || window.isDestroyed()) throw Error('Wallet window no longer exists.'); return window;
  }
  private tab(window: BrowserWindow) { return { id: window.webContents.id, windowId: window.id, index: 0, active: this.active === window.id, selected: this.active === window.id, highlighted: true, pinned: false, incognito: false, url: window.webContents.getURL(), title: window.getTitle(), status: window.webContents.isLoading() ? 'loading' : 'complete' }; }
  private description(window: BrowserWindow, populate = true) { const [width,height] = window.getSize(); const [left,top] = window.getPosition(); return { id: window.id, focused: this.active === window.id, type: 'normal', state: 'normal', incognito: false, alwaysOnTop: false, width,height,left,top, ...(populate ? { tabs: [this.tab(window)] } : {}) }; }
  private emit(name: string, ...args: unknown[]) {
    for (const window of this.windows.values()) if (!window.isDestroyed() && this.owns(window.webContents.getURL())) window.webContents.send('keel:wallet-browser-event', name, args);
    for (const id of Object.keys(this.profile.serviceWorkers.getAllRunning())) {
      const worker = this.profile.serviceWorkers.getWorkerFromVersionID(Number(id));
      if (worker && !worker.isDestroyed() && this.owns(worker.scriptURL)) worker.send('keel:wallet-browser-event', name, args);
    }
  }
  async create(url: string, options: any = {}) {
    url = this.resolve(url);
    if (this.windows.size >= 8) throw Error('Close an existing wallet window first.');
    const bounded = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(400, Math.min(1200, Math.round(value))) : fallback;
    const window = new BrowserWindow({ width: bounded(options.width, 480), height: bounded(options.height, 780), show: options.show !== false, title: this.name, backgroundColor: '#101116', webPreferences: { session: this.profile, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, webSecurity: true } });
    this.windows.set(window.id, window); this.active = window.id;
    window.webContents.setWindowOpenHandler(({url}) => { this.handoff(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, target) => { if (!this.allowed(target) || window === this.beacon) { event.preventDefault(); this.handoff(target); } });
    window.webContents.on('will-redirect', (event, target) => { if (!this.allowed(target)) event.preventDefault(); });
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.on('focus', () => { this.active = window.id; this.emit('windows.onFocusChanged', window.id); this.emit('tabs.onActivated', { tabId: window.webContents.id, windowId: window.id }); });
    const tabId = window.webContents.id;
    window.on('closed', () => { this.windows.delete(window.id); if (this.active === window.id) this.active = [...this.windows.keys()].at(-1); this.emit('tabs.onRemoved', tabId, { windowId: window.id, isWindowClosing: true }); this.emit('windows.onRemoved', window.id); });
    window.webContents.on('did-finish-load', () => this.emit('tabs.onUpdated', tabId, { status: 'complete', url: window.webContents.getURL() }, this.tab(window)));
    await window.loadURL(url);
    this.emit('windows.onCreated', this.description(window)); this.emit('tabs.onCreated', this.tab(window));
    return window;
  }
  async providerWindow() {
    if (this.connection && !this.connection.isDestroyed()) return this.connection;
    this.connection = await this.create(WALLET_PAGE, { show: false }); return this.connection;
  }
  async beaconWindow(show = false) {
    if (!this.beacon || this.beacon.isDestroyed()) this.beacon = await this.create(TEZOS_PAGE, { show, width: 560, height: 800 });
    if (show) { this.beacon.show(); this.beacon.focus(); }
    return this.beacon;
  }
  close() { for (const window of [...this.windows.values()]) window.destroy(); this.connection = undefined; this.beacon = undefined; }
  async call(method: string, args: any[], sender?: WebContents): Promise<any> {
    if (typeof method !== 'string' || !Array.isArray(args) || args.length > 4 || JSON.stringify(args).length > 100000) throw Error('Invalid wallet browser request.');
    const current = () => [...this.windows.values()].find(window => window.webContents === sender) ?? this.window();
    const tabWindow = (id?: number) => id === undefined ? current() : [...this.windows.values()].find(window => window.webContents.id === id) ?? (() => { throw Error('Unknown wallet tab.'); })();
    const [a,b] = args;
    switch (method) {
      case 'windows.create': return this.description(await this.create(Array.isArray(a?.url) ? a.url[0] : a?.url, a));
      case 'windows.get': return this.description(this.window(a), b?.populate);
      case 'windows.getAll': return [...this.windows.values()].map(window => this.description(window, a?.populate));
      case 'windows.getCurrent': return this.description(current(), a?.populate);
      case 'windows.getLastFocused': return this.description(this.window(), a?.populate);
      case 'windows.update': { const window = this.window(a); if (b?.focused) { window.show(); window.focus(); } return this.description(window); }
      case 'windows.remove': this.window(a).close(); return;
      case 'tabs.create': return this.tab(await this.create(a?.url, { show: a?.active !== false }));
      case 'tabs.get': return this.tab(tabWindow(a));
      case 'tabs.getCurrent': return sender ? this.tab(current()) : undefined;
      case 'tabs.query': return [...this.windows.values()].map(window => this.tab(window)).filter(tab => {
        if (a?.active !== undefined && tab.active !== a.active) return false;
        if (a?.windowId !== undefined && tab.windowId !== a.windowId) return false;
        if ((a?.currentWindow || a?.lastFocusedWindow) && tab.windowId !== this.active) return false;
        if (!a?.url) return true;
        return (Array.isArray(a.url) ? a.url : [a.url]).some((pattern: string) => {
          if (typeof pattern !== 'string' || pattern.length > 2048) return false;
          if (pattern === '<all_urls>') return true;
          const pieces = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          return new RegExp('^' + pieces.join('.*') + '$').test(tab.url);
        });
      });
      case 'tabs.update': { const window = tabWindow(typeof a === 'number' ? a : undefined); const properties = typeof a === 'number' ? b : a; if (properties?.url) await window.loadURL(this.resolve(properties.url)); if (properties?.active) { this.active = window.id; window.show(); window.focus(); } return this.tab(window); }
      case 'tabs.remove': for (const id of Array.isArray(a) ? a : [a]) tabWindow(id).close(); return;
      case 'action.setBadgeText': this.badge = String(a?.text ?? '').slice(0,32); return;
      case 'action.getBadgeText': return this.badge;
      case 'action.setTitle': this.title = String(a?.title ?? '').slice(0,160); return;
      case 'action.getTitle': return this.title;
      case 'action.setPopup': this.popup = String(a?.popup ?? ''); return;
      case 'action.getPopup': return this.popup;
      case 'action.openPopup': case 'sidePanel.open': await this.create(`chrome-extension://${this.extensionId}/${this.popup || 'popup.html'}`); return;
      case 'action.setBadgeBackgroundColor': case 'action.setIcon': case 'action.enable': case 'action.disable': case 'sidePanel.setPanelBehavior': case 'sidePanel.setOptions': return;
      case 'idle.setDetectionInterval': if (!Number.isInteger(a) || a < 15 || a > 86400) throw Error('Invalid idle interval.'); this.idleThreshold = a; return;
      case 'sidePanel.getOptions': return { enabled: false };
      case 'notifications.getAll': return {};
      case 'notifications.clear': return false;
      case 'notifications.create': throw Error('Desktop notifications are unavailable in this wallet profile.');
      case 'commands.getAll': return [];
      case 'idle.queryState': if (!Number.isInteger(a) || a < 15 || a > 86400) throw Error('Invalid idle interval.'); return powerMonitor.getSystemIdleState(a);
      default: throw Error('Unsupported wallet browser API.');
    }
  }
}
