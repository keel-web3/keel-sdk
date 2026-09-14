import { parseKeelEngineIntent } from '@keel/sdk/engine';
import { newLayeredArt, checkLayeredArt } from '@keel/sdk/layered-art';
import { runtimeReferences } from './runtime-library.mjs';
import { projectWithRuntime } from './runtime-library.mjs';
import { isGameProject } from './game-engine/game-project.mjs';

// The same template choices drive the launcher, saved draft and guided editor.
export const CREATION_TEMPLATES = [
  { id: 'layered', title: 'Layered PFPs', description: 'Mix traits. Shape a whole collection.', name: 'Untitled layered collection', runtime: 'html', releaseType: 'series', collection: 'erc721a' },
  { id: 'image', title: 'Image or GIF', description: 'One artwork. One collectible.', name: 'Untitled image', runtime: 'static-media', releaseType: 'one-of-one', collection: 'erc721a' },
  { id: 'edition', title: 'An edition', description: 'One artwork. A number of copies.', name: 'Untitled edition', runtime: 'static-media', releaseType: 'limited-edition', collection: 'erc1155', supply: '25' },
  { id: 'collection', title: 'A collection', description: 'Bring several artworks together.', name: 'Untitled collection', runtime: 'static-media', releaseType: 'series', collection: 'erc721a' },
  { id: 'interactive', title: 'Interactive art', description: 'Start with a playable 3D sketch.', name: 'Untitled interactive work', runtime: 'three', releaseType: 'one-of-one', collection: 'erc721a' },
  { id: 'game', title: 'A game', description: 'A playable onchain game made with the KEEL pixel-art engine.', name: 'Untitled game', runtime: 'html', releaseType: 'limited-edition', collection: 'erc1155', supply: '25' },
];
export const CREATION_STEPS = ['artwork', 'collection', 'review'];
export const templateFor = (project) => CREATION_TEMPLATES.find(item => item.id === project.creation?.template);

export function releaseDefaults(intent, template = CREATION_TEMPLATES[0]) {
  intent = Object.fromEntries(Object.entries(intent).filter(([, value]) => value !== undefined));
  // Only fill unanswered choices. Opening the guide never changes an artist's plan.
  return parseKeelEngineIntent({ runtime: template.runtime, storage: 'inline', releaseType: template.releaseType,
    collection: intent.family === 'tezos' ? 'tezos-fa2' : template.collection, ...((intent.releaseType ?? template.releaseType) === 'limited-edition' && template.supply ? { supply: template.supply } : {}),
    mintSystem: 'mint-gate', ...intent, outcome: 'release',
    ...((intent.mintSystem ?? 'mint-gate') === 'mint-gate' ? { access: intent.access ?? ['public'], signature: intent.signature ?? 'none' } : {}),
  });
}

export function templateProject(project, id) {
  const template = CREATION_TEMPLATES.find(item => item.id === id);
  if (!template) throw Error('Choose an artwork template.');
  const next = { ...project, files: [], runtimeModules: [],
    intent: releaseDefaults({}, template),
    creation: { template: id, step: 'artwork', collectionName: '', artworkIds: [] },
    presentation: { shell: 'canonical', delivery: 'auto' },
  };
  if (id === 'layered') return { ...next, layered: newLayeredArt(project.title), runtimeModules: runtimeReferences('layered'), intent: { ...next.intent, supply: '100' } };
  if (id !== 'interactive') return next;
  // Keep reusable Three.js out of each artwork's source and upload.
  const content = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#10121c}canvas{display:block}p{position:fixed;bottom:20px;width:100%;text-align:center;color:#c9c4ef;font:14px system-ui;pointer-events:none}</style></head><body><p>Drag to turn · your first 3D sketch</p><script type="module">
import * as THREE from 'three';
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,100),renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));document.body.appendChild(renderer.domElement);camera.position.z=4;
const shape=new THREE.Mesh(new THREE.TorusKnotGeometry(.8,.22,160,24),new THREE.MeshStandardMaterial({color:0xa899ff,metalness:.45,roughness:.3}));scene.add(shape,new THREE.HemisphereLight(0xc8d7ff,0x302030,3));
const light=new THREE.PointLight(0x99ffda,35);light.position.set(3,3,3);scene.add(light);
let down=false;renderer.domElement.onpointerdown=e=>{down=true;renderer.domElement.setPointerCapture(e.pointerId)};renderer.domElement.onpointerup=()=>down=false;renderer.domElement.onpointermove=e=>{if(down){shape.rotation.y+=e.movementX*.01;shape.rotation.x+=e.movementY*.01}};
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
let previous=0;renderer.setAnimationLoop(t=>{const dt=Math.min((t-previous)/1000,.05);previous=t;if(!down)shape.rotation.y+=dt*.2;renderer.render(scene,camera)});
</script></body></html>`;
  return projectWithRuntime({ ...next, files: [{ ...project.files[0], content }] }, 'three');
}

export function attachArtwork(project, objects) {
  if (!objects.length) return project;
  const first = objects[0]; const hadArt = !!project.presentation.entryObjectId;
  const creation = project.creation ? { ...project.creation, artworkIds: [...new Set([...project.creation.artworkIds, ...objects.map(item => item.id)])] } : undefined;
  const isUntitled = CREATION_TEMPLATES.some(item => project.title === item.name);
  const name = first.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 160) || project.title;
  const title = !hadArt && isUntitled && creation?.template !== 'collection' ? name : project.title;
  const image = !project.metadata.image ? objects.find(item => item.type.startsWith('image/')) : null;
  return { ...project, title, ...(creation ? { creation } : {}),
    ...(creation?.template === 'collection' && project.intent.releaseType === 'series' && (!project.intent.supply || project.intent.supply === String(project.creation.artworkIds.length)) ? { intent: { ...project.intent, supply: String(creation.artworkIds.length) } } : {}),
    objectIds: [...new Set([...project.objectIds, ...objects.map(item => item.id)])],
    presentation: { ...project.presentation, entryObjectId: hadArt && creation?.template === 'collection' ? project.presentation.entryObjectId : first.id },
    metadata: { ...project.metadata, ...(!project.metadata.name ? { name: title } : {}), ...(image ? { image: `keel-asset://${image.id}/raw` } : {}) },
  };
}

export function selectProjectNetwork(project, id, snapshot) {
  const current = project.intent;
  const changed = current.family !== snapshot.family || (snapshot.family === 'ethereum' ? current.chainId !== snapshot.chainId : current.network !== snapshot.network);
  const intent = { ...current, family: snapshot.family }; delete intent.chainId; delete intent.network;
  if (snapshot.family === 'ethereum') intent.chainId = snapshot.chainId; else intent.network = snapshot.network;
  if (changed) delete intent.collectionAddress;
  if (current.family!==snapshot.family && (snapshot.family==='tezos'&&intent.collection&&!['tezos-fa2','existing','external'].includes(intent.collection)||snapshot.family==='ethereum'&&intent.collection==='tezos-fa2')) delete intent.collection;
  return { ...project, intent: parseKeelEngineIntent(intent), targetNetworkId: id,
    ...(project.creation ? { creation: { ...project.creation, ...(changed ? { selectedCollectionId: undefined } : {}) } } : {}),
  };
}

export function collectionChoices(state, intent, custom = false) {
  if (intent.family !== 'ethereum' || !intent.chainId) return [];
  const contracts = state.contracts.filter(item => item.chainId === intent.chainId);
  const records = state.collections.filter(item => item.chainId === intent.chainId);
  const choices = records.flatMap(record => { const contract = contracts.find(item => item.id === record.contractId); return contract ? [{ id: record.id, name: record.name, contract, record }] : []; });
  for (const contract of contracts) if ((custom || contract.kind === 'collection') && !choices.some(item => item.contract.id === contract.id)) choices.push({ id: contract.id, name: contract.name, contract });
  return choices;
}

export function mergeDiscoveredCollections(state, results) {
  const contracts = new Map(state.contracts.map(item => [item.id, item]));
  const collections = new Map(state.collections.map(item => [item.id, item]));
  for (const result of results) {
    for (const contract of [...result.infrastructure, ...result.records.map(item => item.contract)]) if (!contracts.has(contract.id)) contracts.set(contract.id, contract);
    for (const record of result.records) {
      const id = `${result.chainId}:${result.factory.toLowerCase()}:${record.collectionId}`;
      collections.set(id, { id, name: record.name, chainId: result.chainId, creator: result.creator, factory: result.factory, contractId: record.contract.id,
        collectionId: record.collectionId, sharedCollectionId: record.sharedCollectionId, deployment: record.deployment, observedBlock: result.blockNumber });
    }
  }
  return { ...state, contracts: [...contracts.values()], collections: [...collections.values()] };
}

export function artworkReady(project) {
  if (isGameProject(project)) return Boolean(project.title.trim() && project.game?.id);
  if (project.layered) return !!project.title.trim() && !checkLayeredArt(project.layered, project.objectIds).issues.some(i => i.level === 'error');
  return Boolean(project.title.trim() && (project.presentation.entryObjectId || project.files.some(item => item.type === 'text/html' && item.content.trim())));
}

export function collectionReady(project) {
  if (project.intent.outcome === 'explore') return true;
  if (!project.intent.family || !(project.intent.chainId || project.intent.network)) return false;
  if (project.intent.outcome !== 'release') return true;
  if (project.intent.family === 'tezos' || project.intent.mintSystem === 'fray-auction') return true;
  if (!project.intent.collection) return false;
  if (['existing', 'external'].includes(project.intent.collection)) return !!project.intent.collectionAddress;
  return !project.creation || !!project.creation.collectionName.trim();
}

export function artworkIssue(project) {
  if (!project.title.trim()) return 'Give your artwork a name to continue.';
  if (!artworkReady(project)) return isGameProject(project) ? 'Choose the game this project plays to continue.' : 'Add your artwork to continue.';
  if (['limited-edition', 'series'].includes(project.intent.releaseType) && !project.intent.supply) return 'Choose how many copies or works to include.';
  return '';
}
