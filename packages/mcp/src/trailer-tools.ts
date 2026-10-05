import { runTrailerTool, TOOL_SCHEMAS } from '@keel/trailer';
import type { ToolDefinition, JsonSchema } from './types.js';

const descriptions: Record<string,string> = {
  'trailer-plan':'Scaffold a private KEEL trailer timeline from a creative brief and project-owned sources. Returns editable JSON and planning notes; no language-model call, upload, signing or publication.',
  'trailer-capture':'Capture web frames with a paused deterministic Playwright clock, scripted Game Boy/PyBoy frames or ROM-specific link pair, or import local video/image. Returns artifact paths, hashes and capture metadata. Uses only the MCP workspace; checks machine load.',
  'trailer-beats':'Analyze original project audio attacks/onsets and tempo or validate a declared beat grid. Returns JSON beat map, confidence and audio hash. Declared beats override tempo guessing.',
  'trailer-render':'Render a validated beat timeline to requested aspect targets using ffmpeg, integer pixel scaling, KEEL dither and seeded effects. Returns paths, hashes and frame counts. preview makes a draft encode; load above 40 requires offloading.',
  'trailer-verify':'Verify rendered delivery files: PCM attack alignment for every cut, frame quantization, measured LUFS/true peak, dimensions, hashes, byte caps and a stills sheet. Returns explicit pass/fail JSON, including failures.',
  'trailer-stills':'Replay a timeline from frame zero and export exact requested still frames and a sheet. Preserves transition state and RNG so stills match the rendered edit.'
};
export const TRAILER_TOOL_DEFINITIONS: readonly ToolDefinition[] = Object.entries(TOOL_SCHEMAS).map(([name,schema])=>({
  descriptor:{name,description:descriptions[name]!,inputSchema:schema as JsonSchema},
  async run(context,input){
    return runTrailerTool(name,input,{workspaceRoot:context.workspace.root,log:(s:string)=>process.stderr.write(s)});
  }
}));
