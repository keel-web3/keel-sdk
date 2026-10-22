import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const frozen = '/private/tmp/keel-private-rpc-revert-successor-20261022-01/sdk/';
const config = ts.readConfigFile('tsconfig.base.json', ts.sys.readFile);
const converted = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, '.');
assert.equal(converted.errors.length, 0);
// The single-file API does not discover package.json's ESM boundary for a
// synthetic NodeNext filename. Verify exact frozen ESM byte parity first.
const options = { ...converted.options, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
const build = source => ts.transpileModule(source, { compilerOptions: options, fileName: 'rpc.ts', reportDiagnostics: true });
assert.ok(build(readFileSync(frozen + 'packages/sdk/src/rpc.ts', 'utf8')).outputText === readFileSync(frozen + 'packages/sdk/dist/rpc.js', 'utf8'),
  'single-file compiler must emit exact frozen ESM baseline before correction');
const result = build(readFileSync('packages/sdk/src/rpc.ts', 'utf8'));
assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
writeFileSync('packages/sdk/dist/rpc.js', result.outputText);
writeFileSync('packages/sdk/dist/rpc.js.map', result.sourceMapText);
writeFileSync(new URL('./single-file-transpile.json', import.meta.url), JSON.stringify({ node: process.version, typescript: ts.version,
  baselineJavaScriptParity: true, explicitModule: 'ESNext', explicitModuleResolution: 'Bundler', changedModule: 'packages/sdk/src/rpc.ts',
  diagnosticErrors: 0, fullTypecheck: false, fullBuild: false }, null, 2) + '\n');
console.log('Single-file transpile PASS; exact frozen ESM baseline parity verified. No full build/typecheck.');
