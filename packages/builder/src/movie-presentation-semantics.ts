import { actualAvifContainer } from "./actual-media-container.js";

/** Conservative admission for the presentation semantics which RGBA hashes do
 * not contain. This is intentionally a small supported ISO profile, not a
 * metadata stripper or a general movie normalizer. Unsupported media stays
 * native. Box layouts follow the reviewed FFmpeg n6.1.1 MOV demuxer (mvhd,
 * tkhd, pasp, stsd) and AVIF's property containers. The recorded Darwin
 * binary reports 6.0; the same layouts were checked in that release too.
 * https://github.com/FFmpeg/FFmpeg/blob/n6.0/libavformat/mov.c
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
  type Clock = {scale:bigint; duration:bigint};
  type Edit = {flags:number; duration:bigint; mediaTime:bigint};
  type Track = {duration?:bigint; media?:Clock; edit?:Edit; video?:boolean; codec?:string; timing?:{duration:bigint;samples:bigint}; compositionSamples?:bigint};
  let count=0, movieHeaders=0, videoHeaders=0, srgbFull=false;
  let movie:Clock|undefined, avifItems=0, avifExtents=0;
  const tracks:Track[]=[], avifConfigs:Uint8Array[]=[];
  const clock=(start:number,end:number):Clock=>{
    if(start+4>end || bytes[start]!>1 || (view.getUint32(start)&0xffffff)!==0)retain("unknown edit-list reference clock version or flags");
    const version=bytes[start]!,at=start+(version===1?20:12),size=version===1?8:4;
    if(at+4+size>end)retain("incomplete edit-list reference clock");
    const scale=BigInt(view.getUint32(at)),duration=version===1?view.getBigUint64(at+4):BigInt(view.getUint32(at+4));
    if(!scale || !duration || duration===(version===1?0xffffffffffffffffn:0xffffffffn))retain("unavailable edit-list reference clock bounds");
    return {scale,duration};
  };
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
  const technicalLeaf=new Set(["ftyp","free","skip","wide","mdat","iods","mdhd","hdlr","vmhd","smhd","stts","ctts","stss","stsc","stsz","stco","co64","sdtp","sgpd","sbgp","pitm","iloc","ipma","ispe","pixi","av1C","avcC","hvcC","vpcC","btrt","ccst"]);
  const walk=(start:number,end:number,parent:string,depth=0,track?:Track):void=>{
    if(depth>16)retain("excessive ISO nesting semantics");
    const seen=new Set<string>();
    for(const box of boxes(start,end)) {
      const {kind,start:a,end:z}=box;
      if(!allowed[parent]?.includes(kind))retain(`unsupported ${parent}/${kind} metadata, aperture or presentation semantics`);
      if(["mvhd","tkhd","mdhd","edts","elst","stts","ctts","stsd","colr","pasp","meta","iinf","iprp"].includes(kind)&&seen.has(kind))retain("duplicate presentation, edit-list or metadata semantics");
      seen.add(kind);
      if(kind==="trak") {
        const nested:Track={};tracks.push(nested);walk(a,z,kind,depth+1,nested);
      } else if(kind==="edts") {
        const entries=boxes(a,z);
        if(!track || entries.length!==1 || entries[0]!.kind!=="elst")retain("incomplete or ambiguous edit container");
        walk(a,z,kind,depth+1,track);
      } else if(kind==="elst") {
        const owner=track??retain("edit list outside a track");
        if(a+8>z || bytes[a]!>1)retain("unsupported edit-list version or header");
        const version=bytes[a]!,flags=view.getUint32(a)&0xffffff,n=view.getUint32(a+4),stride=version===1?20:12;
        // The current adapter supports one complete forward segment. Empty,
        // splice, dwell and repeated finite segments need a preserving player.
        if(n!==1 || z-a!==8+n*stride)retain("unsupported edit-list count or exact entry byte bounds");
        if(flags!==0 && flags!==1)retain("unsupported edit-list flags");
        const at=a+8,duration=version===1?view.getBigUint64(at):BigInt(view.getUint32(at)),mediaTime=version===1?view.getBigInt64(at+8):BigInt(view.getInt32(at+4)),rateAt=at+(version===1?16:8);
        if(duration<=0n || mediaTime<0n || view.getInt32(rateAt)!==65536)retain("unsupported edit-list segment, media-time or playback rate");
        owner.edit={flags,duration,mediaTime};
      } else if(kind==="stts" || kind==="ctts") {
        const owner=track??retain("sample timeline outside its edit-list track");
        if(a+8>z || (view.getUint32(a)&0xffffff)!==0 || bytes[a]!>(kind==="stts"?0:1))retain("unsupported edit-list sample timeline version or flags");
        const n=view.getUint32(a+4);
        if(!n || n>65_536 || z-a!==8+n*8)retain("edit-list sample timeline count or byte bounds");
        let duration=0n,samples=0n;
        for(let i=0;i<n;i++) {
          const at=a+8+i*8,count=view.getUint32(at),value=kind==="ctts"&&bytes[a]===1?view.getInt32(at+4):view.getUint32(at+4);
          if(!count || kind==="stts"&&value<=0 || kind==="ctts"&&value!==0)retain("unsupported edit-list sample duration or composition offset");
          samples+=BigInt(count);if(kind==="stts")duration+=BigInt(count)*BigInt(value);
        }
        if(kind==="stts")owner.timing={duration,samples};else owner.compositionSamples=samples;
      } else if(kind==="mvhd" || kind==="tkhd") {
        if(a+4>z || bytes[a]!>1)retain("unknown movie/track header semantics");
        const version=bytes[a]!, at=a+(kind==="mvhd"?36:40)+(version===1?12:0);matrix(at,z);
        if(bytes.subarray(a+4,a+(version===1?20:12)).some(value=>value!==0))retain("creation or modification metadata semantics");
        if(kind==="mvhd") {
          movieHeaders++;
          movie=clock(a,z);
          if((view.getUint32(a)&0xffffff)!==0 || view.getUint32(at-16)!==65536 || view.getUint16(at-12)!==256)retain("movie playback flags, rate or volume semantics");
        }
        else {
          if(at+44>z)retain("incomplete track display geometry semantics");
          const w=view.getUint32(at+36),h=view.getUint32(at+40);
          const owner=track??retain("track header outside its edit-list scope");
          owner.duration=version===1?view.getBigUint64(a+28):BigInt(view.getUint32(a+20));owner.video=!!(w||h);
          if((view.getUint32(a)&0xffffff)!==3 || view.getInt16(at-8)!==0 || view.getUint16(at-4)!==(w||h?0:256))retain("track enabled, layering or audio-volume semantics");
          if(w||h){videoHeaders++;if(w!==width*65536 || h!==height*65536)retain("track display geometry semantics");}
        }
      } else if(kind==="mdhd") {
        if(a+4>z || bytes[a]!>1)retain("unknown media header metadata semantics");
        const version=bytes[a]!,languageAt=a+(version===1?32:20);
        if(languageAt+4>z || bytes.subarray(a+4,a+(version===1?20:12)).some(value=>value!==0) || ![0x55c4,0x7fff].includes(view.getUint16(languageAt)))retain("media creation, modification or language metadata semantics");
        const owner=track??retain("media clock outside its edit-list scope");owner.media=clock(a,z);
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
          if(track)track.codec=entry.kind;
          if(["avc1","avc3","hvc1","hev1","av01","vp09"].includes(entry.kind)) {
            if(entry.start+78>entry.end)retain("incomplete visual sample-entry semantics");
            const nameLength=bytes[entry.start+42]!;
            if(nameLength>31 || nameLength && !/^Lavc\d+\.\d+\.\d+ [A-Za-z0-9_.-]+$/u.test(new TextDecoder().decode(bytes.subarray(entry.start+43,entry.start+43+nameLength))))retain("visual compressor/creator metadata semantics");
            walk(entry.start+78,entry.end,"visual",depth+1,track);
          } else if(["mp4a","fl64","fl32","sowt","twos","lpcm"].includes(entry.kind)) {
            if(entry.start+28>entry.end)retain("incomplete audio sample-entry semantics");
            const version=view.getUint16(entry.start+8),size=version===0?28:version===1?44:version===2?64:0;
            if(!size || entry.start+size>entry.end)retain("unsupported audio sample-entry semantics");
            walk(entry.start+size,entry.end,"audio",depth+1,track);
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
        avifItems++;
      } else if(kind==="av1C") {
        if(parent==="visual" || parent==="ipco")avifConfigs.push(bytes.slice(a,z));
      } else if(kind==="ispe") {
        if(parent==="ipco" && z-a===12 && view.getUint32(a)===0 && view.getUint32(a+4)===width && view.getUint32(a+8)===height)avifExtents++;
      } else if(kind==="\u00a9too") {
        const data=boxes(a,z);
        if(data.length!==1 || data[0]!.kind!=="data" || data[0]!.start+8>data[0]!.end || !/^Lavf\d+\.\d+\.\d+$/u.test(new TextDecoder().decode(bytes.subarray(data[0]!.start+8,data[0]!.end))))retain("encoder/creator metadata semantics");
      } else if(kind==="\u00a9swr") {
        // QuickTime writes its technical muxer name as length+language+UTF8.
        if(z-a<4 || view.getUint16(a)!==z-a-4 || !/^Lavf\d+\.\d+\.\d+$/u.test(new TextDecoder().decode(bytes.subarray(a+4,z))))retain("QuickTime creator metadata semantics");
      } else if(["esds","chan","glbl","pcmC","frma","enda","mp4a","\0\0\0\0"].includes(kind)) {
        // Closed decoder/sample configuration leaves. No arbitrary user data
        // or nested application/metadata containers are admitted here.
      } else if(!technicalLeaf.has(kind)) walk(a+(kind==="meta"?4:0),z,kind,depth+1,track);
    }
  };
  walk(0,bytes.length,"root");
  if(movieHeaders!==1 || videoHeaders!==1)retain("ambiguous movie/track display geometry semantics");
  for(const track of tracks) {
    const edit=track.edit;
    if(!edit)continue;
    const movieClock=movie??retain("unavailable movie edit-list clock"),media=track.media??retain("unavailable media edit-list clock");
    if(!track.timing || track.timing.duration!==media.duration || track.compositionSamples!==undefined && track.compositionSamples!==track.timing.samples)retain("edit-list media bounds differ from the complete sample timeline");
    if(track.duration===undefined || edit.mediaTime>=media.duration || track.video && edit.mediaTime!==0n)retain("edit-list segment or media bounds");
    // Exact integer rescaling, including the muxer's specified upward movie-
    // clock rounding. No tolerance or duration repair is used. Only a whole
    // remaining media segment (audio priming included) has known semantics.
    const cycle=((media.duration-edit.mediaTime)*movieClock.scale+media.scale-1n)/media.scale;
    if(edit.duration!==cycle || edit.duration>movieClock.duration)retain("edit-list segment duration or media clock correspondence");
    if(edit.flags===0) {
      if(track.duration!==edit.duration)retain("edit-list and track duration correspondence");
    } else {
      // HEIF 9.6 repeat profile emitted by the pinned FFmpeg MOV muxer:
      // flags1 + INT64_MAX means infinite repetition of this exact cycle.
      // A brand alone is insufficient: require decoded AV1, the complete AVIF
      // container, an AV1 track and its matching primary-image configuration.
      // mov_write_edts_tag / mov_write_tkhd_tag, exact source hash in evidence:
      // https://github.com/FFmpeg/FFmpeg/blob/n6.0/libavformat/movenc.c
      const config=avifConfigs[0];
      if(!actualAvifContainer(bytes)?.sequence || !/^\s*Stream #[^\n]*Video:\s*av1\b/mu.test(inputReport) || !/^.*Video:\s*av1\b/u.test(selectedStream)
        || tracks.length!==1 || track.codec!=="av01" || !track.video || edit.mediaTime!==0n || track.duration!==0x7fffffffffffffffn || edit.duration!==movieClock.duration
        || avifItems!==1 || avifExtents!==1 || avifConfigs.length!==2 || !config || config.length<4 || config[0]!==0x81 || config.length!==avifConfigs[1]!.length || config.some((value,i)=>value!==avifConfigs[1]![i]))retain("unsupported AVIF edit-list repeat profile or flags");
    }
  }
  // A codec may omit SAR in the probe (ordinary QuickTime output does). The
  // complete ISO path above still requires identity transforms and exact
  // track display dimensions equal to the coded raster, and checks every
  // pasp override. This is a measured identity display, not a guessed ratio.
  // Pinned MOV demuxer: mov_read_trak derives SAR from differing tkhd bounds.
  return {srgbFull};
}
