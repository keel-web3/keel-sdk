import { parseLayeredArt, layeredDrawList, layerDigest, type LayerSelection, type Point } from './layered-art.js';
import type { LayerAsset } from './layered-renderer.js';

const points=(values:Point[])=>values.map(p=>p.join(',')).join(' ');
function base64(bytes:Uint8Array){let result='';for(let at=0;at<bytes.length;at+=24576)result+=btoa(String.fromCharCode(...bytes.subarray(at,at+24576)));return result;}
function affine(source:Point[],dest:Point[]) {
  const [a,b,c]=source as [Point,Point,Point],[d,e,f]=dest as [Point,Point,Point];
  const det=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
  const xx=((e[0]-d[0])*(c[1]-a[1])-(f[0]-d[0])*(b[1]-a[1]))/det;
  const xy=((f[0]-d[0])*(b[0]-a[0])-(e[0]-d[0])*(c[0]-a[0]))/det;
  const yx=((e[1]-d[1])*(c[1]-a[1])-(f[1]-d[1])*(b[1]-a[1]))/det;
  const yy=((f[1]-d[1])*(b[0]-a[0])-(e[1]-d[1])*(c[0]-a[0]))/det;
  return [xx,yx,xy,yy,d[0]-xx*a[0]-xy*a[1],d[1]-yx*a[0]-yy*a[1]].join(' ');
}
/** Final display only: binary layers remain raw objects in publication packages.
 * Embedded image encoding is constructed here, when the finished SVG is requested.
 * No script, external fetch, foreignObject or hidden canvas is needed to display it.
 */
export async function renderLayeredSVG(value:unknown,selections:LayerSelection[],resolve:(id:string)=>Promise<LayerAsset>) {
  const art=parseLayeredArt(value),list=layeredDrawList(art,selections),ids=[...new Set(list.map(p=>p.objectId))];
  const definitions:string[]=[],body:string[]=[];let sourceBytes=0;
  for(const [index,id] of ids.entries()){
    const asset=await resolve(id);if(await layerDigest(asset.bytes)!==id)throw Error('SVG layer does not match its committed digest.');
    // Raster-only embedding prevents nested active SVG documents or external resources.
    if(asset.type==='image/png'){
      if(![137,80,78,71,13,10,26,10].every((v,i)=>asset.bytes[i]===v))throw Error('Invalid PNG layer.');
    }else if(asset.type==='image/webp'){
      const b=asset.bytes,text=(at:number)=>String.fromCharCode(...b.subarray(at,at+4));
      if(b.length<20||text(0)!=='RIFF'||text(8)!=='WEBP')throw Error('Invalid WebP layer.');
      const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
      if(view.getUint32(4,true)!==b.length-8)throw Error('Invalid WebP container length.');
      let at=12,hasPixels=false;
      while(at<b.length){
        if(at+8>b.length)throw Error('Truncated WebP layer.');
        const chunk=text(at),length=view.getUint32(at+4,true);
        if(at+8+length+(length%2)>b.length)throw Error('Truncated WebP chunk.');
        if(chunk==='ANIM'||chunk==='ANMF'||(chunk==='VP8X'&&length>0&&(b[at+8]!&2)))throw Error('Use a still WebP layer for a fixed SVG composition.');
        if(chunk==='VP8 '||chunk==='VP8L')hasPixels=true;
        at+=8+length+(length%2);
      }
      if(!hasPixels)throw Error('WebP layer has no raster pixels.');
    }else if(asset.type==='image/avif'){
      // AVIF is an ISO BMFF raster container. Accept still images only; keep
      // sequences out of a fixed layered composition just as we do for WebP.
      const b=asset.bytes,view=new DataView(b.buffer,b.byteOffset,b.byteLength);
      const text=(at:number)=>String.fromCharCode(...b.subarray(at,at+4));
      let at=0,still=false,metadata=false,pixels=false;
      while(at<b.length){
        if(at+8>b.length)throw Error('Truncated AVIF layer.');
        let size=view.getUint32(at),header=8;const kind=text(at+4);
        if(size===1){
          if(at+16>b.length)throw Error('Truncated AVIF box.');
          const extended=view.getBigUint64(at+8);
          if(extended>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Invalid AVIF box length.');
          size=Number(extended);header=16;
        }else if(size===0)size=b.length-at;
        if(size<header||size>b.length-at)throw Error('Invalid AVIF box length.');
        if(kind==='ftyp'){
          if(at!==0||size<header+8||(size-header)%4)throw Error('Invalid AVIF file type.');
          const brands=[text(at+header)];
          for(let offset=at+header+8;offset<at+size;offset+=4)brands.push(text(offset));
          if(brands.includes('avis'))throw Error('Use a still AVIF layer for a fixed SVG composition.');
          still=brands.includes('avif');
        }
        if(kind==='moov')throw Error('Use a still AVIF layer for a fixed SVG composition.');
        if(kind==='meta'&&size>header)metadata=true;
        if(kind==='mdat'&&size>header)pixels=true;
        at+=size;
      }
      if(!still||!metadata||!pixels)throw Error('Invalid still AVIF layer.');
    }else throw Error('SVG layers must be PNG or still WebP/AVIF images.');
    sourceBytes+=asset.bytes.length;if(sourceBytes>128*1024*1024)throw Error('SVG export exceeds its local 128 MB source budget.');
    definitions.push(`<image id="asset-${index}" width="1" height="1" preserveAspectRatio="none" href="data:${asset.type};base64,${base64(asset.bytes)}"/>`);
  }
  if(art.background)body.push(`<rect width="${art.width}" height="${art.height}" fill="${art.background}"/>`);
  for(const [index,piece] of list.entries()){
    const p=piece.placement,reference=`#asset-${ids.indexOf(piece.objectId)}`;
    if(p.mask.length)definitions.push(`<clipPath id="mask-${index}" clipPathUnits="userSpaceOnUse"><polygon points="${points(p.mask)}"/></clipPath>`);
    const images:string[]=[];
    if(!p.mesh)images.push(`<use href="${reference}"/>`);
    else for(const [triangleIndex,triangle] of p.mesh.triangles.entries()){
      const source=triangle.map(i=>p.mesh!.source[i]!),dest=triangle.map(i=>p.mesh!.target[i]!);
      definitions.push(`<clipPath id="mesh-${index}-${triangleIndex}" clipPathUnits="userSpaceOnUse"><polygon points="${points(dest)}"/></clipPath>`);
      images.push(`<g clip-path="url(#mesh-${index}-${triangleIndex})"><use href="${reference}" transform="matrix(${affine(source,dest)})"/></g>`);
    }
    // Opacity applies to each draw, matching Canvas even where mesh triangles overlap.
    const draws=images.map(image=>`<g opacity="${p.opacity}">${image}</g>`).join('');
    body.push(`<g transform="translate(${p.x*art.width} ${p.y*art.height}) scale(${p.width*art.width} ${p.height*art.height}) rotate(${p.rotation} .5 .5)"${p.mask.length?` clip-path="url(#mask-${index})"`:''}>${draws}</g>`);
  }
  const source=`<svg xmlns="http://www.w3.org/2000/svg" width="${art.width}" height="${art.height}" viewBox="0 0 ${art.width} ${art.height}"><defs>${definitions.join('')}</defs>${body.join('')}</svg>`;
  return {source,type:'image/svg+xml' as const,sourceBytes,byteLength:new TextEncoder().encode(source).length,assetIds:ids,proof:'local-digest-checked-composition' as const};
}
