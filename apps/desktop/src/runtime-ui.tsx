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
  const creatorOwned = plan.viewer === "none";
  const unsupported = measurement?.publicationMeasurement?.status === "unsupported";
  const titles = runtimeLibrary.filter(runtime => runtime.resources.some(resource => uploads?.modules?.some((module: any) => module.id === resource.id))).map(runtime => runtime.title);
  return <><div className="measurement-grid">
    <div><span>{uploads?.scope==='preview-token-1'?'THIS SAMPLE’S RESOURCES':'YOUR NEW UPLOAD'}</span><strong>{unsupported ? 'Not measured' : uploads ? fileSize(uploads.creatorPublicationBytes) : 'Measuring…'}</strong><small>{uploads?.scope==='preview-token-1'?'One generated preview, not the whole collection':'Artwork code & attached assets'}</small></div>
    <div><span>SHARED LIBRARIES</span><strong>{[...titles, creatorOwned ? 'Creator-owned shell' : 'KEEL shell'].join(' + ')}</strong><small>{creatorOwned ? "Supplied in your own source" : "Stored separately and referenced by your work"}</small></div>
    <div><span>VIEWER DELIVERY</span><strong>{plan.mode === 'inline' ? 'Inline' : 'RPC reconstruction'}</strong><small>The way viewers receive the complete work</small></div>
  </div>{uploads?.scope==='preview-token-1'&&<p>This size is for preview token 1. Your full collection has {uploads.collectionAssetCount} attached images ({fileSize(uploads.collectionAssetBytes)}). Publication preparation includes the complete layer library and rules.</p>}<p>{creatorOwned ? "Your source supplies the shell. No canonical verification interface is added. Complete metadata and the selected-chain read still need measurement before release." : "Your upload size assumes the shared libraries are available on your chosen network. KEEL must verify those links before release; any missing library needs a separate setup step. Contract and metadata overhead are added during release preparation."}</p>
  <details className="disclosure"><summary>View the complete size breakdown</summary><div className="measurement-grid">
    <div><span>YOUR ORIGINAL FILES</span><strong>{uploads ? fileSize(uploads.creatorByteLength) : unsupported ? fileSize(plan.originalByteLength) : 'Measuring…'}</strong><small>{uploads ? `${fileSize(uploads.creatorCompressedByteLength)} selected payload bytes before packaging` : unsupported ? 'Publication payload size not measured' : ''}</small></div>
    <div><span>ALL RESOURCES, INCLUDING LIBRARIES</span><strong>{fileSize(plan.originalByteLength)}</strong><small>{unsupported ? "Publication payload size not measured" : `${fileSize(plan.compressedByteLength)} selected payload bytes`}</small></div>
    <div><span>COMPLETE VIEWER READ</span><strong>{unsupported ? 'Not measured' : measurement?.saver ? fileSize(measurement.saver.graphByteLength) : 'Measuring…'}</strong><small>{creatorOwned ? "Creator-owned graph; metadata adds more" : "Includes reused libraries and shell; metadata adds more"}</small></div>
  </div><p>{creatorOwned ? "Source and prepared graph sizes do not establish the complete metadata return or contract read cost." : "Reusing a library saves new storage. The complete Inline response still includes its bytes, so viewer limits and read costs use the complete size."}</p></details></>;
}
