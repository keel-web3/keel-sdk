/** Literal COPY boot shared by generation and static verification. */
export function keelPreparedDenseCopyBootSuffix(prefix64: string, suffix64: string, bridge: string, shellBootCompression: "gzip" | "none", legacy = false): string {
  return '];queueMicrotask(async()=>{const safe=v=>JSON.stringify(v).replace(/<(?=\\/script|script|!--)/giu,"\\\\u003c").replaceAll("\\u2028","\\\\u2028").replaceAll("\\u2029","\\\\u2029");'
    + (legacy ? 'if(document.readyState==="loading")await new Promise(done=>document.addEventListener("DOMContentLoaded",done,{once:true}));' : '')
    + (shellBootCompression === "gzip"
      ? 'const bootCompression="gzip";const utf8=async s=>new TextDecoder().decode(await new Response(new Blob([Uint8Array.from(atob(s),c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());'
      : 'const utf8=s=>new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));')
    + 'const html=(await utf8(' + JSON.stringify(prefix64) + '))+safe(__KEEL_PREPARED_DENSE_PACKS__).slice(1,-1)+' + JSON.stringify(bridge)
    + '+safe(globalThis.__KEEL_ITEMS__).slice(5,-1)+(await utf8(' + JSON.stringify(suffix64) + '));document.open();document.write(html);document.close()});</script></body></html>';
}
