/** Lossless APNG layer assembly. Compressed PNG pixels are reused, never blended here. */
import {pngChunk} from './raster-strips.js';
export function assembleLayerAPNG(inputs:Uint8Array[],delayMs=30){
  if(!inputs.length||inputs.length>256||!Number.isInteger(delayMs)||delayMs<1||delayMs>65535)throw Error('Choose 1–256 layers and a valid frame delay.');
  let header:Buffer|undefined,profile:Buffer|undefined;const frames:Uint8Array[][]=[];
  for(const input of inputs){if(input.length<45||input.length>128*1024*1024||!Buffer.from(input.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid PNG layer.');const idat:Uint8Array[]=[],colour:Uint8Array[]=[];let ended=false,sawHeader=false;
    for(let at=8;at<input.length;){if(at+12>input.length||ended)throw Error('Truncated PNG layer.');const size=new DataView(input.buffer,input.byteOffset+at).getUint32(0),type=Buffer.from(input.subarray(at+4,at+8)).toString();if(at+12+size>input.length)throw Error('Truncated PNG layer.');const data=input.subarray(at+8,at+8+size);if(!pngChunk(type,data).equals(Buffer.from(input.subarray(at,at+12+size))))throw Error('PNG layer checksum failed.');
      if(!sawHeader&&type!=='IHDR')throw Error('Missing PNG header.');
      if(type==='IHDR'){if(sawHeader||size!==13||data[8]!==8||data[9]!==6||data[12]!==0)throw Error('Prepare non-interlaced 8-bit RGBA PNG layers first.');sawHeader=true;if(header&&!header.equals(Buffer.from(data)))throw Error('APNG layers need matching dimensions and colour format.');header=Buffer.from(data);const w=header.readUInt32BE(),h=header.readUInt32BE(4);if(!w||!h||w*h>33_554_432)throw Error('APNG dimensions exceed the preparation budget.');}
      if(type==='acTL')throw Error('Animated source layers need an explicit timeline.');
      if(['sRGB','gAMA','cHRM','iCCP','cICP'].includes(type))colour.push(pngChunk(type,data));
      if(type==='IDAT')idat.push(data);if(type==='IEND'){if(size)throw Error('Invalid PNG end.');ended=true;}at+=12+size;
    }if(!ended||!idat.length)throw Error('Incomplete PNG layer.');const colourBytes=Buffer.concat(colour);if(profile&&!profile.equals(colourBytes))throw Error('APNG layers need matching colour profiles.');profile=colourBytes;frames.push(idat);
  }
  const actl=Buffer.alloc(8);actl.writeUInt32BE(frames.length);actl.writeUInt32BE(1,4);
  const parts:Uint8Array[]=[Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header!),profile!,pngChunk('acTL',actl)];let seq=0;
  for(const [index,frame] of frames.entries()){const fctl=Buffer.alloc(26);fctl.writeUInt32BE(seq++);header!.copy(fctl,4,0,8);fctl.writeUInt16BE(delayMs,20);fctl.writeUInt16BE(1000,22);fctl[24]=0;fctl[25]=index===0?0:1;parts.push(pngChunk('fcTL',fctl));for(const pixels of frame){if(index===0)parts.push(pngChunk('IDAT',pixels));else{const n=Buffer.alloc(4);n.writeUInt32BE(seq++);parts.push(pngChunk('fdAT',Buffer.concat([n,pixels])));}}}
  parts.push(pngChunk('IEND',Buffer.alloc(0)));if(parts.reduce((n,p)=>n+p.length,0)>256*1024*1024)throw Error('APNG exceeds the local preparation byte budget.');return Buffer.concat(parts);
}
