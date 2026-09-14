import {parentPort,workerData} from 'node:worker_threads';
import {optimizeLayerPNG} from '@keel/sdk/layered-png';
try { const result=await optimizeLayerPNG(workerData.bytes);parentPort.postMessage({result},[result.bytes.buffer]); }
catch(error){parentPort.postMessage({error:error.message});}
