// Independent K2 review (review/K2 at 23e88f4). Findings: ordinals-orchestra/sprints/KOC1/K2/reports/claude-review.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {xOnly,keyOutput,mintTemplate,buildCommit,buildReveal,bumpRbf,buildCpfp,signTransaction,parseTx,unsignedPsbt,escrowTemplate,buildEscrowSpend} from '../src/index.ts';
const keys=[1,2,3,4,5].map(n=>n.toString(16).padStart(64,'0')),[buyer,treasury,...writers]=keys.map(xOnly);
const payment={treasuryKey:treasury,writerKeys:writers,collectAfter:3,refundAfter:6,earlyRefund:true};
const script=keyOutput(buyer), input={txid:'aa'.repeat(32),vout:0,value:200000,script,internalKey:buyer};
const template=mintTemplate({recipe:'11'.repeat(36),viewer:'22'.repeat(36),minter:buyer});
const commitRaw=()=>signTransaction(buildCommit({template,inputs:[input],value:100000,changeScript:script,fee:1000}),[keys[0]]);
const reveal=()=>buildReveal({commit:commitRaw(),template,payment,recipientScript:script,price:20000,fee:1000,changeScript:script});

// R24/R25 payment integrity: a fee bump must never come out of the escrow payment (or the postage or marker). The
// protection is the plan's protectedOutputs field, not the transaction, so the same reveal rebuilt through the
// exported unsignedPsbt loses it and bumpRbf takes the fee from the escrow output (the mint becomes "underpaid").
test('RBF: a bump cannot reduce the reveal escrow output, whatever plan object carries the reveal', () => {
  const r=reveal(), plain=unsignedPsbt(r.tx,r.prevouts,r.paths), escrowScript=escrowTemplate(payment,buyer).scriptPubKey;
  let bumped; try { bumped=bumpRbf(plain,{fee:3000,changeIndex:1}); } catch { return; }
  const escrowOut=bumped.tx.outputs.find(o=>o.script===escrowScript);
  assert.equal(escrowOut.value,20000,'bumpRbf reduced the escrow payment from 20000');
});

// R25/R27: the writer suffix is `2 NUMEQUAL`, so exactly two writer signatures may be present. Given all three writer
// keys (an automated co-signer that holds its own key plus a backup), signTransaction signs all three, the CHECKSIGADD
// sum is 3 and the spend is consensus-invalid.
test('L_t/L_e: signing with all three writer keys still yields exactly two writer signatures', () => {
  const tree=escrowTemplate(payment,buyer), utxo={txid:'bb'.repeat(32),vout:0,value:50000,script:tree.scriptPubKey};
  for (const [leaf,first] of [['L_t',keys[1]],['L_e',keys[0]]]) {
    const raw=signTransaction(buildEscrowSpend({payment,minter:buyer,leaf,utxo,outputScript:script,fee:1000}),[first,...keys.slice(2)]);
    const w=parseTx(raw).inputs[0].witness, writerSlots=w.slice(0,3);
    assert.equal(writerSlots.filter(s=>s.length).length,2,`${leaf}: ${writerSlots.filter(s=>s.length).length} writer signatures`);
  }
});

// The reveal's output 0 carries the inscription. CPFP must bump from change, never by spending the inscription
// output, which moves the token to the CPFP destination and burns postage as fee.
test('CPFP: the inscription output of a reveal is not a CPFP source', () => {
  const raw=signTransaction(reveal(),[keys[0]]);
  assert.throws(()=>buildCpfp({parent:raw,vout:0,internalKey:buyer,outputScript:'0014'+'33'.repeat(20),fee:30}),'spending reveal vout 0 must be refused');
});
