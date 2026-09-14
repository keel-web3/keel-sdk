import { contextBridge, ipcRenderer } from 'electron';

// This preload is registered only in each wallet's isolated session. Every call
// is also checked against that session and extension origin in the main process.
const eligible = contextBridge.executeInMainWorld({ func: () => location.protocol === 'chrome-extension:' });
if (eligible) {
  contextBridge.exposeInMainWorld('__keelBrowser', {
    call: (method: string, args: unknown[]) => ipcRenderer.invoke('keel:wallet-browser', method, args),
    listen: (callback: (name: string, args: unknown[]) => void) => {
      ipcRenderer.on('keel:wallet-browser-event', (_event, name, args) => callback(name, args));
    },
  });
  contextBridge.executeInMainWorld({ func: () => {
    const root = globalThis as any;
    const bridge = root.__keelBrowser;
    const chrome = root.chrome;
    const browser = root.browser;
    const events = new Map<string, Set<Function>>();
    const event = (name: string) => {
      const callbacks = new Set<Function>(); events.set(name, callbacks);
      return { addListener: (fn: Function) => callbacks.add(fn), removeListener: (fn: Function) => callbacks.delete(fn), hasListener: (fn: Function) => callbacks.has(fn), hasListeners: () => !!callbacks.size };
    };
    bridge.listen((name: string, args: unknown[]) => { for (const fn of events.get(name) ?? []) { try { fn(...args); } catch { /* One listener must not block the others. */ } } });
    const call = (name: string) => (...args: any[]) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined;
      const promise = bridge.call(name, args);
      if (callback) { void promise.then((result: unknown) => callback(result), (error: Error) => {
        // Match Chrome's callback error lifetime; Promise callers retain rejection.
        Object.defineProperty(chrome.runtime, 'lastError', { configurable: true, value: { message: error.message } });
        try { callback(); } finally { delete chrome.runtime.lastError; }
      }); return; }
      return promise;
    };
    const install = (namespace: string, methods: string[], names: string[] = [], values = {}) => {
      const target: any = { ...chrome[namespace], ...values };
      for (const method of methods) target[method] = call(`${namespace}.${method}`);
      for (const name of names) target[name] = event(`${namespace}.${name}`);
      chrome[namespace] = target;
      // Current Chromium exposes both namespaces; wallets can use either.
      if (browser) browser[namespace] = target;
    };
    install('windows', ['create', 'get', 'getAll', 'getCurrent', 'getLastFocused', 'update', 'remove'], ['onRemoved', 'onCreated', 'onFocusChanged'], { WINDOW_ID_NONE: -1, WINDOW_ID_CURRENT: -2 });
    install('tabs', ['create', 'get', 'getCurrent', 'query', 'update', 'remove'], ['onRemoved', 'onCreated', 'onUpdated', 'onActivated']);
    install('action', ['setBadgeText', 'getBadgeText', 'setBadgeBackgroundColor', 'setIcon', 'setTitle', 'getTitle', 'setPopup', 'getPopup', 'openPopup', 'enable', 'disable'], ['onClicked']);
    install('notifications', ['create', 'clear', 'getAll'], ['onClicked', 'onClosed']);
    install('commands', ['getAll'], ['onCommand']);
    install('idle', ['queryState', 'setDetectionInterval'], ['onStateChanged']);
    install('sidePanel', ['setPanelBehavior', 'setOptions', 'getOptions', 'open']);
  } });
}
