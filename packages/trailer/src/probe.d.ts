export interface InspectionMesh {id:string;positions:number[];indices:number[];attributes?:Record<string,number[]>;metadata?:Record<string,unknown>}
export interface InspectionNode {id:string;label?:string;position?:number[];data?:Record<string,unknown>}
export interface InspectionEdge {id:string;from:string;to:string;directed?:boolean;points?:number[][];data?:Record<string,unknown>}
export interface InspectionGraph {id:string;nodes:InspectionNode[];edges:InspectionEdge[];metadata?:Record<string,unknown>}
export interface InspectionGrid {id:string;width:number;height:number;channels:Record<string,number[]>;metadata?:Record<string,unknown>}
export interface InspectionSnapshot {version:1;schema:'keel-inspection@1';frame?:number;seconds?:number;meshes?:InspectionMesh[];graphs?:InspectionGraph[];grids?:InspectionGrid[];state?:Record<string,unknown>;metadata?:Record<string,unknown>}
export function meshSnapshot(id:string,mesh:{positions:ArrayLike<number>;indices:ArrayLike<number>;normals?:ArrayLike<number>;attrs?:ArrayLike<number>;bodies?:ArrayLike<number>;facade?:ArrayLike<number>;attributes?:Record<string,ArrayLike<number>>},metadata?:Record<string,unknown>):InspectionMesh;
export function graphSnapshot(id:string,graph:{nodes:readonly any[];edges:readonly any[]},metadata?:Record<string,unknown>):InspectionGraph;
export function gridSnapshot<T extends {width:number;depth?:number;rows?:number;height?:number|ArrayLike<number>;channels?:Record<string,ArrayLike<number>>}> (id:string,grid:T,metadata?:Record<string,unknown>):InspectionGrid;
export function createInspectionProbe():{register(id:string,kind:'mesh'|'graph'|'grid'|'state',read:()=>unknown):()=>boolean;snapshot(options?:{frame?:number;seconds?:number;metadata?:Record<string,unknown>}):InspectionSnapshot};

declare global { interface Window { __KEEL_INSPECTION__?:ReturnType<typeof createInspectionProbe> } }
