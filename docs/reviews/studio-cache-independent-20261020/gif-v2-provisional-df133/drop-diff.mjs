// Pure diagnostic only. It grants no acceptance and never changes a reference.
import {isDeepStrictEqual} from 'node:util';
import {loadOriginalInput,plain} from './deployed-core.mjs';
import {sha} from './identity.mjs';
const json=x=>JSON.stringify(x,(_k,v)=>typeof v==='bigint'?v.toString():v);
const digest=x=>{const value=json(x);return {canonicalValueBytes:Buffer.byteLength(value),canonicalValueSHA256:sha(value)};};
export function describeDropDifference(capture,{parseAbi,decodeFunctionData,encodeFunctionData,controllerAbi},old=loadOriginalInput()){
 const abi=parseAbi(controllerAbi),declaration=abi.find(x=>x.type==='function'&&x.name==='createDrop');
 const locate=input=>(input?.preparationCalls??[]).flatMap((call,index)=>{try{const decoded=decodeFunctionData({abi,data:call.data});return decoded.functionName==='createDrop'?[{call,index,decoded}]:[];}catch{return[];}});
 const fresh=plain(capture.nativeAssembly?.exactSimulationInput),a=locate(old),b=locate(fresh);
 const base={schema:'keel-unaccepted-create-drop-field-diff@1',accepted:false,fullProgramExecuted:false,referencePolicy:'original arguments with only collection target remapped; unchanged strict verifier remains authoritative',controllerAbiSHA256:sha(json(abi)),originalDropCount:a.length,provisionalDropCount:b.length};
 if(!declaration||a.length!==1||b.length!==1||typeof fresh.metadataTarget!=='string')return {...base,status:'NOT_COMPARABLE'};
 const expected=[...a[0].decoded.args];expected[0]=fresh.metadataTarget;const fields=[];
 function compare(type,left,right,path){
  if(type.type.endsWith('[]')){if(left.length!==right.length)fields.push({path:path+'.length',same:false,expected:digest(left.length),actual:digest(right.length)});for(let i=0;i<Math.min(left.length,right.length);i++)compare({...type,type:type.type.slice(0,-2)},left[i],right[i],path+'['+i+']');return;}
  if(type.type==='tuple'){for(let i=0;i<type.components.length;i++){const c=type.components[i];compare(c,left[c.name]??left[i],right[c.name]??right[i],path+'.'+c.name);}return;}
  fields.push({path,abiType:type.type,same:isDeepStrictEqual(left,right),expected:digest(left),actual:digest(right)});
 }
 declaration.inputs.forEach((p,i)=>compare(p,expected[i],b[0].decoded.args[i],p.name||'arg'+i));
 const expectedData=encodeFunctionData({abi,functionName:'createDrop',args:expected}),actualData=b[0].call.data;
 return {...base,status:'DIAGNOSTIC_ONLY',expectedCalldata:{bytes:(expectedData.length-2)/2,hexTextSHA256:sha(expectedData)},actualCalldata:{bytes:(actualData.length-2)/2,hexTextSHA256:sha(actualData)},exactStrictReferenceEqual:expectedData===actualData,fields,changedPaths:fields.filter(x=>!x.same).map(x=>x.path)};
}
