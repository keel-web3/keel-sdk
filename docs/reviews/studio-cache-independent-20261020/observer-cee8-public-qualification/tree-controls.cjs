const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const root='/private/tmp/keel-image-only-release-20261020/docs/reviews/studio-publication-20261020/release/image-only-observer311/';
const{verify}=require(root+'verify-image-tree.cjs'),expected=JSON.parse(fs.readFileSync(root+'evidence/expected-app-tree.json')),base=JSON.parse(fs.readFileSync(root+'evidence/qualified-base-fe455-app-tree.json'));
test('exact observer whole tree with zero external differences',()=>{const r=verify(expected.entries,expected,base);assert.equal(r.entries,36065);assert.deepEqual(r.onlyExternalDifferences,[]);});
test('one installed SDK byte cannot be accepted',()=>{const rows=structuredClone(expected.entries),r=rows.find(x=>x[0].includes('/@keel/sdk/dist/')&&x[1]==='file');assert.ok(r);r[6]='0'.repeat(64);assert.throws(()=>verify(rows,expected,base));});
test('base metadata change cannot be hidden behind old digest',()=>{const b=structuredClone(base);b.entries[0][2]^=1;assert.throws(()=>verify(expected.entries,expected,b));});
test('duplicate actual row cannot be accepted',()=>{const rows=structuredClone(expected.entries);rows.push(structuredClone(rows[0]));assert.throws(()=>verify(rows,expected,base));});
