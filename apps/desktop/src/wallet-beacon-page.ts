import { DAppClient } from '@airgap/beacon-dapp';
import { ColorMode, PermissionScope, SigningType, type Network } from '@airgap/beacon-types';

let client: DAppClient | undefined;
let storageReady: Promise<unknown> | undefined;
const getClient = (network?: Network) => client ??= new DAppClient({ name: 'KEEL', description: 'Your onchain art studio', appUrl: location.origin, colorMode: ColorMode.DARK, enableMetrics: false, enableAppSwitching: true, featuredWallets: ['temple', 'kukai', 'umami', 'airgap'], ...(network ? { network } : {}) });
const ready = async (network?: Network) => {
  const active = getClient(network);
  // Beacon 4.8 starts IndexedDB asynchronously but queues disabled metrics on
  // the first request immediately. Wait for its stores before that request.
  storageReady ??= (active as any).beaconIDB.initDB();
  await storageReady; return active;
};
const account = async () => {
  const active = await (await ready()).getActiveAccount();
  return active ? { address: active.address, publicKey: active.publicKey, network: active.network, scopes: active.scopes, accountIdentifier: active.accountIdentifier, wallet: active.walletKey ?? active.origin.type } : null;
};
const methods = {
  async connect(input: { network: Network }) {
    const active = await ready(input.network); active.network = input.network;
    await active.requestPermissions({ scopes: [PermissionScope.OPERATION_REQUEST, PermissionScope.SIGN] });
    return account();
  },
  account,
  async disconnect() { await getClient().disconnect(); return null; },
  async sign(input: { address: string; payload: string }) {
    return getClient().requestSignPayload({ signingType: SigningType.MICHELINE, sourceAddress: input.address, payload: input.payload });
  },
  async operation(input: { address: string; network: Network; operation: any }) {
    const active = await getClient().getActiveAccount();
    if (active?.address !== input.address || active.network.type !== input.network.type || (input.network.type === 'custom' && active.network.rpcUrl !== input.network.rpcUrl)) throw Error('Your wallet account or network changed. Prepare a new review.');
    return getClient().requestOperation({ operationDetails: [input.operation] });
  },
};
(globalThis as any).keelTezos = {
  async request(method: keyof typeof methods, input: any) {
    try { return { result: await (methods[method] as any)(input) }; }
    catch (error: any) { return { error: { message: String(error?.message ?? error?.errorType ?? 'Wallet request failed.').slice(0,1000), code: error?.errorType ?? error?.code } }; }
  },
};
document.getElementById('status')!.textContent = 'Choose your wallet in the pairing dialog. Keep this window open while approving a request.';
