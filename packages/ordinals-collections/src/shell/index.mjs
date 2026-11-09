import { b, hex, cat, u32, le32, dsha, reverse, parseBlock, formCheck, recipeCheck, marker, acceptControls, proof } from '../core.ts';
import { writerChain, merge } from '../merge/index.mjs';
import { validateChallenge } from '../challenge/index.mjs';
import { classifyEntries } from '../index/classify.mjs';
import { Recursion, IncompleteEvidence, selfFromLocation, walk, normalize } from './recursion.mjs';
export { Recursion, IncompleteEvidence, selfFromLocation, walk, routeId, inscriptionId } from './recursion.mjs';
const uint = n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;
const order = (a,b) => a.height-b.height || a.txIndex-b.txIndex;
const rowKey = row => JSON.stringify([row.txid,row.height,row.txIndex,row.m,row.paymentOutpoint]);
const tripleKey = row => JSON.stringify([row.txid,row.height,row.txIndex]);

// S10–S14 consume this result in K4; this is not an owner/burn, art, bridge,
// challenge-discovery or full-window-audit badge.
export function shellPolicy({height,tip,F,W,C,recipeValid,inIndex,count,ownValid,unresolved=false,incomplete=false}) {
  const depth = uint(height) && uint(tip) ? Math.max(0,tip-height+1) : 0;
  const eligible = !!(recipeValid && inIndex && ownValid && depth >= F && !incomplete);
  return {depth,eligible,final:eligible && C !== null && height+W <= C && !unresolved,
    entryAssurance:count > 1000 ? 'sampled' : 'exhaustive',ownEntryAssurance:ownValid ? 'full' : 'failed'};
}
// Stable, evenly spaced sample including both ends. The self entry is always
// checked separately. The explicit assurance survives into every verdict.
export function positionSample(prior, memberCount, sampleSize=64) {
  if (!uint(sampleSize) || sampleSize < 2) throw Error('sample size must be at least two');
  if (memberCount <= 1000 || prior.length <= sampleSize) return prior;
  return Array.from({length:sampleSize},(_,i)=>prior[Math.floor(i*(prior.length-1)/(sampleSize-1))]);
}
function headerFromInfo(info) {
  if (![info.version,info.nonce,info.timestamp].every(uint) || !/^[a-f0-9]{64}$/.test(info.previous_block) || !/^[a-f0-9]{64}$/.test(info.merkle_root)) throw new IncompleteEvidence('S7: header fields unavailable');
  const bits = typeof info.bits === 'string' && /^[a-f0-9]{8}$/.test(info.bits) ? parseInt(info.bits,16) : info.bits;
  if (!uint(bits)) throw Error('S7: malformed bits');
  return cat(le32(info.version),reverse(info.previous_block),reverse(info.merkle_root),le32(info.timestamp),le32(bits),le32(info.nonce));
}
export function headerHasWork(header) {
  const bytes = b(header), bits = bytes.readUInt32LE(72), exponent = bits >>> 24, mantissa = bits & 0x7fffff;
  if ((bits & 0x800000) || !mantissa || exponent > 34) return false;
  const target = exponent <= 3 ? BigInt(mantissa) >> BigInt(8*(3-exponent)) : BigInt(mantissa) << BigInt(8*(exponent-3));
  const limit = 0xffffn << 208n; // Bitcoin/testnet4 powLimit; no retarget claim.
  return target > 0n && target <= limit && BigInt('0x'+hex(reverse(dsha(bytes)))) <= target;
}

export async function verifyShell({location=globalThis.location,fetcher=globalThis.fetch,checkWork=true,sampleSize=64,limits={}} = {}) {
  const client = new Recursion({fetcher,...limits}), reasons = [], checks = {}, deferred = {stages:['S10','S11','S12','S13','S14'],challenges:[]};
  let self, recipe, merged, originals, assurance='exhaustive';
  const result = (status, extra={}) => ({status,reasons,checks,scope:'S1-S9',entryAssurance:assurance,ownEntryAssurance:checks.S2 && checks.S3 && checks.S4 ? 'full' : 'failed',...extra,stats:{...client.stats},deferred});
  try {
    self = selfFromLocation(location); checks.S1=true;
    const own = await client.record(self), ownMeta=normalize(own.metadata);
    if (b(self).readUInt32BE(32) !== 0 || own.tag7 !== 'koc1' || ownMeta?.op !== 'mint') throw Error('S1–S3: not a canonical mint');
    const recipeRecord = await client.record(ownMeta.r);
    recipe = {...normalize(recipeRecord.metadata),id:recipeRecord.id,height:recipeRecord.height};
    if (recipeRecord.tag7 !== 'koc1' || !recipeRecord.tx.outputs.some(o=>o.value===0 && o.script===marker('00'.repeat(36)))) throw Error('S5: recipe marker or tag');
    // Same-block ordering is obtained from the verified block, never ord number.
    const blocks = new Map(), hashes = {};
    async function block(height) {
      if (!blocks.has(height)) blocks.set(height,(async()=>{
        const raw = await client.get(`/r/block/${height}`);
        if (typeof raw !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(raw)) throw Error('S8: malformed block hex');
        const parsed = parseBlock(raw), hash=await client.hash(height);
        if (!parsed.valid || parsed.internalHash !== hash) throw Error('S7/S8: bad header or block root');
        hashes[height]=hash;
        return {raw,parsed};
      })());
      return blocks.get(height);
    }
    async function locate(record) {
      const {raw,parsed} = await block(record.height), txIndex = parsed.txids.indexOf(record.tx.txid);
      if (txIndex < 0) throw Error('S8: reveal missing from block');
      const position = {mint:record.tx.txid,height:record.height,txIndex,total:parsed.txids.length,branch:proof(parsed.txids,txIndex,true).map(x=>x.hash),header:raw.slice(0,160),rawBlock:raw};
      // parseBlock authenticated every stripped txid and the complete Merkle
      // tree once per height. S8 permits this full-block route; do not reparse
      // the same block for every preceding member.
      return {txIndex,position};
    }
    recipe.txIndex=(await locate(recipeRecord)).txIndex;
    const refs={};
    for (const ref of [...(recipe.metadata?.bundles ?? []),recipe.art?.viewer,recipe.indexer].filter(Boolean)) {
      const record = await client.record(ref.id);
      refs[ref.id]={height:record.height,bytes:hex(record.body)};
      if (record.height === recipe.height) refs[ref.id].txIndex=(await locate(record)).txIndex;
    }
    const recipeErrors=recipeCheck(recipe,refs);
    if (recipeErrors.length || recipe.height >= recipe.end.open) throw Error(`S5: recipe ${recipeErrors.join(',')}`);
    checks.S5=true;
    const recipeChildren=await walk(recipe.id,{client,...limits});
    const controls=recipeChildren.records.filter(r=>r.tag7==='koc1' && r.metadata?.op==='control').map(r=>({...normalize(r.metadata),id:r.id,parent:recipe.id,height:r.height}));
    const ownPosition=await locate(own);
    const ownEntry={...formCheck({...own,recipe,height:own.height,txIndex:ownPosition.txIndex,charms:own.info.charms}),id:self};
    checks.S2=true;
    if (ownEntry.error) throw Error(`S3/S4: ${ownEntry.error}`);
    checks.S3=true; checks.S4=true; checks.S8=true;
    const tip=await client.get('/r/blockheight');
    if (!uint(tip) || tip < own.height) throw new IncompleteEvidence('S6: chain tip unavailable');
    checks.S6=tip-own.height+1>=recipe.finality;
    if (checkWork) {
      if (tip < own.height+recipe.finality) throw new IncompleteEvidence('S7: linked successors not yet available');
      let previous=null;
      for (let h=own.height;h<=own.height+recipe.finality;h++) {
        const header=headerFromInfo(await client.get(`/r/blockinfo/${h}`)), hash=await client.hash(h);
        if (hex(dsha(header))!==hash || !headerHasWork(header) || (previous && hex(header.subarray(4,36))!==previous)) throw Error('S7: header binding, PoW or linkage');
        previous=hash;
      }
      checks.S7=true;
    } else checks.S7='optional work check disabled; block header binding still checked';
    const ownChildren=await walk(self,{client,...limits});
    const pins=(ownMeta.seen ?? []).map(([writerIndex,updateId,root])=>({writerIndex,updateId,root}));
    for (const record of ownChildren.records) {
      const m=normalize(record.metadata);
      if (record.tag7!=='koc1' || m?.op!=='koc1-pin') continue;
      // Pins have exactly the same triple schema as seen; no localStorage fallback.
      const triples=m.seen ?? m.pins;
      if (!Array.isArray(triples) || !triples.every(x=>Array.isArray(x)&&x.length===3&&uint(x[0])&&x[0]<recipe.writers.length&&/^[a-f0-9]{72}$/.test(x[1])&&/^[a-f0-9]{64}$/.test(x[2]))) continue;
      pins.push(...triples.map(([writerIndex,updateId,root])=>({writerIndex,updateId,root})));
    }
    const walks=[];
    for (const w of recipe.writers) {
      try { walks.push(await walk(w.authority,{client,...limits})); }
      catch (error) { if (!(error instanceof IncompleteEvidence)) throw error; walks.push({records:[],ignored:[]}); reasons.push(`writer unavailable: ${w.authority}`); }
    }
    // K4 consumes all discovered challenges and the additional ch/fragment/audit
    // channels. Invalid-entry evidence is already usable by S9 below.
    const challengeRecords=[...walks.flatMap(w=>w.records),...ownChildren.records].filter(r=>r.tag7==='koc1' && r.metadata?.op==='challenge');
    deferred.challenges=challengeRecords.map(r=>r.id);
    const updates=walks.map((w,i)=>w.records.filter(r=>r.tag7==='koc1' && r.metadata?.op==='index').map(r=>({...normalize(r.metadata),id:r.id,parent:recipe.writers[i].authority})));
    for (const u of updates.flat()) if (uint(u.h) && u.h<=tip) {
      try {hashes[u.h]=await client.hash(u.h);}
      catch (error) {if (!(error instanceof IncompleteEvidence)) throw error;}
    }
    const rows=new Map([[ownEntry.txid,ownEntry]]), evidence=new Map([[ownEntry.txid,{validity:'valid',entry:ownEntry}]]);
    const compactUnknown=new Map();
    for (let w=0;w<updates.length;w++) for (const u of updates[w]) {
      if (Array.isArray(u.new) && u.new.length>1000) throw new IncompleteEvidence('update entry budget exhausted');
      if (!Array.isArray(u.new)) continue;
      u.new=u.new.map(x=>Array.isArray(x)?{txid:x[0],height:x[1],txIndex:x[2],m:x[3],paymentOutpoint:x[4]}:x);
      // The compact triple wire form needs m and P for the existing commitment
      // primitive. Read those from authentic mint bytes, never invent them.
      for (let i=0;i<u.new.length;i++) {
        const x=u.new[i];
        if (!x.m || !x.paymentOutpoint) {
          try {
            const r=await client.record(x.txid+'00000000'), m=normalize(r.metadata);
            u.new[i]={...x,m:m?.m,paymentOutpoint:x.txid+'00000001'};
          } catch (error) {
            const validity=error instanceof IncompleteEvidence?'unknown':'invalid';
            evidence.set(x.txid,{validity,entry:x});
            if (validity==='unknown') {
              const key=tripleKey(x);
              if (!compactUnknown.has(key)) compactUnknown.set(key,new Set());
              compactUnknown.get(key).add(w);
            }
            // Leave the commitment fields absent. K1 must reject an update
            // whose root cannot be checked; never fabricate m/P or a vote.
          }
        }
        if (!rows.has(x.txid)) rows.set(x.txid,u.new[i]);
      }
    }
    const inspect=async row=>{
      if (evidence.has(row.txid)) return evidence.get(row.txid);
      let value;
      try {
        const r=await client.record(row.txid+'00000000');
        const position=await locate(r), entry=formCheck({...r,recipe,height:r.height,txIndex:position.txIndex,charms:r.info.charms});
        value={validity:entry.error?'invalid':'valid',entry:entry.error?row:{...entry,id:r.id},position:position.position};
      } catch (error) {
        value={validity:error instanceof IncompleteEvidence?'unknown':'invalid',entry:row};
      }
      evidence.set(row.txid,value); return value;
    };
    // Authenticate invalid challenges against actual entries of the named
    // update; unknown responses cannot delete anything. Other kinds are K4.
    const corrections=new Map(), invalidTxids=new Set();
    for (const record of challengeRecords.slice(0,32)) {
      const c={...normalize(record.metadata),id:record.id};
      if (c.kind!=='invalid') continue;
      const row=rows.get(c.mint); if (!row) continue;
      const found=await inspect(row);
      if (found.position) Object.assign(c,found.position);
      for (let w=0;w<updates.length;w++) {
        const at=updates[w].findIndex(u=>u.id===c.index);
        if (at<0) continue;
        const cache={...updates[w][at],entries:updates[w].slice(0,at+1).flatMap(u=>u.new??[])};
        if (validateChallenge(c,cache,id=>evidence.get(id),hashes)) {if(found.validity==='invalid')invalidTxids.add(c.mint);corrections.set(c.id,{valid:true,challenge:c,resolveEntry:id=>evidence.get(id)});}
      }
    }
    originals=updates.map((us,i)=>writerChain(us,{authority:recipe.writers[i].authority,recipe:recipe.id,hostHashes:hashes,pins:pins.filter(p=>p.writerIndex===i),policy:recipe,controls,resolveCorrection:id=>corrections.get(id)}));
    const union=new Map([[ownEntry.txid,ownEntry]]);
    const claims=new Map(), tripleClaims=new Map();
    for (let w=0;w<originals.length;w++) for (const row of originals[w].entries) {
      if (!union.has(row.txid)) union.set(row.txid,row);
      for (const [map,key] of [[claims,rowKey(row)],[tripleClaims,tripleKey(row)]]) {
        if (!map.has(key)) map.set(key,new Set());
        map.get(key).add(w);
      }
    }
    for (const found of evidence.values()) if (found.validity==='valid') union.set(found.entry.txid,found.entry);
    const corroborated=row=>(claims.get(rowKey(row))?.size??0)>=recipe.quorum;
    // Only matching claims from q accepted writer chains may enable sampling.
    const provisional=classifyEntries([...union.values()].filter(row=>corroborated(row) && !['invalid','unknown'].includes(evidence.get(row.txid)?.validity)),recipe,controls), memberCount=provisional.members.length;
    assurance=memberCount>1000?'sampled':'exhaustive';
    const prior=[...union.values()].filter(row=>order(row,ownEntry)<0).sort(order);
    const sampled=positionSample(prior.filter(corroborated),memberCount,sampleSize), rejected=new Set(invalidTxids), checked=new Set();
    const check=async row=>{
      const found=await inspect(row);
      checked.add(row.txid);
      if (found.validity!=='valid') rejected.add(row.txid);
      else union.set(row.txid,found.entry); // independently proven coordinates win
      return found;
    };
    // Minority claims never inherit sampled trust, even when their claimed
    // coordinates place them after self. Authentic coordinates may differ.
    for (const row of union.values()) if (!corroborated(row)) await check(row);
    let badSample=false;
    for (const row of sampled) {
      const found=await check(row);
      if (found.validity==='invalid' || (found.validity==='valid' && rowKey(row)!==rowKey(found.entry))) badSample=true;
    }
    if (badSample) {
      // A writer caught in the sample cannot keep unchecked claims on this
      // load. Check the entire union, including potentially false positions
      // after self, without imposing a lasting ban on that writer.
      for (const row of union.values()) if (!checked.has(row.txid)) await check(row);
      assurance='exhaustive';
    }
    let incomplete=false;
    // A minority variant selected first for the union must not hide matching
    // unknown claims from q later writers.
    for (const w of originals) for (const row of w.entries) if (evidence.get(row.txid)?.validity==='unknown' && corroborated(row)) incomplete=true;
    for (const [key,writers] of compactUnknown) {
      const support=new Set([...writers,...(tripleClaims.get(key)??[])]);
      if (support.size>=recipe.quorum) incomplete=true;
    }
    if (incomplete) reasons.push('S9: quorum-corroborated row evidence unavailable');
    // All rows selected for verification have been checked. Beyond the sample,
    // preserve the cache claim explicitly as sampled, never exhaustive.
    for (const w of originals) w.entries=w.entries.map(x=>union.get(x.txid)??x);
    merged=merge({originals,self:[ownEntry],ch:[...evidence.values()].filter(x=>x.validity==='valid').map(x=>x.entry),q:recipe.quorum,W:recipe.challengeWindow,policy:recipe,controls,unresolved:challengeRecords.length>0||incomplete,verifyEntry:x=>!rejected.has(x.txid)&&evidence.get(x.txid)?.validity!=='unknown'});
    checks.S9=true;
    const member=merged.entries.find(x=>x.txid===ownEntry.txid), refund=merged.refund.find(x=>x.txid===ownEntry.txid);
    const policy=shellPolicy({height:own.height,tip,F:recipe.finality,W:recipe.challengeWindow,C:merged.C,recipeValid:true,inIndex:!!member,count:memberCount,ownValid:true,unresolved:challengeRecords.length>0,incomplete});
    const extra={self,recipe:recipe.id,rank:member?.n??null,C:merged.C,depth:policy.depth,final:policy.final,incomplete,originals,merged,controls:acceptControls(recipe,controls),checkedPrior:prior.filter(row=>checked.has(row.txid)).length};
    if (!member) {reasons.push(refund?.reason??'before-open');return result('not member',extra);}
    if (!policy.final) {if (!incomplete) reasons.push(!checks.S6?'insufficient confirmations':merged.C===null?'no writer quorum':challengeRecords.length?'challenges await S10 resolution':'challenge window not covered');return result('settling',extra);}
    reasons.push(assurance==='sampled'?'quorum member; preceding entries sampled':'quorum member; preceding entries checked');
    return result('member',extra);
  } catch (error) {
    reasons.push(error.message);
    return result(error instanceof IncompleteEvidence?'settling':'invalid',{self,recipe:recipe?.id,rank:null,C:merged?.C??null,final:false});
  }
}
