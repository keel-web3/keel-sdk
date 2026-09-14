import test from 'node:test';
import assert from 'node:assert/strict';
import {inferUnverifiedModule} from '../packages/builder/dist/module-unverified.js';
import {createIntegrity} from '../packages/protocol/dist/index.js';
import {createKeelEditorProject,zipKeelEditorProject} from '../packages/builder/dist/module-project.js';
import {bundleKeelEditorModules} from '../packages/builder/dist/module-project-bundle.js';

test('ESM exports become typed portable project bindings and exact bundled imports',async()=>{
 const source='export function solarDates(year=2026){return {year}}';const {digest}=await createIntegrity(new TextEncoder().encode(source));
 const module=await inferUnverifiedModule({name:'solar',source,format:'esm',observation:{schema:'keel-module-observation@1',digest,trust:'unverified-observation',globals:{},exports:{solarDates:{kind:'function'}}}});
 assert.equal(module.files['index.js'],source);assert.match(module.files['index.d.ts'],/year\?: number/);
 const project=createKeelEditorProject([{name:'solar',files:module.files}]);
 assert(project.names.includes('solarDates'));assert(project.names.includes('KEEL_solar_solarDates'));
 assert.match(await bundleKeelEditorModules(project),/Global already occupied/);
 const zip=zipKeelEditorProject(project.files);assert.equal(new DataView(zip.buffer).getUint32(0,true),0x04034b50);
 await assert.rejects(bundleKeelEditorModules({...project,files:{...project.files,'modules/solar/index.js':'import "../../../../outside.js";'}}),/escapes/);
 assert.throws(()=>zipKeelEditorProject({'../escape':'bad'}),/Unsafe/);
});
