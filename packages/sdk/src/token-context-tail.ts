// Canonical context tail shared with KeelRawTokenURIBuilder.contextURI.
// Small token state only: no media, replacement shell or transaction authority.
import {createHash} from 'node:crypto';
import {toKeelDenseTransportDataURL} from './dense-transport.js';
export function buildKeelTokenContextHTMLTail(contextJSON: string, contextDigest: `0x${string}`, contextByteLength: number): string {
  const bytes=Buffer.from(contextJSON);const hash=createHash('sha256');hash.update(bytes);
  if(!/^[\x00-\x7f]*$/u.test(contextJSON)||!/^0x[0-9a-f]{64}$/u.test(contextDigest)||contextByteLength!==bytes.length||contextDigest!=='0x'+hash.digest('hex'))throw new TypeError('Context JSON must be ASCII-escaped and match its byte commitment');
  const contextBase64URL = Buffer.from(contextJSON, "utf8").toString("base64url");
  return `<script>(()=>{try{const v="${contextBase64URL}",b=v.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-v.length%4)%4),j=atob(b),c=Object.freeze(JSON.parse(j)),o=Object.freeze({json:j,digest:"${contextDigest}",byteLength:${contextByteLength}});Object.defineProperty(globalThis,"__KEEL_CONTEXT__",{value:c,enumerable:true,writable:false,configurable:false});Object.defineProperty(globalThis,"__KEEL_ONCHAIN_CONTEXT__",{value:o,enumerable:true,writable:false,configurable:false})}catch(e){document.documentElement.dataset.keelContext="failed";throw e}})()</script>`;
}

export function prepareKeelTokenContextTail(context: Readonly<Record<string, unknown>>) {
 const json=JSON.stringify(context).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 if(Buffer.byteLength(json)>32768)throw new RangeError('Token context exceeds 32 KiB');
 const bytes=Buffer.from(json),hash=createHash('sha256');hash.update(bytes);const digest=('0x'+hash.digest('hex')) as `0x${string}`;
 const html=buildKeelTokenContextHTMLTail(json,digest,bytes.length);
 return {json,digest,byteLength:bytes.length,html,uriTail:toKeelDenseTransportDataURL('html',html).split(',').slice(1).join(',')};
}
