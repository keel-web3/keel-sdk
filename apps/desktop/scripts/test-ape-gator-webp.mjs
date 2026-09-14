/** Local browser proof using the real SDK renderer. No wallet or chain writes. */
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {newLayeredArt,defaultPlacement} from '@keel/sdk/layered-art';
const root=path.resolve('apps/desktop/artifacts/gator-ape-rebuild');
const rows=JSON.parse(await readFile(process.env.KEEL_CODEC_SELECTION??path.join(root,'webp-token-0.json'),'utf8'));
const proofRoot=process.env.KEEL_CODEC_OUTPUT?path.resolve(process.env.KEEL_CODEC_OUTPUT):root;
const audit=JSON.parse(await readFile(path.join(root,'layer-audit.json'),'utf8')).tokens.find(t=>t.tokenId===0);
const selected=audit.stack.map(name=>rows.find(r=>r.path===name));if(selected.some(r=>!r))throw Error('Prepare every token-0 layer first');
const dimensions={width:selected[0].width,height:selected[0].height};
const manifest={...newLayeredArt('TokenGator #0'),...dimensions,attributes:selected.map((r,i)=>({id:'layer-'+i,name:r.path,items:[{id:'original',name:r.path,weight:1,variants:[{id:'original',name:'Original',objectId:r.objectId,weight:1}],placements:[defaultPlacement('original',i)],rules:[],usage:{scope:'renderer',renderer:'gator-ape-test',license:'',tags:[]}}]}))};
const webp=new Map(rows.map(r=>[r.objectId,r]));
const code=`import {renderLayeredArt,encodeLayeredCanvas} from '@keel/sdk/layered-renderer';
import {renderLayeredSVG} from '@keel/sdk/layered-svg';
import {selectLayeredArt,layerDigest} from '@keel/sdk/layered-art';
const manifest=${JSON.stringify(manifest)},width=manifest.width,height=manifest.height,rows=${JSON.stringify(selected.map(r=>({id:r.objectId,path:r.path,type:r.type??'image/webp'})))},status=document.querySelector('#status');
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{const html=button.dataset.view==='html';document.querySelector('#svg-preview').hidden=html;const frame=document.querySelector('#viewer');frame.hidden=!html;if(html&&!frame.src)frame.src='/viewer';};
document.querySelector('#run').onclick=async()=>{document.querySelector('#run').disabled=true;try{
 const resolve=async id=>({bytes:new Uint8Array(await(await fetch('/webp/'+id)).arrayBuffer()),type:rows.find(r=>r.id===id).type});
 const selections=await selectLayeredArt(manifest,'contract-snapshot','0');
 const canvas=document.createElement('canvas');status.textContent='Composing selected layers…';await renderLayeredArt(canvas,manifest,selections,resolve);
 const baseline=document.createElement('canvas');baseline.width=width;baseline.height=height;const ctx=baseline.getContext('2d');
 for(const r of rows){const img=await createImageBitmap(await(await fetch('/png/'+r.id)).blob());ctx.drawImage(img,0,0,width,height);img.close();}
 const compare=(a,b)=>{let changed=0,max=0,sum=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)changed++;max=Math.max(max,d);sum+=d;}return {changedChannels:changed,maxChannelDifference:max,meanChannelDifference:sum/a.length};};
 const actual=canvas.getContext('2d').getImageData(0,0,width,height).data;
 const originalPNGComposition=compare(actual,ctx.getImageData(0,0,width,height).data);
 status.textContent='Checking self-contained SVG preview…';
 const svg=await renderLayeredSVG(manifest,selections,resolve);const image=new Image();image.src=URL.createObjectURL(new Blob([svg.source],{type:svg.type}));await image.decode();
 ctx.clearRect(0,0,width,height);ctx.drawImage(image,0,0);const svgComparison=compare(actual,ctx.getImageData(0,0,width,height).data);URL.revokeObjectURL(image.src);
 const reference=await createImageBitmap(await(await fetch('/reference')).blob());ctx.clearRect(0,0,width,height);ctx.drawImage(reference,0,0,width,height);reference.close();
 const publishedImageComparison=compare(actual,ctx.getImageData(0,0,width,height).data);
 const png=await encodeLayeredCanvas(canvas,manifest),pngBytes=new Uint8Array(await png.arrayBuffer());
 const restored=await createImageBitmap(png);ctx.clearRect(0,0,width,height);ctx.drawImage(restored,0,0);restored.close();const pngRoundTrip=compare(actual,ctx.getImageData(0,0,width,height).data);
 const picture=document.querySelector('#art');picture.src=URL.createObjectURL(png);picture.hidden=false;await picture.decode();const save=document.querySelector('#save');save.href=picture.src;save.hidden=false;
 const proof={layerSource:${JSON.stringify(process.env.KEEL_CODEC_SELECTION?'measured mixed-codec candidates; see per-layer comparison report':'exact RGBA and ICC lossless WebP conversions')},width:canvas.width,height:canvas.height,layers:rows.length,formats:[...new Set(rows.map(r=>r.type))],originalPNGComposition,svgComparison,publishedImageComparison,pngRoundTrip,pngType:png.type,pngBytes:pngBytes.length,svgBytes:svg.byteLength,svgSourceBytes:svg.sourceBytes,pngDigest:await layerDigest(pngBytes),exactSourceComposition:originalPNGComposition.changedChannels===0,exactPublishedArtwork:publishedImageComparison.changedChannels===0,publicationReady:false};
 await fetch('/result.png',{method:'POST',body:png});await fetch('/result.svg',{method:'POST',body:svg.source});await fetch('/proof',{method:'POST',body:JSON.stringify(proof)});
 document.querySelector('pre').textContent=JSON.stringify(proof,null,2);status.textContent=proof.pngRoundTrip.changedChannels!==0?'PNG export differs from the canvas; inspect the comparison below.':proof.svgComparison.maxChannelDifference<=1?'PNG export verified. SVG preview differs by at most one color step from browser rounding.':'PNG export verified. SVG preview has larger differences; inspect the comparison below.';
 }catch(e){status.textContent='Failed: '+e.message;document.querySelector('pre').textContent=e.stack;}finally{document.querySelector('#run').disabled=false;}};`;
const bundle=await build({stdin:{contents:code,resolveDir:path.resolve('apps/desktop'),loader:'js'},bundle:true,write:false,format:'iife',platform:'browser'});
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Token Gators · renderer check</title><style>body{margin:0;padding:24px;background:#0b0e0f;color:#eee;font:16px system-ui}main{max-width:1050px;margin:auto}button,a{padding:12px 18px;background:#706ce8;border:0;border-radius:6px;color:white;display:inline-block}img{display:block;width:min(100%,750px);margin:24px auto}iframe{display:block;width:min(100%,750px);aspect-ratio:1;height:auto;border:0;margin:24px auto;background:#383e7b}[hidden]{display:none!important}nav{display:flex;gap:8px;flex-wrap:wrap}button{cursor:pointer}pre{white-space:pre-wrap}p{color:#aaa}</style><main><h1>Token Gators · render check</h1><p>Contract metadata on ApeChain. Recovered generator. Local test only.</p><nav><button data-view="svg">SVG image</button><button data-view="html">HTML · KEEL verification</button><a href="/image.svg" download="TokenGator-0.svg">Save SVG</a><a id="save" href="/image.png" download="TokenGator-0.png">Save PNG</a><button id="run">Run renderer check</button></nav><img id="svg-preview" src="/image.svg" alt="TokenGator 0 · SVG image"><iframe id="viewer" title="KEEL verification viewer" hidden></iframe><p id="status">Ready · 4525 × 4525 · 14 layers</p><img id="art" alt="TokenGator 0" hidden><details><summary>Rendering checks</summary><pre></pre></details></main><script src="/test.js"></script>'.replace('4525 × 4525',dimensions.width+' × '+dimensions.height);

const server=http.createServer(async(req,res)=>{try{
 const send=(bytes,type)=>{res.setHeader('content-type',type);res.setHeader('cache-control','no-store');res.end(bytes);};
 if(req.method==='POST'&&['/proof','/result.png','/result.svg'].includes(req.url)){
  if(req.headers['sec-fetch-site']!=='same-origin')throw Error('Same-origin proof writes only');let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>40_000_000)throw Error('Proof output too large');chunks.push(chunk);}const bytes=Buffer.concat(chunks);
  const names={'/proof':'webp-browser-proof.json','/result.png':'token-0-webp-canvas.png','/result.svg':'token-0-webp.svg'};
  if(req.url==='/proof')console.log(bytes.toString());await writeFile(path.join(proofRoot,names[req.url]),bytes);return send('ok','text/plain');
 }
 if(req.method!=='GET'){res.writeHead(405).end();return;}
 if(req.url==='/image.svg')return send(await readFile(path.join(proofRoot,'token-0-webp.svg')),'image/svg+xml');
 if(req.url==='/image.png')return send(await readFile(path.join(proofRoot,'token-0-webp-canvas.png')),'image/png');
 if(req.url==='/viewer'&&process.env.KEEL_GATOR_MEASUREMENT_DIR)return send(await readFile(path.join(process.env.KEEL_GATOR_MEASUREMENT_DIR,'viewer.html')),'text/html');
 if(req.url==='/')return send(html,'text/html');if(req.url==='/test.js')return send(bundle.outputFiles[0].text,'text/javascript');if(req.url==='/reference')return send(await readFile(path.join(root,'reference-0.png')),'image/png');
 const match=req.url.match(/^\/(webp|png)\/([a-f0-9]{64})$/);if(match&&webp.has(match[2])){const row=webp.get(match[2]);return send(await readFile(match[1]==='webp'?row.file:row.sourcePath),match[1]==='webp'?(row.type??'image/webp'):'image/png');}
 res.writeHead(404).end();
 }catch(e){res.writeHead(500).end(e.message);}});
server.listen(Number(process.env.KEEL_RENDER_TEST_PORT??0),'127.0.0.1',()=>console.log('Renderer check: http://127.0.0.1:'+server.address().port));
