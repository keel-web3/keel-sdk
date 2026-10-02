// Shared by the main process (which produces it) and the renderer (which shows
// a retry state for it): the one message for "the RPC didn't answer".
export const NETWORK_UNAVAILABLE = 'Couldn’t reach the network.';

/** True for the editor's network-unavailable error, after it crossed IPC as plain text. */
export const isNetworkUnavailable = (error) => (error instanceof Error ? error.message : String(error ?? '')).startsWith(NETWORK_UNAVAILABLE);
