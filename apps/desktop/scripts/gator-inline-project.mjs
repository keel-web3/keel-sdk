/** Project-specific inputs into the canonical SDK builders. No shell source,
 * contract encoder, signing, or per-token publication objects are created here. */
import assert from 'node:assert/strict';
import {newLayeredArt,defaultPlacement,selectLayeredArt} from '@keel/sdk/layered-art';
import {renderLayeredSVG} from '@keel/sdk/layered-svg';
import {buildKeelInlineLocalDocument,buildKeelInlineImageURI,buildKeelWeb3TokenJSONGraph} from '@keel/sdk/inline-viewer-graph';
const safeJSON=value=>JSON.stringify(value).replaceAll('<','\\u003c');
export async function prepareGatorInlineProject({tokenId,rows,metadata,shell,module,resolve,web3Image}) {
 assert.ok(Number.isInteger(tokenId)&&tokenId>=0&&tokenId<4000);
 assert.ok(rows.length>0&&rows.every(r=>r.width===3750&&r.height===3750));
 const dimensions={width:3750,height:3750};
 const manifest={...newLayeredArt(`TokenGator #${tokenId}`),...dimensions,attributes:rows.map((r,i)=>({id:'layer-'+i,name:r.path,items:[{id:'original',name:r.path,weight:1,variants:[{id:'original',name:'Original',objectId:r.objectId,weight:1}],placements:[defaultPlacement('original',i)],rules:[],usage:{scope:'renderer',renderer:'gator-inline-test',license:'',tags:[]}}]}))};
 const mediaTypes=Object.fromEntries(rows.map(r=>[r.objectId,r.type]));
 const entry=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#383e7b}body{display:grid;grid-template: minmax(0,1fr)/minmax(0,1fr);place-items:center;overflow:hidden}img{display:block;width:100%;height:100%;min-width:0;min-height:0;object-fit:contain}canvas{display:none}</style></head><body><canvas></canvas><img alt="TokenGator #${tokenId}"><script>(async()=>{const art=${safeJSON(manifest)},types=${safeJSON(mediaTypes)};const c=document.querySelector('canvas');const selected=await KEEL_LAYERS.selectLayeredArt(art,'apechain-contract-snapshot','${tokenId}');await KEEL_LAYERS.renderLayeredArt(c,art,selected,async id=>({bytes:await __KEEL_CONTENT__.bytes('asset-'+id),type:types[id]}));document.querySelector('img').src=c.toDataURL('image/png');})().catch(error=>{document.body.textContent=error.message;throw error});</script></body></html>`;
 const unique=[...new Map(rows.map(r=>[r.objectId,r])).values()];
 const assets=await Promise.all(unique.map(async r=>({id:'asset-'+r.objectId,mediaType:r.type,source:await resolve(r),compression:'none'})));
 const document=await buildKeelInlineLocalDocument({shell,modules:[module],assets,entry:{id:'entry',mediaType:'text/html',source:Buffer.from(entry)}});
 const selection=await selectLayeredArt(manifest,'apechain-contract-snapshot',String(tokenId));
 const svg=Buffer.from((await renderLayeredSVG(manifest,selection,async id=>{const a=assets.find(a=>a.id==='asset-'+id);return {bytes:a.source,type:a.mediaType};})).source);
 const tokenIdFields={};
 if(metadata.name===`TokenGator #${tokenId}`)tokenIdFields.name={prefix:'TokenGator #',suffix:''};
 if(metadata.mml===`https://storage.googleapis.com/tokengators/apechain/mml/${tokenId}.mml`)tokenIdFields.mml={prefix:'https://storage.googleapis.com/tokengators/apechain/mml/',suffix:'.mml'};
 const graph=await buildKeelWeb3TokenJSONGraph({document,metadata,imageURI:buildKeelInlineImageURI(svg,'image/svg+xml'),tokenId:String(tokenId),tokenIdFields,web3Image});
 return {graph,svg,document,entry,uniqueLayers:unique.length};
}
