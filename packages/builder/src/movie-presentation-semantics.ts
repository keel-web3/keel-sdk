/** Conservative admission for the presentation semantics which RGBA hashes do
 * not contain. This is intentionally a small supported ISO profile, not a
 * metadata stripper or a general movie normalizer. Unsupported media stays
 * native. Box layouts follow the pinned FFmpeg n6.1.1 MOV demuxer (mvhd,
 * tkhd, pasp, stsd) and AVIF's property containers.
 * https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/libavformat/mov.c
 * https://aomediacodec.github.io/av1-avif/v1.2.0.html
 */
export function assertMoviePresentationSemantics(bytes: Uint8Array, inputReport: string, selectedStream: string, width: number, height: number): { readonly srgbFull: boolean } {
  const retain = (reason: string): never => { throw new TypeError(`Movie ${reason} require an exact preserving adapter; native media is retained.`); };
  const sar = /\[SAR (\d+):(\d+) DAR (\d+):(\d+)\]/u.exec(selectedStream);
  if (sar && (BigInt(sar[1]!) <= 0n || BigInt(sar[1]!) !== BigInt(sar[2]!) || BigInt(sar[3]!) * BigInt(height) !== BigInt(sar[4]!) * BigInt(width)) || !sar && /\[(?:SAR|DAR)/u.test(selectedStream)) retain("sample/display aspect ratio semantics");
  // Autorotation can bake a matrix into pixels without preserving the original
  // display geometry. No side-data semantics are discarded by this adapter.
  if (/Side data:|displaymatrix|rotation of|rotate\s*:/iu.test(inputReport)) retain("display transform or side-data semantics");
  if (!/\b(?:gbrp|rgb24|rgba|bgr24|bgra|gray)(?:\(|,)/u.test(selectedStream) || /interlaced|top first|bottom first|bt2020|smpte2084|arib-std-b67/iu.test(selectedStream)) retain("color, field or sample-depth semantics");
  // FFmpeg exposes container and stream metadata separately. Only technical
  // muxer/encoder bookkeeping is disposable; creator tags, language, chapters
  // and unrecognised multiline fields are not inferred from pixel equality.
  let metadata = false;
  for (const line of inputReport.split("\n")) {
    if (/^\s+Metadata:\s*$/u.test(line)) { metadata = true; continue; }
    if (!metadata) continue;
    const field = /^\s{4,}([^:]+?)\s*:\s*(.*)$/u.exec(line);
    if (!field) { if (line.trim()) metadata = false; continue; }
    const key=field[1]!.trim(), value=field[2]!.trim();
    if (["major_brand","minor_version","compatible_brands"].includes(key)) continue;
    if (key === "encoder" && /^(?:Lavf\d+\.\d+\.\d+|Lavc\d+\.\d+\.\d+(?: [A-Za-z0-9_.-]+)?)$/u.test(value)) continue;
    if (key === "handler_name" && ["VideoHandler","SoundHandler","PictureHandler"].includes(value) || key === "vendor_id" && ["[0][0][0][0]","FFMP"].includes(value)) continue;
    retain("creator metadata or unmodelled container semantics");
  }
  const languages=[...inputReport.matchAll(/^\s*Stream #\d+:\d+(?:\[[^\]]+\])?\(([^)]+)\):/gmu)].map(match=>match[1]);
  if (/Chapter #/u.test(inputReport) || languages.some(language=>language!=="und")) retain("chapter or language metadata semantics");

  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const text = (at:number) => String.fromCharCode(...bytes.subarray(at,at+4));
  if (bytes.length<8 || text(4)!=="ftyp") retain("unqualified container presentation semantics");
  type Box = {kind:string; start:number; end:number};
  let count=0, movieHeaders=0, videoHeaders=0, srgbFull=false;
  const boxes=(start:number,end:number):Box[]=>{
    const result:Box[]=[];
    for(let at=start;at<end;) {
      if(++count>65_536 || at+8>end)retain("incomplete or excessive ISO box semantics");
      let n=view.getUint32(at),head=8;const kind=text(at+4);
      if(n===1){if(at+16>end)retain("incomplete extended ISO box semantics");const large=view.getBigUint64(at+8);if(large>BigInt(Number.MAX_SAFE_INTEGER))retain("inexact ISO box semantics");n=Number(large);head=16;}
      else if(n===0)n=end-at;
      if(n<head || n>end-at)retain("invalid ISO box bounds");
      result.push({kind,start:at+head,end:at+n});at+=n;
    }
    return result;
  };
  const matrix=(at:number,end:number)=>{
    if(at+36>end)retain("incomplete display matrix semantics");
    const identity=[65536,0,0,0,65536,0,0,0,1073741824];
    if(identity.some((n,i)=>view.getInt32(at+i*4)!==n))retain("nonidentity display matrix semantics");
  };
  const allowed:Record<string,readonly string[]>={
    root:["ftyp","free","skip","wide","mdat","moov","meta"],
    moov:["mvhd","trak","udta","iods"],trak:["tkhd","edts","mdia","udta"],edts:["elst"],
    mdia:["mdhd","hdlr","minf"],minf:["vmhd","smhd","hdlr","dinf","stbl"],dinf:["dref"],
    stbl:["stsd","stts","ctts","stss","stsc","stsz","stco","co64","sdtp","sgpd","sbgp"],
    udta:["meta","\u00a9swr"],meta:["hdlr","ilst","pitm","iloc","iinf","iprp"],ilst:["\u00a9too"],
    iprp:["ipco","ipma"],ipco:["ispe","pixi","av1C","colr","pasp"],
    visual:["avcC","hvcC","av1C","vpcC","pasp","btrt","colr","fiel","ccst"],
    audio:["esds","btrt","chan","wave","glbl","pcmC"],wave:["frma","enda","mp4a","esds","glbl","\0\0\0\0"],
  };
  const technicalLeaf=new Set(["ftyp","free","skip","wide","mdat","iods","elst","mdhd","hdlr","vmhd","smhd","stts","ctts","stss","stsc","stsz","stco","co64","sdtp","sgpd","sbgp","pitm","iloc","ipma","ispe","pixi","av1C","avcC","hvcC","vpcC","btrt","ccst"]);
  const walk=(start:number,end:number,parent:string,depth=0):void=>{
    if(depth>16)retain("excessive ISO nesting semantics");
    const seen=new Set<string>();
    for(const box of boxes(start,end)) {
      const {kind,start:a,end:z}=box;
      if(!allowed[parent]?.includes(kind))retain(`unsupported ${parent}/${kind} metadata, aperture or presentation semantics`);
      if(["mvhd","tkhd","mdhd","stsd","colr","pasp","meta","iinf","iprp"].includes(kind)&&seen.has(kind))retain("duplicate presentation or metadata semantics");
      seen.add(kind);
      if(kind==="mvhd" || kind==="tkhd") {
        if(a+4>z || bytes[a]!>1)retain("unknown movie/track header semantics");
        const version=bytes[a]!, at=a+(kind==="mvhd"?36:40)+(version===1?12:0);matrix(at,z);
        if(bytes.subarray(a+4,a+(version===1?20:12)).some(value=>value!==0))retain("creation or modification metadata semantics");
        if(kind==="mvhd")movieHeaders++;
        else {
          if(at+44>z)retain("incomplete track display geometry semantics");
          const w=view.getUint32(at+36),h=view.getUint32(at+40);
          if(w||h){videoHeaders++;if(w!==width*65536 || h!==height*65536)retain("track display geometry semantics");}
        }
      } else if(kind==="mdhd") {
        if(a+4>z || bytes[a]!>1)retain("unknown media header metadata semantics");
        const version=bytes[a]!,languageAt=a+(version===1?32:20);
        if(languageAt+4>z || bytes.subarray(a+4,a+(version===1?20:12)).some(value=>value!==0) || ![0x55c4,0x7fff].includes(view.getUint16(languageAt)))retain("media creation, modification or language metadata semantics");
      } else if(kind==="pasp") {
        if(z-a!==8 || view.getUint32(a)===0 || view.getUint32(a)!==view.getUint32(a+4))retain("non-square pixel aspect semantics");
      } else if(kind==="colr") {
        // IEC sRGB, RGB matrix, full range. Anything else (including ICC,
        // unspecified transfer, nclc or HDR) needs a preserving color adapter.
        const nclx=z-a===11 && text(a)==="nclx" && bytes[a+10]===128;
        // QuickTime's nclc has no range field. Admit its exact sRGB/RGB tuple
        // only when the actual decoder separately exposes full-range samples.
        const nclc=z-a===10 && text(a)==="nclc" && /\b(?:gbrp|rgb24|rgba|bgr24|bgra)\(pc[,)]/u.test(selectedStream);
        if(!(nclx||nclc) || view.getUint16(a+4)!==1 || view.getUint16(a+6)!==13 || view.getUint16(a+8)!==0)retain("embedded color profile semantics");
        srgbFull=true;
      } else if(kind==="fiel") {
        if(z-a!==2 || bytes[a]!==1 || bytes[a+1]!==0)retain("field ordering semantics");
      } else if(kind==="stsd") {
        if(a+8>z || view.getUint32(a)!==0)retain("sample-description semantics");
        const entries=boxes(a+8,z);if(entries.length!==view.getUint32(a+4) || entries.length!==1)retain("multiple or incomplete sample-description semantics");
        for(const entry of entries) {
          if(["avc1","avc3","hvc1","hev1","av01","vp09"].includes(entry.kind)) {
            if(entry.start+78>entry.end)retain("incomplete visual sample-entry semantics");
            const nameLength=bytes[entry.start+42]!;
            if(nameLength>31 || nameLength && !/^Lavc\d+\.\d+\.\d+ [A-Za-z0-9_.-]+$/u.test(new TextDecoder().decode(bytes.subarray(entry.start+43,entry.start+43+nameLength))))retain("visual compressor/creator metadata semantics");
            walk(entry.start+78,entry.end,"visual",depth+1);
          } else if(["mp4a","fl64","fl32","sowt","twos","lpcm"].includes(entry.kind)) {
            if(entry.start+28>entry.end)retain("incomplete audio sample-entry semantics");
            const version=view.getUint16(entry.start+8),size=version===0?28:version===1?44:version===2?64:0;
            if(!size || entry.start+size>entry.end)retain("unsupported audio sample-entry semantics");
            walk(entry.start+size,entry.end,"audio",depth+1);
          } else retain("unsupported audio/sample-entry semantics");
        }
      } else if(kind==="dref") {
        if(a+8>z || view.getUint32(a)!==0)retain("data-reference semantics");
        const refs=boxes(a+8,z);if(refs.length!==view.getUint32(a+4) || refs.some(r=>r.kind!=="url " || r.end-r.start!==4 || view.getUint32(r.start)!==1))retain("external or unmodelled data-reference semantics");
      } else if(kind==="iinf") {
        if(a+6>z || bytes[a]!==0 || view.getUint16(a+4)!==1)retain("AVIF item metadata semantics");
        const items=boxes(a+6,z);
        if(items.length!==1 || items[0]!.kind!=="infe")retain("AVIF creator item metadata semantics");
        const item=items[0]!;
        if(item.start+12>item.end || view.getUint32(item.start)!==0x02000000 || text(item.start+8)!=="av01")retain("AVIF non-image item metadata semantics");
        if(!["Color\0","\0"].includes(new TextDecoder().decode(bytes.subarray(item.start+12,item.end))))retain("AVIF creator item-name metadata semantics");
      } else if(kind==="\u00a9too") {
        const data=boxes(a,z);
        if(data.length!==1 || data[0]!.kind!=="data" || data[0]!.start+8>data[0]!.end || !/^Lavf\d+\.\d+\.\d+$/u.test(new TextDecoder().decode(bytes.subarray(data[0]!.start+8,data[0]!.end))))retain("encoder/creator metadata semantics");
      } else if(kind==="\u00a9swr") {
        // QuickTime writes its technical muxer name as length+language+UTF8.
        if(z-a<4 || view.getUint16(a)!==z-a-4 || !/^Lavf\d+\.\d+\.\d+$/u.test(new TextDecoder().decode(bytes.subarray(a+4,z))))retain("QuickTime creator metadata semantics");
      } else if(["esds","chan","glbl","pcmC","frma","enda","mp4a","\0\0\0\0"].includes(kind)) {
        // Closed decoder/sample configuration leaves. No arbitrary user data
        // or nested application/metadata containers are admitted here.
      } else if(!technicalLeaf.has(kind)) walk(a+(kind==="meta"?4:0),z,kind,depth+1);
    }
  };
  walk(0,bytes.length,"root");
  if(movieHeaders!==1 || videoHeaders!==1)retain("ambiguous movie/track display geometry semantics");
  // A codec may omit SAR in the probe (ordinary QuickTime output does). The
  // complete ISO path above still requires identity transforms and exact
  // track display dimensions equal to the coded raster, and checks every
  // pasp override. This is a measured identity display, not a guessed ratio.
  // Pinned MOV demuxer: mov_read_trak derives SAR from differing tkhd bounds.
  return {srgbFull};
}
