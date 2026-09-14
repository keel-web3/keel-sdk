export const TEZOS_PAGE = 'https://wallet.keel.invalid/tezos';
export const TEZOS_SCRIPT = 'https://wallet.keel.invalid/beacon.js';
export const tezosPage = `<!doctype html><html><head><meta charset="utf-8"><title>KEEL · Tezos wallets</title><style>body{color:#e5e7f1;background:#0b0d10;font:16px system-ui;margin:0;padding:32px}h1{font-size:24px}p{max-width:46em;line-height:1.6;color:#aeb4c7}</style></head><body><h1>Connect your Tezos wallet</h1><p id="status">Opening wallet pairing…</p><p>Temple runs inside KEEL. Pair a web, desktop, or mobile wallet with Beacon. Your wallet approves every signature and transaction.</p><script src="/beacon.js"></script></body></html>`;
export function tezosHandoff(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || url.length > 16000) return null;
    if (['https://wallet.kukai.app', 'https://ghostnet.kukai.app', 'https://shadownet.kukai.app'].includes(parsed.origin)) return 'window';
    if (['umami:', 'airgap-wallet:', 'temple:', 'kukai:'].includes(parsed.protocol)) return 'external';
  } catch { /* Invalid links never leave the wallet surface. */ }
  return null;
}
