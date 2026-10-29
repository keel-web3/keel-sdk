import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {prepareStudioArtifact} from "../packages/studio-core/dist/index.js";
const bytes=new Uint8Array(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==","base64"));
const make=(name,stack)=>prepareStudioArtifact({id:"generated-label-fixture",name:"Exact bytes",assets:[{id:"original",fileName:name,mediaType:"image/gif",bytes,...(stack?{stack}:{})}]});
for(const name of ["a".repeat(150)+".gif","雪💫".repeat(70)+" (4).gif"]){
  test("generated stack label is bounded while original filename and byte identity survive: "+name.slice(0,8),async()=>{
    const result=await make(name),resource=result.resources.find(item=>item.resource.id==="original");
    assert.ok(result.manifest.stack.components.every(item=>item.label.length>0&&item.label.length<=96));
    assert.equal(resource.resource.originalName,name);assert.equal(resource.decodedIntegrity.digest,"0x"+createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(resource.decodedBytes,bytes);
  });
}
test("explicit stack labels retain their validation and exact values",async()=>{
  const stack={label:"chosen label",role:"image",format:"asset"};
  assert.equal((await make("a".repeat(150)+".gif",stack)).manifest.stack.components.find(item=>item.id==="original").label,stack.label);
  await assert.rejects(make("safe.gif",{...stack,label:"x".repeat(97)}),/Component labels must contain from 1 through 96 characters/);
});
