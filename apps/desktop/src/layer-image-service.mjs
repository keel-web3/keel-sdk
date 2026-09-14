import {Worker} from 'node:worker_threads';
/** One CPU-heavy conversion at a time; the editor and wallet remain responsive. */
export class LayerImageService {
  constructor(workerPath){this.workerPath=workerPath;this.active=null;}
  async convert(bytes){
    if(this.active)throw Error('Another layer is being prepared. Try again when it finishes.');
    const worker=new Worker(this.workerPath,{workerData:{bytes},resourceLimits:{maxOldGenerationSizeMb:256}});this.active=worker;
    try{return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{reject(Error('Layer conversion timed out. The original is preserved.'));void worker.terminate();},120000);
      worker.once('message',message=>{clearTimeout(timer);message.error?reject(Error(message.error)):resolve(message.result);});
      worker.once('error',error=>{clearTimeout(timer);reject(error);});
      worker.once('exit',code=>{clearTimeout(timer);reject(Error('Layer conversion stopped before returning an image. The original is preserved.'));});
    });}finally{await worker.terminate();this.active=null;}
  }
  close(){void this.active?.terminate();}
}
