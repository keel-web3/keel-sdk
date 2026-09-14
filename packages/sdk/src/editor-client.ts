import { createConnection } from 'node:net';
import { readFile } from 'node:fs/promises';

/** The connection file stays at one location across editor restarts. */
export async function connectKeelEditor(connectionFile: string) {
  const descriptor = JSON.parse(await readFile(connectionFile, 'utf8')) as {socketPath?: unknown};
  if (typeof descriptor.socketPath !== 'string') throw new Error('Invalid KEEL workspace connection file.');
  return createKeelEditorClient(descriptor.socketPath);
}

/** Local editor workspace access. No model, chat session, wallet or chain action. */
export function createKeelEditorClient(socketPath: string) {
  if (!socketPath || !socketPath.startsWith('/') && !socketPath.startsWith('\\\\.\\pipe\\')) throw new Error('Choose an absolute KEEL editor socket path.');
  async function request<T = any>(method: string, input: unknown = {}): Promise<T> {
    const body = JSON.stringify({ method, input }) + '\n';
    if (Buffer.byteLength(body) > 64 * 1024 * 1024) throw new Error('Editor request exceeds 64 MB. Import assets separately.');
    return new Promise((resolve, reject) => {
      const socket = createConnection(socketPath); const chunks: Buffer[] = []; let size = 0, complete = false;
      const fail = (error: Error) => { socket.destroy(); reject(error); };
      socket.setTimeout(30000, () => fail(new Error('KEEL editor did not respond.')));
      socket.on('error', reject);
      socket.on('connect', () => socket.write(body));
      socket.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) return fail(new Error('Editor response exceeds its limit.'));
        chunks.push(chunk);
        if (chunk.includes(10)) {
          complete = true;
          try { const response = JSON.parse(Buffer.concat(chunks).toString('utf8')); socket.end(); if (response.error) reject(new Error(response.error)); else resolve(response.result as T); }
          catch (error) { fail(error as Error); }
        }
      });
      socket.on('end', () => { if (!complete) reject(new Error('KEEL editor closed before responding.')); });
    });
  }
  return {
    listProjects: () => request('projects.list'),
    readProject: (projectId: string) => request('projects.read', { projectId }),
    openProject: (projectId: string) => request('projects.open', { projectId }),
    updateProject: (projectId: string, revision: number, patch: Record<string, unknown>) => request('projects.update', { projectId, revision, patch }),
    importObject: (bytes: Uint8Array, name: string, type: string, revision: number) => request('objects.import', { bytes: Buffer.from(bytes).toString('base64'), name, type, revision }),
  };
}
