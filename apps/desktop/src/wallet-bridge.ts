import type { BrowserWindow } from 'electron';

export async function invokeWalletPage(window: BrowserWindow, expectedUrl: string, expression: string) {
  if (window.isDestroyed() || window.webContents.getURL() !== expectedUrl) throw Error('Wallet connection page changed. Reconnect your wallet.');
  return new Promise<any>((resolve,reject) => {
    const closed = () => reject(Error('The wallet connection window closed. Check wallet activity before repeating a transaction.'));
    window.once('closed',closed);
    window.webContents.executeJavaScript(expression).then(resolve,reject).finally(()=>window.removeListener('closed',closed));
  });
}
