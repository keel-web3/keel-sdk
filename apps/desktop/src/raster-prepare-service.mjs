import {Worker} from 'node:worker_threads';
export class RasterPrepareService{
  constructor(workerPath){this.workerPath=workerPath;this.active=null;}
  async prepare(data){if(this.active)throw Error('An image is already being prepared.');const worker=new Worker(this.workerPath,{workerData:data,resourceLimits:{maxOldGenerationSizeMb:512}});this.active=worker;
    try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{reject(Error('Image preparation timed out.'));void worker.terminate();},120000);worker.once('message',m=>{clearTimeout(timer);m.error?reject(Error(m.error)):resolve(m.result);});worker.once('error',e=>{clearTimeout(timer);reject(e);});worker.once('exit',()=>{clearTimeout(timer);reject(Error('Image preparation stopped.'));});});}finally{await worker.terminate();this.active=null;}}
  close(){void this.active?.terminate();}
}
