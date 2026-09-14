export const WALLET_ORIGIN = 'https://wallet.keel.invalid';
export const WALLET_PAGE = WALLET_ORIGIN + '/';

// Only this fixed document runs in the wallet's browser session. Artwork and the
// privileged editor never share the extension's content scripts or provider.
export const walletPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>KEEL wallet connection</title>
<style>body{background:#0c0f10;color:#eef0f4;font:17px system-ui;padding:40px;line-height:1.6}small{color:#a7aebc}h1{font-size:28px}</style>
<h1>KEEL wallet connection</h1><p>Approve the connection or transaction in your wallet window.</p><small>This page connects only your wallet to the KEEL editor. Your recovery phrase stays in your wallet.</small>
<script>
(() => {
  const providers = new Map();
  let selected;
  let revision = 0;
  const attach = provider => {
    if (selected === provider) return;
    selected = provider; revision++;
    for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) provider.on?.(event, () => revision++);
  };
  addEventListener('eip6963:announceProvider', event => {
    if (event.detail?.provider?.request) providers.set(event.detail.info.uuid, event.detail);
  });
  dispatchEvent(new Event('eip6963:requestProvider'));
  window.keelWallet = {
    async discover() {
      dispatchEvent(new Event('eip6963:requestProvider'));
      if (!providers.size && window.ethereum?.request) providers.set('injected', {info:{uuid:'injected',name:'Wallet'},provider:window.ethereum});
      return [...providers.values()].map(({info}) => ({id:info.uuid,name:String(info.name).slice(0,100)}));
    },
    async request(id, method, params = []) {
      const provider = providers.get(id)?.provider;
      if (!provider) throw Error('Wallet provider unavailable. Reconnect your wallet.');
      attach(provider);
      try { return {result:await provider.request({method,params}), revision}; }
      catch (error) { return {error:{message:String(error.message).slice(0,1000),code:error.code}, revision}; }
    },
    revision() { return revision; }
  };
})();
</script></html>`;
