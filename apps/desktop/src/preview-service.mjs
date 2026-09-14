import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { planKeelAssetPresentation } from '@keel/sdk/presentation';

/** One lazy worker, a bounded queue and a byte-bounded LRU of verified preview graphs. */
export class PreviewService {
  constructor({ workerPath, databasePath, objectDirectory, shell, runtimeDirectory, maxBytes = 64 * 1024 * 1024, maxEntries = 8, maxPending = 4, timeoutMs = 120_000 }) {
    this.workerPath = workerPath;
    this.workerData = { databasePath, objectDirectory, shell, runtimeDirectory };
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.maxPending = maxPending;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();
    this.pending = new Map();
    this.cacheBytes = 0;
    this.worker = null;
    this.active = null;
    this.closed = false;
  }

  async preview(project, objects) {
    if (this.closed) throw new Error('Preview service is closed.');
    const attached = new Set(project.objectIds);
    const resources = objects.filter((object) => attached.has(object.id));
    // Names, identities and bytes affect the graph; notes, wallets, networks and delivery do not.
    const source = { layered: project.layered, files: project.files, runtimeModules: project.runtimeModules, objectIds: project.objectIds, presentation: { entryObjectId: project.presentation.entryObjectId, shell: 'canonical', delivery: 'auto' } };
    const key = createHash('sha256').update(JSON.stringify({ source, resources })).digest('hex');
    let result = this.cache.get(key)?.result;
    if (result) {
      const hit = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, hit);
    } else {
      let job = this.pending.get(key);
      if (!job) {
        if (this.pending.size >= this.maxPending) throw new Error('Other previews are still being prepared. Try this preview again in a moment.');
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        job = { key, project: source, objects: resources, promise, resolve, reject };
        this.pending.set(key, job);
        this.pump();
      }
      result = await job.promise;
    }
    return { ...result, plan: planKeelAssetPresentation({ originalByteLength: result.plan.originalByteLength, compressedByteLength: result.plan.compressedByteLength, graphByteLength: result.saver.graphByteLength, mode: project.presentation.delivery }) };
  }

  pump() {
    if (this.active || this.closed || !this.pending.size) return;
    if (!this.worker) {
      try {
        const worker = new Worker(this.workerPath, { workerData: this.workerData });
        this.worker = worker;
        worker.on('message', (message) => this.complete(message));
        worker.on('error', (error) => { if (this.worker === worker) this.fail(error); });
        worker.on('exit', () => { if (this.worker === worker) this.fail(new Error('Preview worker stopped. Try the preview again.')); });
      } catch (error) { this.fail(error); return; }
    }
    this.active = this.pending.values().next().value;
    this.timer = setTimeout(() => this.fail(new Error('Preview preparation timed out. Your source is preserved; try direct display or a smaller preview graph.')), this.timeoutMs);
    try { this.worker.postMessage({ id: this.active.key, project: this.active.project, objects: this.active.objects }); }
    catch (error) { this.fail(error); }
  }

  complete({ id, result, error }) {
    if (!this.active || this.active.key !== id) return;
    clearTimeout(this.timer);
    const job = this.active;
    this.pending.delete(id);
    this.active = null;
    if (error) job.reject(new Error(error));
    else {
      // V8 may retain a two-byte string. Charge conservatively rather than counting entries alone.
      const size = result.html.length * 2;
      if (size <= this.maxBytes) {
        this.cache.set(id, { result, size });
        this.cacheBytes += size;
        while (this.cacheBytes > this.maxBytes || this.cache.size > this.maxEntries) {
          const key = this.cache.keys().next().value;
          this.cacheBytes -= this.cache.get(key).size;
          this.cache.delete(key);
        }
      }
      job.resolve(result);
    }
    this.pump();
  }

  fail(error) {
    clearTimeout(this.timer);
    const worker = this.worker;
    this.worker = null;
    this.active = null;
    for (const job of this.pending.values()) job.reject(error);
    this.pending.clear();
    void worker?.terminate();
  }

  close() {
    this.closed = true;
    this.fail(new Error('Preview service is closed.'));
    this.cache.clear();
    this.cacheBytes = 0;
  }
}
