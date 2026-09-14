import {readFile,writeFile} from 'node:fs/promises';
import {planQueueAccess} from './lib/queue-access-plan.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node tools/keel/queue-access-plan.mjs input.json output.json');
const plan=planQueueAccess(JSON.parse(await readFile(input,'utf8')));
await writeFile(output,JSON.stringify(plan,(_,value)=>typeof value==='bigint'?value.toString():value,2)+'\n');
console.log(`Prepared ${plan.calls.length} unsigned calls. Policy starts paused; activation is separate.`);
