// Beacon's UI includes a Node crypto side-effect import. The browser surface
// uses Chromium Web Crypto; it must never gain access to Node or Electron.
export const webcrypto = globalThis.crypto;
export const getRandomValues = <T extends ArrayBufferView>(value: T) => webcrypto.getRandomValues(value);
export const randomBytes = (size: number) => getRandomValues(new Uint8Array(size));
export default { webcrypto, getRandomValues, randomBytes };
