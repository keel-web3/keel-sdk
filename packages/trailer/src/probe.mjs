// Browser-safe: read selected existing data, never regenerate a look/scene for inspection.
function plain(value,seen=new Set()) {
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Inspection data must be finite');return value;}
 if(ArrayBuffer.isView(value) && !(value instanceof DataView))return Array.from(value,v=>plain(v));
 if(typeof value!=='object')throw Error('Inspection values must be JSON data or typed arrays; expose numeric state, not functions');
 if(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Expose plain JSON data; convert Maps, Sets and class instances explicitly');
 if(seen.has(value))throw Error('Inspection data contains a cycle');seen.add(value);
 let result;
 if(Array.isArray(value))result=value.map(v=>plain(v,seen));
 else {result={};for(const [key,d] of Object.entries(Object.getOwnPropertyDescriptors(value))){if(!d.enumerable)continue;if(!('value' in d))throw Error('Expose plain data instead of getters: '+key);Object.defineProperty(result,key,{value:plain(d.value,seen),enumerable:true,writable:true,configurable:true});}}
 seen.delete(value);return result;
}
export function meshSnapshot(id,mesh,metadata={}) {
 const attributes={};for(const key of ['normals','attrs','bodies','facade'])if(mesh[key]!==undefined)attributes[key]=plain(mesh[key]);
 for(const [key,value] of Object.entries(mesh.attributes??{}))attributes[key]=plain(value);
 return {id,positions:plain(mesh.positions),indices:plain(mesh.indices),attributes,metadata:plain(metadata)};
}
export function graphSnapshot(id,graph,metadata={}) {
 const nodes=graph.nodes.map(n=>({id:String(n.id),...(n.label?{label:n.label}:{}),...(n.position?{position:plain(n.position)}:n.x!==undefined?{position:[n.x,n.y??0,n.z??0]}:{}),data:plain(n.data??n)}));
 const edges=graph.edges.map((e,i)=>({id:String(e.id??i),from:String(e.from??e.a),to:String(e.to??e.b),directed:e.directed??e.oneWay??false,
  ...(e.points?{points:plain(e.points)}:e.path?.x?{points:Array.from(e.path.x,(x,i)=>[x,0,e.path.z[i]])}:{}),data:plain(e.data??e)}));
 return {id,nodes,edges,metadata:plain({...('bounds' in graph?{bounds:graph.bounds}:{}),...('at' in graph?{adjacency:graph.at}:{}),...metadata})};
}
export function gridSnapshot(id,grid,metadata={}) {
 const channels={};for(const [key,v] of Object.entries(grid.channels??{}))channels[key]=plain(v);
 if(!grid.channels)for(const key of ['height','type','flags','dir','water','deck'])if(ArrayBuffer.isView(grid[key])||Array.isArray(grid[key]))channels[key]=plain(grid[key]);
 const info={};for(const key of ['tileSize','stepHeight','chunk','version','id'])if(grid[key]!==undefined)info[key]=grid[key];
 return {id,width:grid.width,height:grid.depth??grid.rows??(typeof grid.height==='number'?grid.height:undefined),channels,metadata:plain({...info,...metadata})};
}
export function createInspectionProbe() {
 const readers=new Map();
 return Object.freeze({
  register(id,kind,read){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||!['mesh','graph','grid','state'].includes(kind)||typeof read!=='function')throw Error('Register an id, mesh/graph/grid/state kind and reader function');if(readers.has(id))throw Error('Duplicate inspection reader: '+id);readers.set(id,{kind,read});return ()=>readers.delete(id);},
  snapshot({frame,seconds,metadata={}}={}) {
   const result={version:1,schema:'keel-inspection@1',meshes:[],graphs:[],grids:[],state:{},metadata:plain(metadata),...(frame!==undefined?{frame}:{}),...(seconds!==undefined?{seconds}:{})};
   for(const [id,{kind,read}] of readers){const v=read();if(v?.then)throw Error('Inspection readers must synchronously read the same frame');
    if(kind==='mesh')result.meshes.push(meshSnapshot(id,v));else if(kind==='graph')result.graphs.push(graphSnapshot(id,v));else if(kind==='grid')result.grids.push(gridSnapshot(id,v));else Object.defineProperty(result.state,id,{value:plain(v),enumerable:true});}
   return result;
  }
 });
}
