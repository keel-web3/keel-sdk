import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCompactInlineKeelShell} from '../packages/sdk/dist/verification-shell.js';
const embeddedContainerDelivery={chainId:11155111,store:'0x'+'11'.repeat(20)};
test('omission and an explicit as-is requirement reject the expanding embedded reader',async()=>{
  for(const binaryPayloadCarriage of [undefined,'as-is']){
    await assert.rejects(buildCompactInlineKeelShell({embeddedContainerDelivery,binaryPayloadCarriage}),/emits Base64.*cannot satisfy as-is/);
  }
});
test('invalid or unused carriage options are never silently ignored',async()=>{
  for(const binaryPayloadCarriage of ['hex','octal','raw','',null])await assert.rejects(buildCompactInlineKeelShell({embeddedContainerDelivery,binaryPayloadCarriage}),/Invalid binary payload carriage/);
  await assert.rejects(buildCompactInlineKeelShell({binaryPayloadCarriage:'base64'}),/requires an embedded container profile/);
});
test('an explicit encoded return choice remains a visibly distinct supported profile',async()=>{
  const shell=await buildCompactInlineKeelShell({embeddedContainerDelivery,binaryPayloadCarriage:'base64'});
  assert.equal(shell.resourceProfile,'embedded-shared-containers@1');
  assert.equal(shell.deliveryProfile,'embedded-assembled');
  assert.ok(new TextDecoder().decode(shell.suffix).includes('storedBase64'));
});

for(const binaryPayloadCarriage of ['base90','base91'])test(`explicit ${binaryPayloadCarriage} selects a distinct shell and optional decoder`,async()=>{
 const shell=await buildCompactInlineKeelShell({embeddedContainerDelivery,binaryPayloadCarriage});
 assert.equal(shell.resourceProfile,`embedded-shared-containers-${binaryPayloadCarriage}@1`);
 assert.ok(shell.transportDecoderIntegrity.byteLength<4000);
 assert.ok(new TextDecoder().decode(shell.suffix).includes(`${binaryPayloadCarriage}-v1`));
 assert.ok(new TextDecoder().decode(shell.suffix).includes('storedDense'));
});
