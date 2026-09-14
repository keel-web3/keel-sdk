import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('keel', {
  request: async (path: string, input?: unknown) => {
    try { return await ipcRenderer.invoke('keel:request', { path, input }); }
    catch (error) { throw new Error((error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method 'keel:request': (?:TRPCError|Error): /, '')); }
  },
  onAgentText: (callback: (event: { delta: string; provider: string; projectId?: string }) => void) => {
    const listener = (_event: unknown, event: { delta: string; provider: string; projectId?: string }) => callback(event);
    ipcRenderer.on('keel:agent-text', listener);
    return () => ipcRenderer.removeListener('keel:agent-text', listener);
  },
  onAgentEvent: (callback: (event: any) => void) => {
    const listener = (_event: unknown, event: any) => callback(event);
    ipcRenderer.on('keel:agent-event', listener);
    return () => ipcRenderer.removeListener('keel:agent-event', listener);
  },
});
