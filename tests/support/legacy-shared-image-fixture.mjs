import {createHash} from 'node:crypto';
import {buildKeelLegacyPreparedDenseDocument} from '../../packages/sdk/dist/legacy-prepared-dense-copy.js';
import {buildKeelInlineTokenURIGraph} from '../../packages/sdk/dist/inline-viewer-graph.js';
import {encodeKeelLegacySharedImageCopyProgram} from '../../packages/sdk/dist/legacy-shared-image-program.js';
export const sha = value=>'0x'+createHash('sha256').update(value).digest('hex');
export const poster=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64');
export const source=Buffer.from('<!doctype html><html><head><style>#css{width:8px;height:8px;background-image:url("p\\6f ster.png")}</style></head><body><div id="css"></div><script>const name=["poster","png"].join(".");const p=__KEEL_CONTENT__.bytes(name);let b="";for(const v of p)b+=String.fromCharCode(v);const css=getComputedStyle(document.getElementById("css")).backgroundImage;const image=new Image;image.onload=()=>top.postMessage({keelOfflineProbe:"shared:"+btoa(b)+":"+__KEEL_CONTEXT__.tokenId+":"+(css.includes("data:image/png;base64,"))},"*");image.src=css.slice(5,-2)</script></body></html>'+'<!-- original source identity -->'.repeat(40));
export async function sharedFixture() {
  const resources=[{id:'index.html',aliases:['index.html','./index.html'],role:'entrypoint',mediaType:'text/html',bytes:source},{id:'poster.png',aliases:['poster.png','./poster.png'],role:'asset',mediaType:'image/png',bytes:poster}];
  const built=await buildKeelLegacyPreparedDenseDocument({chainId:11155111,entryId:'index.html',posterResourceId:'poster.png',sharedCollectorImageResourceId:'poster.png',resources});
  const graph=await buildKeelInlineTokenURIGraph(built.document);
  const imageObjectId=sha(Buffer.concat([Buffer.from('native-image:'),poster]));
  const objects=new Map([[imageObjectId,{bytes:poster,mediaType:'image/png'}]]);
  const fragments=graph.parts.map((part,index)=>{
    if(index===built.sharedCollectorImage.documentPartIndex)return null;
    const objectId=sha(Buffer.concat([Buffer.from('copy:'),Buffer.from(part.bytes)]));
    objects.set(objectId,{bytes:part.bytes,mediaType:graph.mediaType});
    return {objectId,digest:sha(part.bytes)};
  });
  const program=encodeKeelLegacySharedImageCopyProgram({graph,sharedCollectorImage:built.sharedCollectorImage,imageObjectId,fragments});
  const programObjectId=sha(Buffer.concat([Buffer.from('program:'),Buffer.from(program.bytes)]));
  objects.set(programObjectId,{bytes:program.bytes,mediaType:program.mediaType});
  return {built,graph,program,programObjectId,imageObjectId,objects,fragments,resources};
}
