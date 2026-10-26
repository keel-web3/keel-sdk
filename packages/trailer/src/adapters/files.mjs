import {copyFile,stat,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export async function fileCapture(c,outDir) {
  await mkdir(outDir,{recursive:true});const dest=path.join(outDir,c.adapter+path.extname(c.path));
  if(path.resolve(c.path)!==path.resolve(dest))await copyFile(c.path,dest);
  const result={adapter:c.adapter,path:dest,bytes:(await stat(dest)).size,sha256:createHash('sha256').update(await readFile(dest)).digest('hex')};
  await writeFile(path.join(outDir,'capture.json'),JSON.stringify(result,null,2)+'\n');return result;
}
