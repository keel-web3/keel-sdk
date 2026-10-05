export interface Rect { x:number; y:number; width:number; height:number }
export interface Tempo { bpm?:number; beatSeconds?:number; firstDownbeat?:number; beats?:number[]; audioSource?:string; mode?:'declared'|'detected'; onsets?:number[] }
export interface Source { id:string; kind:'web'|'gameboy'|'video'|'image'|'audio'; path:string; metadataPath?:string; fps?:number; pixelArt?:boolean; sha256?:string; variants?:{target:string;path:string;metadataPath?:string}[] }
export interface TextCard { lines:string[]; font:string; fontSize?:number; scale?:number; color?:string; background?:string; typingCps?:number; flicker?:boolean; x?:number; y?:number }
export interface Shot { id:string; startBeat:number; beats:number; kind:'video'|'image'|'pair'|'card'|'opening'|'end'; source?:string; secondSource?:string; in?:number; out?:number; speed?:number; ramp?:{beat:number;frame:number}[];rampVariants?:{target:string;ramp:{beat:number;frame:number}[]}[]; holdFrame?:number; transition?:{type:'cut'|'dither'|'scanline-tear'|'glitch'|'match-cut'|'flash';beats?:number;pixelScale?:number;sourceRect?:Rect;targetRect?:Rect;rectSelector?:string;zoomStartBeat?:number;referenceEffect?:string};text?:TextCard;caption?:TextCard;fit?:'contain'|'cover'|'integer';pixelScale?:number;crop?:Rect;energy?:boolean;stutter?:boolean;shake?:boolean }
export interface AudioLayer {id:string;source:string;role:'bed'|'sfx'|'riser';startBeat:number;beats?:number;in?:number;out?:number;gain?:number;fadeIn?:number;fadeOut?:number;fadeOutAt?:number;duck?:{startBeat:number;beats:number;gain:number;attack?:number;release?:number}[]}
export interface Target {id:string;width:number;height:number;safeArea?:Rect;crop?:Rect;maxBytes?:number;loudness?:number;truePeak?:number;posterBeat?:number}
export interface Timeline { version:1; name:string; fps:number; seed?:number; tempo:Tempo; sources:Source[];shots:Shot[];audio?:AudioLayer[];targets:Target[];background?:string;brief?:string;reference?:{profile:'crucible-v3';capturesRoot:string;font:string;title:string;subtitle:string;url:string;handle:string}}
export const TIMELINE_SCHEMA: Readonly<Record<string,unknown>>;
export const CAPTURE_SCHEMA: Readonly<Record<string,unknown>>;
export const TOOL_SCHEMAS: Readonly<Record<string,Record<string,unknown>>>;
export function validateTimeline(t:unknown):{valid:boolean;issues:{path:string;message:string}[]};
export function runTrailerTool(name:string,input:unknown,options?:{workspaceRoot?:string;python?:string;log?:(s:string)=>void;signal?:AbortSignal;checkMachineLoad?:boolean;allowOffload?:boolean}):Promise<any>;
export function runWorker(op:string,input:unknown,options?:{python?:string;log?:(s:string)=>void;signal?:AbortSignal}):Promise<any>;
export function checkLoad(operation:string):number;
export function beatToSeconds(tempo:Tempo,beat:number):number;
export function editSeconds(tempo:Tempo,beat:number):number;
export function boundaryFrame(seconds:number,fps:number):number;
export function sourceFrame(shot:Shot,localBeat:number,localSeconds:number,sourceFps?:number):number;
export function registerCaptureAdapter(name:string,adapter:(capture:Record<string,unknown>,outDir:string,context:unknown)=>Promise<unknown>,optionsSchema?:Record<string,unknown>):void;
export * from './probe.js';
export const INSPECTION_SCHEMA: Readonly<Record<string,unknown>>;
export function assertInspection(snapshot:unknown):import('./probe.js').InspectionSnapshot;
export function queryInspection(snapshot:import('./probe.js').InspectionSnapshot,query:{pointer:string;start?:number;count?:number}):unknown;
