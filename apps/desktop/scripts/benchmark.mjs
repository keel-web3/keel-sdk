import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import path from 'node:path';
import { WorkspaceStore, newProject } from '../src/workspace.mjs';
import { PreviewService } from '../src/preview-service.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'keel-desktop-performance-'));
const databasePath = path.join(directory, 'workspace.sqlite');
const store = new WorkspaceStore(databasePath);
let service;
try {
  const projects = Array.from({ length: 24 }, (_, index) => {
    const project = newProject(`Performance sample ${index}`);
    project.files[0].content += `<!--${'x'.repeat(128 * 1024)}-->`;
    return project;
  });
  store.save({ ...store.read().state, projects }, 0);
  let start = performance.now();
  for (let index = 0; index < 50; index++) store.read();
  const workspaceReadsMs = performance.now() - start;
  const asset = Buffer.concat([Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), randomBytes(4 * 1024 * 1024)]);
  const state = store.importObject(asset, 'performance.gif', 'image/gif', 1);
  const object = state.state.objects[0];
  const project = { ...projects[0], files: [], objectIds: [object.id], presentation: { shell: 'canonical', delivery: 'auto', entryObjectId: object.id } };
  const shell = JSON.parse(await readFile(new URL('../dist/canonical-shell.json', import.meta.url), 'utf8'));
  for (const part of ['prefix', 'suffix']) shell[part].bytes = Buffer.from(shell[part].bytes, 'base64');
  service = new PreviewService({ workerPath: new URL('../dist/preview-worker.cjs', import.meta.url), databasePath, objectDirectory: store.objectDirectory, shell });
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  await new Promise((resolve) => setTimeout(resolve, 30));
  start = performance.now();
  const preview = await service.preview(project, state.state.objects);
  const previewBuildMs = performance.now() - start;
  await new Promise((resolve) => setTimeout(resolve, 30));
  delay.disable();
  start = performance.now();
  const repeated = await service.preview(project, state.state.objects);
  const cachedPreviewMs = performance.now() - start;
  if (preview.html !== repeated.html) throw new Error('Cached preview changed the verified graph.');
  const report = {
    phase: 'after',
    workload: { workspaceProjects: 24, sourceBytesPerProject: 128 * 1024, repeatedReads: 50, assetBytes: asset.length },
    workspaceReadsMs, previewBuildMs, eventLoopMaxDelayMs: Number(delay.max) / 1e6,
    cachedPreviewMs, cacheBytes: service.cacheBytes, previewBytes: preview.byteLength,
    note: 'Synthetic 4 MB GIF fixture with random trailing bytes. Cold worker startup is included; timing varies by machine and load. This measures responsiveness, not live chain performance.',
  };
  const artifacts = new URL('../artifacts/', import.meta.url);
  await mkdir(artifacts, { recursive: true });
  await writeFile(new URL('performance-after.json', artifacts), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { service?.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
