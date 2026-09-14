import ts from '../../node_modules/typescript/lib/typescript.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('.', import.meta.url));
const config = ts.readConfigFile(path.join(root,'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const overrides = new Map();
const host = {
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: () => String(overrides.size),
  getScriptSnapshot: file => { const text=overrides.get(file) ?? ts.sys.readFile(file); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
  getCurrentDirectory: () => root, getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
};
let service = ts.createLanguageService(host);
const file = path.join(root,'src/art.ts');
const source = ts.sys.readFile(file);
const diagnostics = service.getSemanticDiagnostics(file);
assert.equal(diagnostics.length,0,diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')).join('\n'));
const complete = (text, offset) => {
  const position = source.indexOf(text) + offset;
  assert(position >= offset);
  return service.getCompletionsAtPosition(file,position,{})?.entries.map(entry=>entry.name) ?? [];
};
const thumbnail = complete('thumbnail.snapshot', 'thumbnail.'.length);
const state = complete('state.captures', 'state.'.length);
assert(thumbnail.includes('snapshot'));
assert(state.includes('captures') && state.includes('label'));
const snapshotPosition = source.indexOf('thumbnail.snapshot') + 'thumbnail.'.length;
const snapshotHover = ts.displayPartsToString(service.getQuickInfoAtPosition(file,snapshotPosition)?.displayParts);
assert.match(snapshotHover,/label\?: string/);
const solarPosition = source.indexOf('solarDates(2026');
const solarHover = ts.displayPartsToString(service.getQuickInfoAtPosition(file,solarPosition)?.displayParts);
assert.match(solarHover,/year\?: number/);
assert.match(solarHover,/includeLunar: boolean/);
const globalCompletions = complete('KEEL_solarDates(2026)', 'KEEL_So'.length);
assert(globalCompletions.includes('KEEL_solarDates'));
const generated = path.join(root,'.keel/module-inclusions.d.ts');
overrides.set(generated, 'export {};');
service.dispose(); service=ts.createLanguageService(host);
const missing=service.getSemanticDiagnostics(file);
assert(missing.some(d=>d.code===2304 && ts.flattenDiagnosticMessageText(d.messageText,'\n').includes('thumbnail')),'Excluded module did not disappear from editor types');
const result={engine:`TypeScript language service ${ts.version}`,diagnostics:0,thumbnailCompletions:thumbnail,stateCompletions:state,snapshotHover,solarHover,explicitGlobalCompletion:true,excludedModuleRejected:true};
await mkdir(path.join(root,'evidence'),{recursive:true});
await writeFile(path.join(root,'evidence/editor.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
service.dispose();
