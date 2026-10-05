"""Generic raster compositor and shared reproducible ffmpeg render orchestration."""
import hashlib,json,math,subprocess,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from common import *
from materials import transition,zoom

class Reader:
    def __init__(self,source,target=None):
        variant=next((v for v in source.get("variants",[]) if v["target"]==target),None)
        self.path=Path(variant["path"] if variant else source["path"]);self.image=None;self.cache=None
        if source["kind"]=="image":
            self.image=np.array(Image.open(self.path).convert("RGB"));self.fps=source.get("fps",30);return
        info=probe(self.path);stream=next(s for s in info["streams"] if s["codec_type"]=="video")
        self.w=stream["width"];self.h=stream["height"]
        a,b=stream["avg_frame_rate"].split("/");self.fps=source.get("fps",float(a)/float(b))
        self.count=int(float(info["format"]["duration"])*self.fps+.5)
    def frame(self,index):
        if self.image is not None:return self.image.copy()
        index=max(0,min(self.count-1,index));start=index//16*16
        if self.cache is None or self.cache[0]!=start:
            raw=run(["ffmpeg","-v","error","-threads","1","-ss",f"{start/self.fps:.9f}","-i",str(self.path),
                     "-frames:v","16","-fps_mode","passthrough","-f","rawvideo","-pix_fmt","rgb24","-"]).stdout
            frames=np.frombuffer(raw,np.uint8).reshape(-1,self.h,self.w,3)
            if not len(frames):raise ValueError(f"No frames at {index}: {self.path}")
            self.cache=(start,frames)
        return self.cache[1][min(index-start,len(self.cache[1])-1)].copy()

def hex_color(v):return tuple(bytes.fromhex(v.lstrip("#")))

def fit_frame(frame,target,shot,source):
    W,H=target["width"],target["height"];r=shot.get("crop",target.get("crop"))
    if r:
        x,y,w,h=[int(r[k]) for k in ("x","y","width","height")];frame=frame[y:y+h,x:x+w]
        if not frame.size:raise ValueError("Crop does not intersect source")
    h,w=frame.shape[:2];mode=shot.get("fit","integer" if source.get("pixelArt") else "contain")
    safe=target.get("safeArea",{"x":0,"y":0,"width":W,"height":H});availw=int(safe["width"]);availh=int(safe["height"])
    if mode=="integer":
        k=shot.get("pixelScale",int(min(availw/w,availh/h)))
        if k<1 or k*w>availw or k*h>availh:raise ValueError("Pixel art does not fit at integer scale; increase target or crop explicitly")
        nw,nh=w*k,h*k
    else:
        scale=min(availw/w,availh/h) if mode=="contain" else max(availw/w,availh/h)
        nw,nh=max(1,round(w*scale)),max(1,round(h*scale))
    resized=np.array(Image.fromarray(frame).resize((nw,nh),Image.Resampling.NEAREST if source.get("pixelArt") or mode=="integer" else Image.Resampling.LANCZOS))
    canvas=np.zeros((H,W,3),np.uint8);x=int(safe["x"]+(availw-nw)//2);y=int(safe["y"]+(availh-nh)//2)
    x0=max(int(safe["x"]),x);y0=max(int(safe["y"]),y);x1=min(W,int(safe["x"]+availw),x+nw);y1=min(H,int(safe["y"]+availh),y+nh)
    canvas[y0:y1,x0:x1]=resized[y0-y:y1-y,x0-x:x1-x]
    return canvas

def draw_text(canvas,card,seconds,safe):
    k=card.get("scale",1);size=card.get("fontSize",8);font=ImageFont.truetype(card["font"],size)
    im=Image.fromarray(canvas);lines=[];line_height=size+4
    for original in card["lines"]:
        words=original.split(" ");row=""
        for word in words:
            proposed=(row+" "+word).strip()
            if (math.ceil(font.getlength(proposed))+2)*k>safe["width"]:
                if not row:raise ValueError("Text does not fit safe area at declared integer scale")
                lines.append(row);row=word
            else:row=proposed
        lines.append(row)
    total_height=len(lines)*line_height*k
    y=int(card.get("y",safe["y"]+(safe["height"]-total_height)/2))
    if y<safe["y"] or y+total_height>safe["y"]+safe["height"]:raise ValueError("Text extends outside safe area")
    limit=int(seconds*card["typingCps"]) if card.get("typingCps") else None
    if card.get("flicker") and int(seconds*12)%7==0:return canvas
    for line in lines:
        rendered=line if limit is None else line[:max(0,limit)]
        if limit is not None:limit-=len(line)
        width=int(math.ceil(font.getlength(line)))+2;height=line_height
        mask=Image.new("1",(max(1,width),height));d=ImageDraw.Draw(mask);d.fontmode="1";d.text((0,0),rendered,font=font,fill=1)
        mask=mask.resize((width*k,height*k),Image.Resampling.NEAREST)
        x=int(card.get("x",safe["x"]+(safe["width"]-width*k)/2))
        if x<safe["x"] or x+width*k>safe["x"]+safe["width"]:raise ValueError("Text extends outside safe area")
        im.paste(hex_color(card.get("color","#ffffff")),(x,y),mask);y+=line_height*k
    return np.array(im)

class GenericCompositor:
    def __init__(self,t,target):
        self.t=t;self.target=target;self.shots=[]
        for shot in t["shots"]:
            s=dict(shot);variant=next((v for v in s.get("rampVariants",[]) if v["target"]==target["id"]),None)
            if variant:s["ramp"]=variant["ramp"]
            self.shots.append(s)
        self.sources={s["id"]:s for s in t["sources"]};self.readers={};self.prev=None;self.frozen=None;self.shot=None
        self.rng=np.random.default_rng(t.get("seed",7))
    def reader(self,id):
        if id not in self.readers:self.readers[id]=Reader(self.sources[id],self.target["id"])
        return self.readers[id]
    def draw(self,tt):
        tempo=self.t["tempo"];s=next((s for s in self.shots if edit_time(tempo,s["startBeat"])<=tt<edit_time(tempo,s["startBeat"]+s["beats"])),self.shots[-1])
        seconds=tt-edit_time(tempo,s["startBeat"]);b=local_beat(tempo,s["startBeat"],seconds);W,H=self.target["width"],self.target["height"]
        if self.shot is not s:self.frozen=self.prev;self.shot=s;self.readers.clear()
        if s["kind"]=="card":
            frame=np.empty((H,W,3),np.uint8);frame[:]=hex_color(s["text"].get("background",self.t.get("background","#000000")))
        elif s["kind"]=="pair":
            landscape=W>=H
            parts=[]
            for id in (s["source"],s["secondSource"]):
                r=self.reader(id);f=r.frame(source_frame(s,b,seconds,r.fps));sub=dict(self.target,width=W//2 if landscape else W,height=H if landscape else H//2);sub.pop("safeArea",None)
                parts.append(fit_frame(f,sub,s,self.sources[id]))
            frame=np.concatenate(parts,axis=1 if landscape else 0)
        else:
            r=self.reader(s["source"]);frame=fit_frame(r.frame(source_frame(s,b,seconds,r.fps)),self.target,s,self.sources[s["source"]])
        safe=self.target.get("safeArea",{"x":0,"y":0,"width":W,"height":H})
        if s.get("text"):frame=draw_text(frame,s["text"],seconds,safe)
        if s.get("caption"):frame=draw_text(frame,s["caption"],seconds,safe)
        tr=s.get("transition",{});kind=tr.get("type","cut")
        if kind=="match-cut":
            source=tr.get("sourceRect")
            if source is None:
                meta=json.loads(Path(self.sources[s["source"]]["metadataPath"]).read_text())
                frames=meta.get("rects",[]);rows=[x for x in frames if tr["rectSelector"] in x.get("elements",{})]
                if not rows:raise ValueError("No exported element rect for match cut")
                source=rows[-1]["elements"][tr["rectSelector"]]
            start=tr.get("zoomStartBeat",max(0,s["beats"]-tr.get("beats",1)))
            p=np.clip((b-start)/(s["beats"]-start),0,1)
            frame=zoom(frame,source,tr["targetRect"],p)
        elif kind!="cut" and self.frozen is not None:
            dur=edit_time(tempo,s["startBeat"]+tr.get("beats",.25))-edit_time(tempo,s["startBeat"])
            if seconds<dur:frame=transition(self.frozen,frame,seconds/max(dur,1e-9),kind,tr.get("pixelScale",1),self.rng)
        self.prev=frame;return frame

class ReferenceCompositor:
    def __init__(self,t,target):
        import crucible_v3 as ref
        ref.configure(t,target['id']);self.ref=ref;self.layout=ref.LAYOUT[target["id"]]
        if (target["width"],target["height"])!=(self.layout["W"],self.layout["H"]):raise ValueError("Reference targets retain original dimensions")
        self.rng=np.random.default_rng(t.get("seed",7))
    def draw(self,tt):return self.ref.render(self.layout,tt,self.rng)

def compositor(t,target):return ReferenceCompositor(t,target) if t.get("reference") else GenericCompositor(t,target)

def render_video(t,target,video):
    comp=compositor(t,target);fps=t["fps"];total=edit_time(t["tempo"],t["shots"][-1]["startBeat"]+t["shots"][-1]["beats"])
    # Preserve original v3 floor duration; generic timelines cover their final boundary.
    frames=int(total*fps) if t.get("reference") else int(math.ceil(total*fps-1e-9))
    proc=subprocess.Popen(["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f'{target["width"]}x{target["height"]}',
                           "-r",str(fps),"-i","-","-c:v","ffv1","-threads","1","-fflags","+bitexact","-flags:v","+bitexact",str(video)],stdin=subprocess.PIPE)
    digest=hashlib.sha256()
    try:
        for i in range(frames):
            data=np.ascontiguousarray(comp.draw(i/fps)).tobytes();digest.update(data);proc.stdin.write(data)
            if i%150==0:print(f'{target["id"]}: {i}/{frames}',file=sys.stderr,flush=True)
        proc.stdin.close()
        if proc.wait():raise RuntimeError("ffmpeg lossless encoder failed")
    finally:
        if proc.poll() is None:proc.kill();proc.wait()
    return {"frames":frames,"rgbSha256":digest.hexdigest()}

def mux(t,target,video,audio,final,preview):
    fps=t["fps"];duration=float(probe(video)["format"]["duration"])
    common=["-c:v","libx264","-threads","1","-tune","animation","-pix_fmt","yuv420p","-profile:v","high","-movflags","+faststart",
            "-r",str(fps),"-map_metadata","-1","-fflags","+bitexact","-flags:v","+bitexact"]
    aud=["-c:a","aac","-b:a","160k","-ar","48000","-flags:a","+bitexact"]
    if preview or not target.get("maxBytes"):
        run(["ffmpeg","-v","error","-y","-i",str(video),"-i",str(audio),*common,"-preset","veryfast" if preview else "slow","-crf","30" if preview else "18",*aud,"-shortest",str(final)])
    else:
        kbps=int(target["maxBytes"]*8*.95/duration/1000-160)
        if kbps<64:raise ValueError("Size cap cannot fit audio and video")
        log=str(final.with_suffix(".pass"))
        for attempt in range(3):
            run(["ffmpeg","-v","error","-y","-i",str(video),*common,"-preset","slow","-b:v",str(kbps)+"k","-pass","1","-passlogfile",log,"-an","-f","mp4","/dev/null"])
            run(["ffmpeg","-v","error","-y","-i",str(video),"-i",str(audio),*common,"-preset","slow","-b:v",str(kbps)+"k","-pass","2","-passlogfile",log,*aud,"-shortest",str(final)])
            if final.stat().st_size<=target["maxBytes"]:break
            kbps=int(kbps*target["maxBytes"]/final.stat().st_size*.97)
        if final.stat().st_size>target["maxBytes"]:raise ValueError("Encoded file exceeds size cap")
        for path in final.parent.glob(final.stem+".pass*"):path.unlink()

def ensure_delivery_audio(t,target,raw,audio,final):
    """Measure AAC delivery, then lower normalization ceiling for codec overshoot."""
    ceiling=target.get("truePeak",-1.5);eq="lowpass=f=9000,highpass=f=35" if t.get("reference") else ""
    measured=loudness(final);margin=0.;adjustments=[]
    for attempt in range(3):
        if measured["truePeakDBTP"] is None or measured["truePeakDBTP"]<=ceiling:break
        margin+=measured["truePeakDBTP"]-ceiling+.2
        normalize(raw,audio,target.get("loudness",-14),max(-9,ceiling-margin),eq)
        temp=final.with_name(final.stem+"-audio-adjust.mp4")
        run(["ffmpeg","-v","error","-y","-i",str(final),"-i",str(audio),"-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-b:a","160k","-ar","48000","-threads","1",
             "-map_metadata","-1","-fflags","+bitexact","-flags:a","+bitexact","-movflags","+faststart","-shortest",str(temp)])
        temp.replace(final);measured=loudness(final);adjustments.append({"normalizationCeilingDBTP":max(-9,ceiling-margin),**measured})
    return {"delivery":measured,"adjustments":adjustments}

def stills(t,out,times,targets=None):
    out=Path(out);out.mkdir(parents=True,exist_ok=True);items=[]
    for target in t["targets"]:
        if targets and target["id"] not in targets:continue
        comp=compositor(t,target);wanted={int(math.floor(ts*t["fps"])):ts for ts in times};fps=t["fps"]
        for i in range(max(wanted)+1):
            frame=comp.draw(i/fps)
            if i in wanted:
                path=out/f'still-{target["id"]}-{wanted[i]:08.3f}.png';Image.fromarray(frame).save(path)
                items.append({"target":target["id"],"requestedSeconds":wanted[i],"frame":i,"seconds":i/fps,"path":str(path),"sha256":sha(path)})
    sheet=contact_sheet([x["path"] for x in items],out/"stills-sheet.png")
    return {"stills":items,"sheet":str(sheet),"method":"Replay from frame zero, preserving transition state and RNG"}

def export_frame(video,seconds,out):
    # Decode pixels through ffmpeg; Pillow owns PNG writing, including on minimal runtimes.
    info=probe(video);v=next(s for s in info["streams"] if s["codec_type"]=="video")
    raw=run(["ffmpeg","-v","error","-threads","1","-ss",f"{seconds:.9f}","-i",str(video),
             "-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","-"]).stdout
    expected=v["height"]*v["width"]*3
    if len(raw)!=expected:raise ValueError(f"Expected one frame at {seconds}: {video}")
    Image.fromarray(np.frombuffer(raw,np.uint8).reshape(v["height"],v["width"],3)).save(out)

def contact_sheet(paths,out):
    tiles=[]
    for path in paths:
        im=Image.open(path).convert("RGB");im.thumbnail((320,240),Image.Resampling.NEAREST)
        tile=Image.new("RGB",(340,270));tile.paste(im,((340-im.width)//2,0))
        ImageDraw.Draw(tile).text((8,245),Path(path).name,fill="white");tiles.append(tile)
    cols=min(4,max(1,len(tiles)));sheet=Image.new("RGB",(cols*340,math.ceil(len(tiles)/cols)*270))
    for i,tile in enumerate(tiles):sheet.paste(tile,((i%cols)*340,(i//cols)*270))
    sheet.save(out);return out

def render(t,out,preview=False,targets=None):
    out=Path(out);out.mkdir(parents=True,exist_ok=True);work=out/"work";work.mkdir(exist_ok=True)
    raw=audio_mix(t,work/"mix-raw.wav");items=[]
    for target in t["targets"]:
        if targets and target["id"] not in targets:continue
        audio=work/f'mix-{target["id"]}.wav'
        normalize(raw,audio,target.get("loudness",-14),target.get("truePeak",-1.5),"lowpass=f=9000,highpass=f=35" if t.get("reference") else "")
        video=work/f'video-{target["id"]}.mkv';pixels=render_video(t,target,video)
        final=out/f'{t["name"]}-{target["id"]}.mp4';mux(t,target,video,audio,final,preview)
        audio_result=ensure_delivery_audio(t,target,raw,audio,final)
        frames=pixels["frames"]
        # Poster comes from exact rendered output frame, not an independently seeded draw.
        poster=out/f'poster-{target["id"]}.png';time=edit_time(t["tempo"],target.get("posterBeat",t["shots"][-1]["startBeat"]))
        export_frame(video,min(time,(frames-1)/t["fps"]),poster)
        items.append({"target":target["id"],"path":str(final),"bytes":final.stat().st_size,"sha256":sha(final),"losslessPath":str(video),"poster":str(poster),"audio":audio_result,**pixels})
    manifest={"version":1,"preview":preview,"outputs":items,"inputs":[{"id":s["id"],"sha256":sha(s["path"])} for s in t["sources"]],
              "timelineSha256":hashlib.sha256(json.dumps(t,sort_keys=True,separators=(",",":")).encode()).hexdigest(),
              "ffmpeg":run(["ffmpeg","-version"]).stdout.decode().splitlines()[0],
              "determinism":"Single-threaded encodes, fixed seed, no wall-clock metadata. Hash equality is scoped to pinned toolchain and captures."}
    (out/"render.json").write_text(json.dumps(manifest,indent=2)+"\n")
    manifest["verification"]=verify(t,out)
    (out/"render.json").write_text(json.dumps(manifest,indent=2)+"\n")
    return manifest

def verify(t,out,tolerance=15,loudnessTolerance=.5):
    out=Path(out);manifest=json.loads((out/"render.json").read_text());cuts=[edit_time(t["tempo"],s["startBeat"]) for s in t["shots"][1:]]
    bed=next((s for s in t["sources"] if s["id"]==t["tempo"].get("audioSource")),None)
    bed_layer=next((l for l in t.get("audio",[]) if l["source"]==t["tempo"].get("audioSource") and l["role"]=="bed"),None)
    offset=bed_layer.get("in",beat_time(t["tempo"],0)) if bed_layer else beat_time(t["tempo"],0)
    beat=attack_report(bed["path"],cuts,offset,tolerance) if bed else {"passed":False,"reason":"No declared tempo.audioSource to measure attacks"}
    rows=[];pics=[];framecuts=[math.ceil(c*t["fps"]-1e-9)/t["fps"] for c in cuts]
    encoded=attack_report(bed["path"],framecuts,offset,tolerance+1000/t["fps"]) if bed else None
    for item in manifest["outputs"]:
        target=next(x for x in t["targets"] if x["id"]==item["target"]);path=Path(item["path"])
        loud=loudness(path);budget=target.get("maxBytes")
        okI=loud["integratedLUFS"] is not None and abs(loud["integratedLUFS"]-target.get("loudness",-14))<=loudnessTolerance
        # AAC can introduce small true-peak overshoot, measured on delivery bytes.
        okTP=loud["truePeakDBTP"] is not None and loud["truePeakDBTP"]<=target.get("truePeak",-1.5)+.1
        delivered=attack_report(path,framecuts,0,tolerance+1000/t["fps"]) if bed else None
        info=probe(path);v=next(x for x in info["streams"] if x["codec_type"]=="video");dimensions=v["width"]==target["width"] and v["height"]==target["height"]
        times=[cuts[0] if cuts else 0,cuts[len(cuts)//2] if cuts else 0,max(0,float(info["format"]["duration"])-1)]
        for k,ts in enumerate(times):
            img=out/f'verify-{target["id"]}-{k}.png'
            export_frame(path,ts,img);pics.append(str(img))
        intact=sha(path)==item["sha256"]
        rows.append({"target":item["target"],"path":str(path),**loud,"loudnessPassed":okI,"truePeakPassed":okTP,"bytes":path.stat().st_size,
                     "deliveredAttackAlignment":delivered,"maxBytes":budget,"sizePassed":budget is None or path.stat().st_size<=budget,"hashPassed":intact,"dimensionsPassed":dimensions,
                     "duration":float(info["format"]["duration"]),"passed":okI and okTP and dimensions and intact and (delivered is None or delivered["passed"]) and (budget is None or path.stat().st_size<=budget)})
    result={"version":1,"beatAlignment":beat,"quantizedFrameAlignment":encoded,
            "encodedAttackToleranceMs":tolerance+1000/t["fps"],"frameQuantization":[{"cut":c,"frame":math.ceil(c*t["fps"]-1e-9),"deltaMs":round((q-c)*1000,3)} for c,q in zip(cuts,framecuts)],
            "outputs":rows,"stillsSheet":str(contact_sheet(pics,out/"verification-sheet.png")),
            "passed":beat["passed"] and all(r["passed"] for r in rows),"preview":manifest["preview"]}
    (out/"verification.json").write_text(json.dumps(result,indent=2)+"\n");return result
