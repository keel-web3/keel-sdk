import { main } from './lib/captured-state-inventory-cli.mjs';
main().then(code => { process.exitCode = code; }).catch(() => {
  console.error('State inventory capture refused; saved originals are unchanged.');
  process.exitCode = 1;
});
