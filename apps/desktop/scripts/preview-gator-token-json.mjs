/** Preview the actual prepared JSON fields; does not replace or publish a shell. */
import http from 'node:http';
import {loadGatorInlineMetadata} from './gator-inline-metadata.mjs';

const candidate = await loadGatorInlineMetadata(process.env.KEEL_GATOR_MEASUREMENT_DIR);
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TokenGator #0 · inline metadata</title><style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#0b0e0f;color:#eee;font:16px system-ui}main{max-width:1000px;margin:auto}h1{margin-bottom:8px}p{color:#b7bac6}nav{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}button,a{padding:12px 16px;border:1px solid #454554;border-radius:6px;background:#181b22;color:white;text-decoration:none;cursor:pointer}button[aria-pressed=true]{background:#706ce8}#stage{width:min(100%,750px);aspect-ratio:1;margin:auto;background:#383e7b}#stage img,#stage iframe{display:block;width:100%;height:100%;border:0}[hidden]{display:none!important}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin-top:24px}small{color:#b7bac6}</style></head><body><main>
<h1>TokenGator #0</h1><p>Layered SVG image + KEEL verified HTML</p><small>Local preview of the prepared contract response · Sepolia update pending</small>
<nav><button id="image-tab" aria-pressed="true">SVG image</button><button id="html-tab" aria-pressed="false">HTML · KEEL verification</button><a id="save">Save SVG</a><a href="/metadata.json" download="TokenGator-0.json">Save metadata</a></nav>
<div id="stage"><img id="image" alt="TokenGator 0 · layered SVG"><iframe id="viewer" sandbox="allow-scripts" title="KEEL verified HTML" hidden></iframe></div><p id="status">Loading metadata…</p>
<details><summary>Metadata fields</summary><pre id="fields"></pre></details></main><script>
(async()=>{const response=await fetch('/metadata.json');if(!response.ok)throw Error('Metadata could not be loaded');const metadata=await response.json();
const image=document.querySelector('#image'),viewer=document.querySelector('#viewer'),imageTab=document.querySelector('#image-tab'),htmlTab=document.querySelector('#html-tab');
image.src=metadata.image;await image.decode();document.querySelector('#save').href=metadata.image;document.querySelector('#save').download='TokenGator-0.svg';
const show=html=>{image.hidden=html;viewer.hidden=!html;imageTab.setAttribute('aria-pressed',String(!html));htmlTab.setAttribute('aria-pressed',String(html));if(html&&!viewer.src)viewer.src=metadata.animation_url;};imageTab.onclick=()=>show(false);htmlTab.onclick=()=>show(true);
document.querySelector('#status').textContent='Both views are embedded in this JSON · '+image.naturalWidth+' × '+image.naturalHeight;
document.querySelector('#fields').textContent=JSON.stringify({...metadata,image:metadata.image.slice(0,metadata.image.indexOf(',')+1)+'[complete layered SVG embedded]',animation_url:metadata.animation_url.slice(0,metadata.animation_url.indexOf(',')+1)+'[complete verified HTML embedded]'},null,2);
})().catch(error=>{document.querySelector('#status').textContent=error.message;});</script></body></html>`;
const server = http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(page);}
  else if(req.url==='/metadata.json'){res.setHeader('Content-Type','application/json');res.end(candidate.bytes);}
  else {res.writeHead(404).end();}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,localOnly:true,...candidate.proof})));
