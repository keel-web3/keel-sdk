import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main } from './lib/captured-state-witness-cli.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    console.error('Captured-state proof collection refused; original files are preserved.'); process.exitCode = 1;
  });
}
