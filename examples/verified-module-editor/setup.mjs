import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareUnverifiedClassicModule } from '../../packages/builder/dist/module-unverified.js';
import { installKeelModule } from '../../packages/builder/dist/module-install.js';
import { createKeelModuleInclusions } from '../../packages/builder/dist/module-inclusion.js';
import { createKeelGlobalDeclarations } from '../../packages/builder/dist/module-global-types.js';
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(path.join(root, 'node_modules/@keel'), { recursive: true });
const sdk = fileURLToPath(new URL('../../packages/sdk', import.meta.url));
const link = path.join(root, 'node_modules/@keel/sdk');
try { await symlink(path.relative(path.dirname(link), sdk), link, 'dir'); }
catch (error) { if (error.code !== 'EEXIST' || await realpath(link) !== sdk) throw error; }
const result = await installKeelModule({
  projectRoot: root, name: 'thumbnail-capture', expectedOutput: '0x8f48f68b345b05f28bec0efc0a94103b97d1249ac35a286f8aa3f7b5125cee18',
  origin: { protocol: 'keel-source-origin@1', provider: 'github', owner: 'keel-web3', repo: 'thumbnail-capture',
    commit: 'ba2f12b6982a51dc52529e1d373ff0240d110c5d', visibility: 'public' },
  identity: { namespace: 'keel', name: 'thumbnail-capture', version: '0.2.0', entry: 'src/index.ts' },
  entry: 'src/index.ts', compact: { keepComments: false },
});
await writeFile(path.join(root, '.keel/globals.d.ts'), createKeelGlobalDeclarations(root, [path.join(root, 'src/art.ts')]));
console.log(`Installed ${result.packageName} from verified commit ${result.sourceCommit}. Open KEEL.code-workspace.`);

const uploadParent=path.join(root,'.keel/uploads');
await mkdir(uploadParent,{recursive:true});
const uploadDirectory=path.join(uploadParent,'solar-example-v2');
try { await prepareUnverifiedClassicModule({name:'solar-example',source:await readFile(path.join(root,'uploads/solar.js'),'utf8'),observation:JSON.parse(await readFile(path.join(root,'uploads/solar.observation.json'),'utf8')),outputDirectory:uploadDirectory}); }
catch(error) { if(error.code!=='EEXIST') throw error; }
const uploadLink=path.join(root,'node_modules/@keel-modules/solar-example');
try { await symlink(path.relative(path.dirname(uploadLink),uploadDirectory),uploadLink,'dir'); }
catch(error) { if(error.code!=='EEXIST'||await realpath(uploadLink)!==uploadDirectory) throw error; }
const modules = [{ name: 'thumbnail', specifier: '@keel-modules/thumbnail-capture' },{name:'solar',specifier:'@keel-modules/solar-example'}];
await writeFile(path.join(root, '.keel/module-inclusions.d.ts'), createKeelModuleInclusions(root, modules).declarations);
await writeFile(path.join(root, 'keel.includes.json'), JSON.stringify(modules, null, 2) + '\n');
