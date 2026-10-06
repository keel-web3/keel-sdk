/** Data-only client for the protected KEEL verifier. Works from an opaque artwork iframe or its embedding host. */
export interface KeelApplicationPanel {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly page?: "overview" | "token" | "sources" | "provenance" | "application";
  readonly tab?: { readonly id: string; readonly label: string };
  readonly rows: readonly {
    readonly label: string;
    readonly value: string;
    readonly href?: string;
    readonly evidence?: { readonly resourceId: string; readonly digest: `0x${string}` };
  }[];
}
export interface KeelShellSnapshot {
  readonly state: string;
  readonly title: string;
  readonly summary: string;
  readonly proofTier: string;
  readonly checks: readonly Readonly<Record<string, unknown>>[];
}
export interface KeelMarketplaceDirectory {
  readonly protocol: "keel-marketplaces@1";
  readonly revision: number;
  readonly links: readonly {
    readonly id: string; readonly label: string; readonly href: string;
    readonly kind: "gallery" | "asset" | "marketplace";
    readonly listing?: { readonly status: "listed" | "auction" | "sold" | "unlisted" | "unknown";
      readonly price?: string; readonly currency?: string; readonly sourceURI: string; readonly observedAt: string;
      readonly chainId: number; readonly collection: string; readonly tokenId: string;
      readonly blockNumber: string; readonly expiresAt: string;
      readonly check: "onchain-sale" | "marketplace-order"; readonly rpcEndpoint: string };
  }[];
}
export interface KeelShellClient {
  readonly protocol: "keel-shell-extension@1";
  putPanel(panel: KeelApplicationPanel): Promise<unknown>;
  removePanel(id: string): Promise<unknown>;
  verification(): Promise<KeelShellSnapshot>;
  catalog(): Promise<import("./verification-shell-catalog.js").KeelShellCatalog>;
  open(page?: string): Promise<unknown>;
  close(): Promise<unknown>;
  /** Call after initialization when the checked loading manifest selects manual readiness. */
  ready(): Promise<unknown>;
  progress(percent: number, message?: string): Promise<unknown>;
  /** Only the embedding host can update the core directory. Artwork can use putPanel instead. */
  setMarketplaces(directory: KeelMarketplaceDirectory): Promise<unknown>;
  dispose(): void;
}
/** The function is self-contained so the same implementation can be injected before artwork executes. */
export function createKeelShellClient(target: Window = window.parent, timeoutMs = 5000): KeelShellClient {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new RangeError("Invalid shell client timeout.");
  const protocol = "keel-shell-extension@1" as const;
  const pending = new Map<string, { resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const clientId = Math.random().toString(36).slice(2);
  let sequence = 0, disposed = false;
  const onMessage = (event: MessageEvent) => {
    if (event.source !== target || event.data?.protocol !== protocol || event.data.action !== "response") return;
    const item = pending.get(event.data.requestId);
    if (!item) return;
    pending.delete(event.data.requestId); clearTimeout(item.timer);
    event.data.ok === true ? item.resolve(event.data.value) : item.reject(new Error(String(event.data.error ?? "Shell request rejected")));
  };
  addEventListener("message", onMessage);
  const request = (action: string, payload?: unknown): Promise<unknown> => {
    if (disposed) return Promise.reject(new Error("Shell client disposed"));
    if (pending.size >= 16) return Promise.reject(new Error("Too many shell requests"));
    return new Promise((resolve, reject) => {
      const requestId = clientId + ":" + ++sequence;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Shell request timed out")); }, timeoutMs);
      pending.set(requestId, {resolve, reject, timer});
      try { target.postMessage({protocol, action, requestId, payload}, "*"); }
      catch(error) { clearTimeout(timer); pending.delete(requestId); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  };
  return Object.freeze({protocol,
    putPanel: (panel: KeelApplicationPanel) => request("put-panel", panel),
    removePanel: (id: string) => request("remove-panel", id),
    verification: () => request("snapshot") as Promise<KeelShellSnapshot>,
    catalog: () => request("catalog") as Promise<import("./verification-shell-catalog.js").KeelShellCatalog>,
    ready: () => request("art-ready"), progress: (percent: number, message?: string) => request("art-progress", {percent,message}),
    open: (page?: string) => request("open", page), close: () => request("close"),
    setMarketplaces: (directory: KeelMarketplaceDirectory) => request("put-marketplaces", directory),
    dispose() { disposed = true; removeEventListener("message", onMessage); for (const item of pending.values()) {clearTimeout(item.timer); item.reject(new Error("Shell client disposed"));} pending.clear(); },
  });
}
