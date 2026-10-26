#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {runTrailerTool,TIMELINE_SCHEMA,TOOL_SCHEMAS,validateTimeline} from './index.mjs';
const [op,...args]=process.argv.slice(2);
const help='keel-trailer plan|capture|beats|render|verify|stills|snapshot|clip|inspect --json request.json [--workspace DIR]\nkeel-trailer render TIMELINE --out DIR [--preview] [--targets 16x9,9x16]\nkeel-trailer render TIMELINE --out DIR --stills 1,7.5\nkeel-trailer schema|tools|validate TIMELINE\nSet TRAILER_PYTHON to the interpreter with requirements.txt installed.';
function opt(key,fallback){const i=args.indexOf('--'+key);return i<0?fallback:args[i+1];}
try {
  if(!op||op==='--help'){console.log(help);process.exit(0);}
  if(op==='schema'){console.log(JSON.stringify(TIMELINE_SCHEMA,null,2));process.exit(0);}
  if(op==='tools'){console.log(JSON.stringify(TOOL_SCHEMAS,null,2));process.exit(0);}
  if(op==='validate'){const r=validateTimeline(JSON.parse(await readFile(args[0],'utf8')));console.log(JSON.stringify(r,null,2));process.exit(r.valid?0:1);}
  let input;
  if(opt('json'))input=JSON.parse(await readFile(opt('json'),'utf8'));
  else if(['render','stills','verify'].includes(op)){
    input={timelinePath:args[0],...(op==='verify'?{renderDir:opt('out','artifacts')}:{outDir:opt('out','artifacts')})};
    if(args.includes('--preview'))input.preview=true;
    if(opt('remote'))input.remote=opt('remote');
    if(opt('targets'))input.targets=opt('targets').split(',');
    if(opt('stills')){delete input.preview;input.times=opt('stills').split(',').map(Number);}
  }else if(op==='beats')input={audioPath:args[0],...(opt('bpm')?{bpm:Number(opt('bpm'))}:{}),...(opt('out')?{outPath:opt('out')}:{})};
  else throw Error('Use --json request.json for '+op);
  const name=opt('stills')?'trailer-stills':'trailer-'+op;
  const result=await runTrailerTool(name,input,{workspaceRoot:opt('workspace',process.cwd()),log:s=>process.stderr.write(s)});
  console.log(JSON.stringify(result,null,2));
} catch(e){console.log(JSON.stringify({error:{code:e.code??'TRAILER_ERROR',message:e.message,...(e.load?{load:e.load}:{})}}));process.exitCode=1;}
