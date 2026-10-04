import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {compilePNGStrips,assemblePNGStrips,decodeRasterPNG} from '@keel/sdk/raster-strips';
import {RasterPrepareService} from '../src/raster-prepare-service.mjs';
test('editor worker exports exact PNG strips and APNG in isolated local folders',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'keel-raster-worker-')),service=new RasterPrepareService(fileURLToPath(new URL('../dist/raster-prepare-worker.mjs',import.meta.url)));
 try{const image={width:32,height:32,data:Uint8Array.from({length:4096},(_,i)=>i%4===3?255:i%256)},compiled=compilePNGStrips(image),bytes=await assemblePNGStrips(compiled.recipe,async id=>compiled.chunks.get(id).bytes);
  const result=await service.prepare({bytes,stripRows:16,directory:path.join(directory,'png'),source:{test:true}});assert.equal(result.report.proof.exactRGBA,true);const decoded=await decodeRasterPNG(await readFile(path.join(result.directory,'artwork.png')));assert.deepEqual(new Uint8Array(decoded.data),image.data);
  const apng=await service.prepare({kind:'apng',frames:[bytes,bytes],directory:path.join(directory,'apng'),source:{test:true}});assert.ok((await readFile(path.join(apng.directory,'artwork.apng'))).includes(Buffer.from('acTL')));
 }finally{service.close();await rm(directory,{recursive:true,force:true});}
});
