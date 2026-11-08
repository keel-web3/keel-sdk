import {acceptControls} from '../controls.ts';
const order=(a,b)=>a.height-b.height||a.txIndex-b.txIndex;
// Entries have already passed independent mint-form validation. Policy and
// controls are authenticated by the caller, and are mandatory for membership.
export function classifyEntries(entries,policy,controls=[],height=0xffffffff) {
 if(!policy?.end || !Number.isSafeInteger(policy.end.open) || policy.end.open<0)throw Error('recipe policy required');
 const end=policy.end;
 let cap=end.max??null, sold=null;
 if(cap!==null&&(!Number.isInteger(cap)||cap<1))throw Error('invalid cap');
 const accepted=policy.controls ? acceptControls(policy,controls).accepted : [];
 const valid=[],refund=[],pending=[],before=[];
 const sorted=entries.filter(e=>{if(!Number.isInteger(e.height)||e.height<0||e.height>0xffffffff||!Number.isInteger(e.txIndex)||e.txIndex<0||e.txIndex>0xffffffff){pending.push(e);return false}return e.height<=height}).sort(order);
 const heights=[...new Set([...sorted.map(e=>e.height),...accepted.filter(c=>c.at<=height).map(c=>c.at)])].sort((a,b)=>a-b);
 for(const h of heights){
  let paused=false,close=end.close??null;
  for(const c of accepted){if(c.action==='close')close=Math.min(close??Infinity,c.at);if(c.at<=h){if(c.action==='pause')paused=true;if(c.action==='resume')paused=false}}
  const active=h>=end.open && (close===null||h<=close) && !paused && (sold===null||h<=sold),block=[];
  for(const e of sorted.filter(x=>x.height===h)){if(active)block.push(e);else if(h<end.open)before.push(e);else refund.push({...e,reason:paused?'paused':'late'})}
  const countAt=valid.length+block.length;
  for(const c of accepted.filter(c=>c.action==='lowerCap'&&c.at===h))if(c.cap<cap)cap=Math.min(cap,Math.max(c.cap,countAt));
  valid.push(...block);
  if(cap!==null&&valid.length>=cap&&sold===null)sold=h;
 }
 const members=cap===null?valid:valid.slice(0,cap);
 if(cap!==null)refund.push(...valid.slice(cap).map(x=>({...x,reason:'over-cap'})));
 refund.sort(order);
 return {members,refund,pending,before,cap,sold};
}
