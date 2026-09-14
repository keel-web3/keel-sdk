import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { canonicalPreview } from './preview.mjs';

// Only trusted main-process snapshots enter this worker. Creator code is never executed.
// Disk reads, integrity checks, compression and graph assembly stay off the UI thread.
let legacy;
const object = (id) => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid object digest.');
  const file = path.join(workerData.objectDirectory, id);
  let bytes;
  if (existsSync(file)) bytes = readFileSync(file);
  else {
    legacy ??= new DatabaseSync(workerData.databasePath, { readOnly: true });
    const row = legacy.prepare('SELECT bytes FROM blobs WHERE id=?').get(id);
    if (!row) throw new Error('Object bytes are unavailable.');
    bytes = Buffer.from(row.bytes);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== id) {
    throw new Error('Stored original bytes no longer match their digest. Restore the original before using this object.');
  }
  return bytes;
};

parentPort.on('message', async ({ id, project, objects }) => {
  try {
    const store = { read: () => ({ state: { objects } }), object };
    const result = await canonicalPreview({ store, project, shell: workerData.shell, runtimeDirectory: workerData.runtimeDirectory });
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : 'Preview failed.' });
  }
});
