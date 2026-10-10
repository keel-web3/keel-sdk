// CI IPC client container only. The application imports runner-client.mjs directly.
import { createIsolatedRunnerSpawner } from './runner-client.mjs';
const child=createIsolatedRunnerSpawner({socketPath:process.env.KEEL_RUNNER_SOCKET,binarySha256:process.env.KEEL_EXECUTOR_SHA256})();
process.stdin.pipe(child.stdin);
process.stdin.once('end',()=>child.kill());
child.stdout.pipe(process.stdout);child.stderr.resume();
process.once('SIGTERM',()=>child.kill());process.once('SIGINT',()=>child.kill());
child.once('close',code=>{process.stdin.unpipe();process.stdout.write('',()=>process.exit(code));});
