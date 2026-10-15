#!/usr/bin/env node
// Harmless capability probe: no project input, RPC, credentials or settings changes.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync } from 'node:fs';
import { platform, machine, release } from 'node:os';

if (process.argv.length !== 2) throw new Error('This probe accepts no arguments or project input.');
const read = path => { try { return readFileSync(path, 'utf8').trim(); } catch { return null; } };
const facts = {};
for (const line of (read('/proc/self/status') ?? '').split('\n')) {
  const [name, ...value] = line.split(':');
  if (['Uid', 'Gid', 'CapEff', 'NoNewPrivs', 'Seccomp', 'Seccomp_filters'].includes(name)) facts[name] = value.join(':').trim();
}
let netns = null;
try { netns = readlinkSync('/proc/self/ns/net'); } catch {}
const eligible = platform() === 'linux' && existsSync('/usr/bin/unshare') && existsSync('/usr/bin/true');
const result = eligible ? spawnSync('/usr/bin/unshare', ['-Urn', '/usr/bin/true'], {
  env: { PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024,
}) : null;
const passed = result !== null && !result.error && result.status === 0;
console.log(JSON.stringify({ schema: 'keel-native-runtime-capability-probe@1', platform: platform(), kernelMachine: machine(),
  kernelRelease: release(), node: process.version, nodeArch: process.arch, uid: process.getuid?.() ?? null, gid: process.getgid?.() ?? null,
  status: facts, parentNetns: netns, unprivilegedUsernsClone: read('/proc/sys/kernel/unprivileged_userns_clone'),
  maximumUserNamespaces: read('/proc/sys/user/max_user_namespaces'), executablePresent: eligible,
  command: ['/usr/bin/unshare', '-Urn', '/usr/bin/true'], exitCode: result?.status ?? null, signal: result?.signal ?? null,
  errorCode: result?.error?.code ?? null, stderr: result?.stderr?.slice(0, 4096) ?? null, namespaceProbePassed: passed,
  reviewedAmd64Kernel: machine() === 'x86_64', nativeEngineQualified: false, projectAcceptance: false,
  networkRequests: 0, signing: false, submission: false, settingsChanged: false }, null, 2));
process.exitCode = passed ? 0 : 1;
