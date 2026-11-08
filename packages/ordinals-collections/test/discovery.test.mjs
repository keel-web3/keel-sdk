import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serializeTx} from '../src/tx.ts';
import {envelope} from '../src/envelope.ts';
import {discoverRecipes} from '../indexer/discovery.mjs';
const metadata={p:'koc1',op:'recipe',m:Buffer.alloc(32,1)};
const script=envelope(metadata,Buffer.alloc(36));
const make=scriptPubKey=>serializeTx({inputs:[{txid:'00'.repeat(32),vout:0,scriptSig:'',witness:['00',script,'c0'+'00'.repeat(32)]}],outputs:[{value:0,script:scriptPubKey}]}).toString('hex');
test('recipe discovery requires the marker and tag 7',()=>{
 const marker='6a284b4f4331'+'00'.repeat(36), matches=discoverRecipes(make(marker));
 assert.equal(matches.length,1);assert.equal(matches[0].metadata.op,'recipe');
 assert.equal(discoverRecipes(make('6a00')).length,0);
});
