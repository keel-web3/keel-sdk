import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root='/private/tmp/keel-independent-native-gif-portability-20261022-01/keel-sdk';
const current=await import(`${root}/scripts/test-suites.mjs`);
const oldText=execFileSync('git',['-C',root,'show','189ec0b:scripts/test-suites.mjs'],{encoding:'utf8'});
const additions=['tests/media-frame-request-snapshot.test.mjs','tests/native-media-frame-read.test.mjs','tests/native-gif-source-identity.test.mjs'];
const exactInsertion=additions.map(s=>`  "${s}",\n`).join('');
assert.equal(oldText.replace('  "tests/media-preparation.test.mjs",\n', '  "tests/media-preparation.test.mjs",\n'+exactInsertion),readFileSync(`${root}/scripts/test-suites.mjs`,'utf8'));
// Import only the historical classification module. Substitute its source directory
// because a data URL itself has no file dirname; no production module is substituted.
const before=await import(`data:text/javascript;base64,${Buffer.from(oldText.replaceAll('import.meta.dirname',JSON.stringify(`${root}/scripts`))).toString('base64')}`);
const beforeFiles=before.TEST_FILES_ON_DISK.filter(f=>f!=='tests/native-gif-source-identity.test.mjs');
const oldIssues=before.validateTestSuiteClassification(beforeFiles);
assert.deepEqual(oldIssues,['unclassified tests: tests/media-frame-request-snapshot.test.mjs, tests/native-media-frame-read.test.mjs']);
assert.deepEqual(current.validateTestSuiteClassification(),[]);
for(const kind of ['BROWSER_TEST_FILES','SIBLING_CONFORMANCE_TEST_FILES','LOCAL_EVM_TEST_FILES','LIVE_TEST_FILES'])assert.deepEqual(current[kind],before[kind]);
assert.deepEqual(current.DETERMINISTIC_TEST_FILES.filter(f=>!before.DETERMINISTIC_TEST_FILES.includes(f)),additions);
assert.deepEqual(before.DETERMINISTIC_TEST_FILES.filter(f=>!current.DETERMINISTIC_TEST_FILES.includes(f)),[]);
const results={oldIssues,newIssues:[],deterministicAdded:additions,removed:[],otherGroupsUnchanged:true,exactThreeLineInsertion:true,containsSiblingEvidenceDir:false};
for(const file of ['tests/media-frame-request-snapshot.test.mjs','tests/native-gif-source-identity.test.mjs'])assert.ok(!readFileSync(`${root}/${file}`,'utf8').includes('../../evidence/'));
console.log(JSON.stringify(results,null,2));
