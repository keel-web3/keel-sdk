// Additional adapters implement (capture, outDir, context) -> structured artifacts.
import {CAPTURE_SCHEMA,assertSchema} from '../schema.mjs';
import {webCapture} from './web.mjs';
import {fileCapture} from './files.mjs';
const optionsSchemas=new Map();
const adapters=new Map([['web',webCapture],['video',fileCapture],['image',fileCapture]]);
export function registerCaptureAdapter(name,adapter,optionsSchema={type:'object',additionalProperties:false}) {
  if(!/^[a-z][a-z0-9-]*$/.test(name) || typeof adapter!=='function')throw Error('Invalid adapter');
  if(adapters.has(name))throw Error('Adapter already registered: '+name);adapters.set(name,adapter);optionsSchemas.set(name,optionsSchema);CAPTURE_SCHEMA.properties.adapter.enum.push(name);
}
export async function captureWithAdapter(c,outDir,context) {
  if(c.adapter==='gameboy')return context.worker('gameboy',{capture:c,outDir});
  const adapter=adapters.get(c.adapter);if(!adapter)throw Error('Unknown capture adapter');
  if(optionsSchemas.has(c.adapter))assertSchema(c.options??{},optionsSchemas.get(c.adapter));
  return adapter(c,outDir,context);
}
