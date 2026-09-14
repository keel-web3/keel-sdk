import type { Project } from './types';
import { projectWithRuntime, runtimeLibrary } from './runtime-library.mjs';
import { fileSize } from './ui';

export function CreativeLibraries({ project, change }: { project: Project; change: (patch: Partial<Project>) => void }) {
  return <section className="setup-card"><h3>Shared creative libraries</h3><p>Add a library once and reuse it across your work. Your project saves a versioned reference; the editor supplies the checked bytes for preview.</p>
    {runtimeLibrary.map(runtime => {
      const selected = runtime.resources.every(resource => project.runtimeModules?.some(ref => ref.id === resource.id));
      return <div className="record-row" key={runtime.id}><div><strong>{runtime.title}</strong><p>{runtime.resources[0].version} · {selected ? 'Linked for local preview' : 'Available in this editor'}</p></div><button disabled={selected} onClick={() => change(projectWithRuntime(project, runtime.id))}>{selected ? 'Linked' : `Use ${runtime.title}`}</button></div>;
    })}
    <p>Before release, match these exact versions to verified modules on your chosen network. Missing modules need a separate setup step.</p>
    <details><summary>Use the library in your code</summary><pre>{'// Three.js — after clicking Use Three.js\nimport * as THREE from "three";\n\n// p5.js — after clicking Use p5.js\n// Available as window.p5 in the canonical preview.'}</pre></details>
  </section>;
}

export function PublicationSize({ measurement, plan }: { measurement: any; plan: any }) {
  const uploads = measurement?.uploads;
  const titles = runtimeLibrary.filter(runtime => runtime.resources.some(resource => uploads?.modules?.some((module: any) => module.id === resource.id))).map(runtime => runtime.title);
  return <><div className="measurement-grid">
    <div><span>{uploads?.scope==='preview-token-1'?'THIS SAMPLE’S RESOURCES':'YOUR NEW UPLOAD'}</span><strong>{uploads ? fileSize(uploads.creatorPublicationBytes) : 'Measuring…'}</strong><small>{uploads?.scope==='preview-token-1'?'One generated preview, not the whole collection':'Artwork code & attached assets'}</small></div>
    <div><span>SHARED LIBRARIES</span><strong>{[...titles, 'KEEL shell'].join(' + ')}</strong><small>Stored separately and referenced by your work</small></div>
    <div><span>VIEWER DELIVERY</span><strong>{plan.mode === 'inline' ? 'Inline' : 'RPC reconstruction'}</strong><small>The way viewers receive the complete work</small></div>
  </div>{uploads?.scope==='preview-token-1'&&<p>This size is for preview token 1. Your full collection has {uploads.collectionAssetCount} attached images ({fileSize(uploads.collectionAssetBytes)}). Publication preparation includes the complete layer library and rules.</p>}<p>Your upload size assumes the shared libraries are available on your chosen network. KEEL must verify those links before release; any missing library needs a separate setup step. Contract and metadata overhead are added during release preparation.</p>
  <details className="disclosure"><summary>View the complete size breakdown</summary><div className="measurement-grid">
    <div><span>YOUR ORIGINAL FILES</span><strong>{uploads ? fileSize(uploads.creatorByteLength) : 'Measuring…'}</strong><small>{uploads ? `${fileSize(uploads.creatorCompressedByteLength)} gzip before packaging` : ''}</small></div>
    <div><span>ALL RESOURCES, INCLUDING LIBRARIES</span><strong>{fileSize(plan.originalByteLength)}</strong><small>{fileSize(plan.compressedByteLength)} gzip</small></div>
    <div><span>COMPLETE VIEWER READ</span><strong>{measurement?.saver ? fileSize(measurement.saver.graphByteLength) : 'Measuring…'}</strong><small>Includes reused libraries and shell; metadata adds more</small></div>
  </div><p>Reusing a library saves new storage. The complete Inline response still includes its bytes, so viewer limits and read costs use the complete size.</p></details></>;
}
