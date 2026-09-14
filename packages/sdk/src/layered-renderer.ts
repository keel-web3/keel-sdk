import { layeredAssetIds, resolveLayeredArt, parseLayeredArt, layeredDrawList, selectLayeredArt, layerDigest, type LayerSelection, type Point } from './layered-art.js';
export type LayerAsset = { bytes: Uint8Array; type: string };
/** Same renderer is used in the desktop canvas and published creator HTML. */
export async function renderLayeredArt(canvas: HTMLCanvasElement, value: unknown, selections: LayerSelection[], resolve: (objectId: string) => Promise<LayerAsset>): Promise<void> {
  const manifest=parseLayeredArt(value);const list=layeredDrawList(manifest,selections);
  // Compose offscreen one decoded image at a time; failed inputs never become a partial visible render.
  {
    const target=document.createElement('canvas');target.width=manifest.width;target.height=manifest.height;
    const ctx=target.getContext('2d');if(!ctx)throw Error('Canvas is unavailable.');
    if(manifest.background){ctx.fillStyle=manifest.background;ctx.fillRect(0,0,target.width,target.height);}
    for(const piece of list)await drawRasterPiece(ctx,piece,target.width,target.height,resolve);
    canvas.width=target.width;canvas.height=target.height;const output=canvas.getContext('2d');if(!output)throw Error('Canvas is unavailable.');output.clearRect(0,0,canvas.width,canvas.height);output.drawImage(target,0,0);
  }
}
export async function encodeLayeredCanvas(canvas: HTMLCanvasElement, value: unknown): Promise<Blob> {
  const manifest=parseLayeredArt(value);if(manifest.format==='image/jpeg'&&!manifest.background)throw Error('Choose a background before exporting JPEG.');
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,manifest.format,manifest.quality));
  if(!blob||blob.type!==manifest.format)throw Error(`This browser cannot encode ${manifest.format}. Choose a supported output format.`);
  return blob;
}
export async function renderLayeredSeed(canvas: HTMLCanvasElement, manifest: unknown, seed: string, tokenId: string, resolve: (objectId: string) => Promise<LayerAsset>) {
  const selection=await selectLayeredArt(manifest,seed,tokenId);await renderLayeredArt(canvas,manifest,selection,resolve);return resolveLayeredArt(manifest,selection).selections;
}
/** Decode every unique original, including rare variants absent from a sample sheet. */
export async function verifyLayeredAssets(value:unknown,resolve:(objectId:string)=>Promise<LayerAsset>) {
  const manifest=parseLayeredArt(value);const ids=layeredAssetIds(manifest);
  const results:{id:string;width:number;height:number}[]=[];
  for(const id of ids){const asset=await resolve(id);if(!asset.type.startsWith('image/')||await layerDigest(asset.bytes)!==id)throw Error('Layer original does not match its type or committed digest.');const bitmap=await createImageBitmap(new Blob([Uint8Array.from(asset.bytes)],{type:asset.type}));try{if(bitmap.width*bitmap.height>33_554_432)throw Error('A layer exceeds the 32 megapixel preview budget.');results.push({id,width:bitmap.width,height:bitmap.height});}finally{bitmap.close();}}
  return {checked:results.length,images:results,proof:'original-byte-and-image-decode'};
}

async function drawRasterPiece(ctx:CanvasRenderingContext2D,piece:ReturnType<typeof layeredDrawList>[number],width:number,height:number,resolve:(objectId:string)=>Promise<LayerAsset>){const p=piece.placement;const asset=await resolve(piece.objectId);if(await layerDigest(asset.bytes)!==piece.objectId)throw Error('Layer bytes do not match their committed digest.');if(!asset.type.startsWith('image/'))throw Error('Layer variants must be images.');const img=await createImageBitmap(new Blob([Uint8Array.from(asset.bytes)],{type:asset.type}));try{if(img.width*img.height>33_554_432)throw Error('This layer exceeds the 32 megapixel preview budget.');ctx.save();ctx.globalAlpha=p.opacity;
      ctx.translate(p.x*width,p.y*height);ctx.scale(p.width*width,p.height*height);ctx.translate(.5,.5);ctx.rotate(p.rotation*Math.PI/180);ctx.translate(-.5,-.5);
      if(p.mask.length){ctx.beginPath();p.mask.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.clip();}
      if(!p.mesh)ctx.drawImage(img,0,0,1,1);
      else for(const triangle of p.mesh.triangles){const source=triangle.map(index=>p.mesh!.source[index]!) as [Point,Point,Point],dest=triangle.map(index=>p.mesh!.target[index]!) as [Point,Point,Point];
        const [a,b,c]=source,[d,e,f]=dest;const det=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
        const xx=((e[0]-d[0])*(c[1]-a[1])-(f[0]-d[0])*(b[1]-a[1]))/det;
        const xy=((f[0]-d[0])*(b[0]-a[0])-(e[0]-d[0])*(c[0]-a[0]))/det;
        const yx=((e[1]-d[1])*(c[1]-a[1])-(f[1]-d[1])*(b[1]-a[1]))/det;
        const yy=((f[1]-d[1])*(b[0]-a[0])-(e[1]-d[1])*(c[0]-a[0]))/det;
        ctx.save();ctx.beginPath();dest.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.clip();ctx.transform(xx,yx,xy,yy,d[0]-xx*a[0]-xy*a[1],d[1]-yx*a[0]-yy*a[1]);ctx.drawImage(img,0,0,1,1);ctx.restore();
      }ctx.restore();}finally{img.close();}

}

/** Each frame is a prepared, isolated layer, including its mesh, mask and opacity. */
export async function renderLayeredAPNGFrames(value:unknown,selections:LayerSelection[],resolve:(objectId:string)=>Promise<LayerAsset>){
  const manifest=parseLayeredArt(value),list=layeredDrawList(manifest,selections),canvas=document.createElement('canvas');canvas.width=manifest.width;canvas.height=manifest.height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas is unavailable.');const frames:string[]=[];let bytes=0;
  const capture=()=>{const frame=canvas.toDataURL('image/png');bytes+=frame.length;if(bytes>90_000_000)throw Error('This APNG exceeds the local preparation budget.');frames.push(frame);};
  if(manifest.background){ctx.fillStyle=manifest.background;ctx.fillRect(0,0,canvas.width,canvas.height);capture();}
  for(const piece of list){ctx.clearRect(0,0,canvas.width,canvas.height);await drawRasterPiece(ctx,piece,canvas.width,canvas.height,resolve);capture();}
  if(!frames.length)throw Error('Add a layer first.');return frames;
}
