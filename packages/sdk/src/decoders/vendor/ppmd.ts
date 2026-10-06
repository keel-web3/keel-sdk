import {createPpmdRuntime} from './ppmd-runtime.js';
/** K7 v1: magic K7, model order, log2 workspace, then PPMd7H range bytes.
 * Exact decoded length and both hashes are committed by the enclosing reader. */
export function createPpmdTask(input: Uint8Array, options: Record<string, unknown>) {
 const length=options.decodedByteLength as number, limit=options.maxDictionaryBytes as number, maxWork=options.maxWork as number;
 if(input.length<9||input.length>4*1024*1024||input[0]!==75||input[1]!==55||input[2]!<2||input[2]!>16||input[3]!<20||input[3]!>26||2**input[3]!>limit) throw new RangeError('Invalid or excessive KEEL PPMd model');
 let runtime: ReturnType<typeof createPpmdRuntime>|undefined, at=0, finished=false, output=new Uint8Array(0);
 const dispose=()=>{runtime?.reset();runtime=undefined;};
 if(length===0)finished=true;
 else {
  runtime=createPpmdRuntime();runtime.reset();
 }
 const p=runtime?.allocate(input.length-4), q=runtime?.allocate(length);
 let state=0;
 if(runtime){if(!p||!q){dispose();throw new RangeError('PPMd arena exhausted');}
  new Uint8Array(runtime.memory.buffer).set(input.subarray(4),p);
  state=runtime.start(p,input.length-4,input[2],2**input[3]!);
  if(!state){dispose();throw new Error('Invalid PPMd range stream');}
 }
 return {get done(){return finished}, get bytes(){return output}, dispose, step(work:number){
  if(finished)return;
  const count=Math.min(work,65536,length-at);
  if(at+count>maxWork)throw new RangeError('PPMd work limit exceeded');
  if(!runtime||runtime.step(state,q!+at,count)!==0)throw new Error('Truncated or corrupt PPMd stream');
  at+=count;
  if(at===length){output=new Uint8Array(runtime.memory.buffer).slice(q,q!+length);finished=true;}
 }};
}
