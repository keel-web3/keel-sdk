export function authoredFixture() {
  return { title: 'Functional artwork', chainId: 11155111, start: { module: 'artwork-renderer', export: 'mount' }, stylesheet: 'html,body{margin:0}canvas{image-rendering:pixelated}', modules: [
    { id: 'scene-state', purpose: 'Deterministic scene colors and layout', source: 'export function pixel(x,y){return [(x*61+y*17)%256,(x*11+y*73)%256,(x*43+y*29)%256,255];}\n' },
    { id: 'artwork-renderer', purpose: 'Render the scene as exact artwork pixels', source: 'import {pixel} from "./scene-state.js";\nexport function mount(root){const canvas=document.createElement("canvas");canvas.width=4;canvas.height=4;root.append(canvas);const context=canvas.getContext("2d"),image=context.createImageData(4,4);for(let y=0;y<4;y++)for(let x=0;x<4;x++)image.data.set(pixel(x,y),(y*4+x)*4);context.putImageData(image,0,0);parent.postMessage({keelOfflineProbe:JSON.stringify([...context.getImageData(0,0,4,4).data])},"*");}\n' },
  ] };
}
export const expectedPixels = Array.from({length:16},(_,index)=>{const x=index%4,y=Math.floor(index/4);return[(x*61+y*17)%256,(x*11+y*73)%256,(x*43+y*29)%256,255]}).flat();
