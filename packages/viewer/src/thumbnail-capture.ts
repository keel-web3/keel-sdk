/** Background intrinsic-surface capture for opaque KEEL viewers. Hosts validate messages by iframe identity. */
export function createThumbnailCaptureScript(): string {
  return `<script data-keel-sandbox-poster-capture>(()=>{
    let explicit=false, pending, generation=0, motion;
    const finish=()=>{if(!motion)return;clearInterval(motion.timer);const result=motion;motion=undefined;send("sequence",{frames:result.frames,width:result.width,height:result.height,frameRate:result.frameRate})};
    const send=(action,extra={})=>parent.postMessage({protocol:"keel-sandbox-poster@1",action,...extra},"*");
    const capture=()=>{
      clearTimeout(pending);
      const ticket=++generation;
      const marked=document.querySelector("[data-keel-thumbnail]");
      const candidates=marked?[marked]:[...document.querySelectorAll("canvas,video,img"),...Array.from(document.querySelectorAll("ruffle-player"),p=>p.shadowRoot?.querySelector("canvas")).filter(Boolean)];
      if(candidates.length!==1){send("unavailable",{reason:candidates.length?"Choose one preview surface with data-keel-thumbnail.":"No preview surface is ready."});return}
      const source=candidates[0];
      const width=source instanceof HTMLCanvasElement?source.width:source instanceof HTMLImageElement?source.naturalWidth:source instanceof HTMLVideoElement?source.videoWidth:0;
      const height=source instanceof HTMLCanvasElement?source.height:source instanceof HTMLImageElement?source.naturalHeight:source instanceof HTMLVideoElement?source.videoHeight:0;
      if(!width||!height){send("unavailable",{reason:"The preview surface has no pixels yet."});return}
      const requested=source.getAttribute?.("data-keel-thumbnail-motion");
      if(requested!==null&&requested!==undefined&&!motion){
        const frameRate=requested===""?12:Number(requested);
        if(!Number.isInteger(frameRate)||frameRate<1||frameRate>30){send("unavailable",{reason:"Motion preview rate must be from 1 through 30."});return}
        const surface=document.createElement("canvas"),ratio=Math.min(1,256/Math.max(width,height));
        surface.width=Math.max(1,Math.round(width*ratio));surface.height=Math.max(1,Math.round(height*ratio));
        const context=surface.getContext("2d",{willReadFrequently:true});
        if(!context){send("unavailable");return}
        motion={frames:[],width:surface.width,height:surface.height,frameRate,timer:undefined};
        const sample=()=>{if(!motion)return;try{context.drawImage(source,0,0,surface.width,surface.height);motion.frames.push(context.getImageData(0,0,surface.width,surface.height).data.buffer);if(motion.frames.length>=Math.min(120,frameRate*30))finish()}catch(error){clearInterval(motion.timer);motion=undefined;send("unavailable",{reason:String(error)})}};
        sample();if(motion)motion.timer=setInterval(sample,1000/frameRate);
      }
      const limit=512;const target=document.createElement("canvas"),scale=Math.min(1,limit/Math.max(width,height));
      target.width=Math.max(1,Math.round(width*scale));target.height=Math.max(1,Math.round(height*scale));
      try{
        const context=target.getContext("2d");if(!context)throw new Error("Canvas capture is unavailable.");
        context.drawImage(source,0,0,target.width,target.height);
        target.toBlob(blob=>{if(ticket!==generation)return;if(!blob||blob.type!=="image/webp"){send("unavailable");return}send("captured",{blob,width:target.width,height:target.height})},"image/webp",0.82);
      }catch(error){send("unavailable",{reason:String(error)})}
    };
    const receive=({detail})=>{if(detail?.protocol!=="keel-thumbnail-capture@1")return;explicit=true;clearTimeout(pending);if(detail.action==="init"){if(motion){clearInterval(motion.timer);motion=undefined}generation++;send("waiting")}else if(detail.action==="capture")capture();else if(detail.action==="stop")finish()};
    addEventListener("keel-thumbnail-capture",receive);
    if(!globalThis.__KEEL_THUMBNAIL__){
      const emit=(action,label="hero")=>{const detail={protocol:"keel-thumbnail-capture@1",action,label};dispatchEvent(new CustomEvent("keel-thumbnail-capture",{detail}));parent.postMessage(detail,"*")};
      const init=label=>emit("init",label),ready=label=>emit("capture",label),stop=label=>emit("stop",label);
      Object.defineProperty(globalThis,"__KEEL_THUMBNAIL__",{value:Object.freeze({protocol:"keel-thumbnail-capture@1",init,ready,capture:ready,stop,after:(delay,label)=>{if(!Number.isFinite(delay)||delay<0||delay>30000)throw new RangeError("Invalid capture delay.");explicit=true;clearTimeout(pending);pending=setTimeout(()=>ready(label),delay)}})});
    }
    addEventListener("load",()=>{if(!explicit)capture()},{once:true});
  })();</script>`;
}
