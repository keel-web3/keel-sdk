import { indexRoot } from '../index/root.mjs';
import { applyChallenge } from '../challenge/index.mjs';
const order = (a,b) => a.height-b.height || a.txIndex-b.txIndex;
export function writerChain(updates, {authority,recipe,hostHashes,pins=[],cap=null,resolveCorrection=()=>null}) {
  const accepted=[], ignored=[], equivocations=[], first=new Map();
  let prev=null, prevRoot=null, height=-1, announced=[], entries=[], applied=new Set();
  for (const u of updates) {
    const key=u.prev ?? 'genesis';
    if (first.has(key)) { equivocations.push([first.get(key),u.id]); ignored.push(u.id); continue; }
    if (u.p !== 'koc1' || u.op !== 'index' || u.parent !== authority || u.r !== recipe || u.prev !== prev || u.prevRoot !== prevRoot || !Number.isInteger(u.h) || u.h < height || u.hash !== hostHashes[u.h] || !Array.isArray(u.new) || (u.applied !== undefined && !Array.isArray(u.applied))) { ignored.push(u.id); continue; }
    const history=[...announced,...u.new];
    if (new Set(history.map(x=>x.txid)).size !== history.length || history.some((x,i)=> x.height > u.h || (i && order(history[i-1],x)>=0))) { ignored.push(u.id); continue; }
    let projected=[...entries,...u.new], known=new Set(applied), bad=false;
    for (const id of u.applied || []) {
      if (known.has(id)) continue;
      const correction=resolveCorrection(id, projected, u);
      if (!correction || correction.valid !== true || typeof correction.resolveEntry !== 'function') { bad=true; break; }
      try { projected=applyChallenge(projected,correction.challenge,correction.resolveEntry); } catch { bad=true; break; }
      known.add(id);
    }
    let root;
    try { root=indexRoot({recipe,height:u.h,blockhash:u.hash,members:cap === null ? projected : projected.slice(0,cap),refunds:cap === null ? [] : projected.slice(cap)}); } catch { bad=true; }
    if (bad || u.root !== root.indexRoot || u.count !== root.count || u.over !== root.over) { ignored.push(u.id); continue; }
    first.set(key,u.id); accepted.push(u); announced=history; entries=projected; applied=known; prev=u.id; prevRoot=u.root; height=u.h;
  }
  const usable=pins.every(p => accepted.some(u=>u.id===p.updateId && u.root===p.root));
  return {accepted:accepted.map(u=>u.id),ignored,equivocations,usable,h:usable && accepted.length ? height : null,announced:announced.map(x=>x.txid),applied:[...applied],entries:usable ? entries : []};
}
// verifyEntry is mandatory: unknown evidence must never become a member.
export function merge({originals,registry=[],self=[],challenges=[],ch=[],q,W,unresolved=false,verifyEntry}) {
  if (typeof verifyEntry !== 'function' || !Number.isInteger(q) || q<1 || !Number.isInteger(W) || W<1) throw Error('invalid merge parameters');
  const votes=originals.filter(w=>w.usable && w.h !== null).map(w=>w.h).sort((a,b)=>b-a), C=votes.length>=q ? votes[q-1] : null;
  const all=[...originals,...registry].flatMap(w=>w.usable ? w.entries : []).concat(self,challenges,ch), seen=new Map();
  for (const x of all) if (verifyEntry(x) === true && !seen.has(x.txid)) seen.set(x.txid,x);
  const rows=[...seen.values()].sort(order);
  return {C,entries:rows.map((x,i)=>({id:x.id,txid:x.txid,n:i+1,settled:C!==null && x.height<=C,final:C!==null && x.height+W<=C && !unresolved}))};
}
