import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { GenerativeRedesignService, parseRedesignResponse, redesignPrompt } from '../src/game-engine/generative-redesign-service.mjs';

const objectId = 'a'.repeat(64);
const program = { format: 'keel-generative-program@1', id: 'fox', title: 'Engine fox', ops: [{ op: 'character', kind: 'animal', species: 'fox', seed: { $seed: true } }, { op: 'target', as: 'entity', id: 'fox' }] };
const input = (patch = {}) => ({ requestId: crypto.randomUUID(), objectId, provider: 'codex', seed: '7', mode: 'original', theme: '', guidance: 'Keep the tall ears', style: { kind: 'original', pixelSize: 4, toneLevels: 8, screen: 'bayer4' }, ...patch });
function fixture(overrides = {}) {
  const calls = [], directories = [], previews = [];
  const store = { read: () => ({ state: { projects: [{ secret: 'DO-NOT-SEND-PROJECT' }], objects: [{ id: objectId, name: 'selected.glb', byteLength: 3 }, { id: 'b'.repeat(64), name: 'unselected-secret.obj', byteLength: 3 }] } }), verifyObject: async id => { assert.equal(id, objectId); }, object: id => { assert.equal(id, objectId); return new Uint8Array([1, 2, 3]); } };
  const builder = {
    redesignReference: async () => ({ programReference: { format: 'keel-generative-program@1', example: program }, styles: { screens: ['bayer4'], kinds: ['original', 'pixel', 'dither', 'voxel'] } }),
    redesignSource: async file => { assert.equal(file.fileName, 'selected.glb'); assert.deepEqual([...file.bytes], [1, 2, 3]); return { kind: 'selected-model-descriptor', parts: ['body', 'ears'], palette: [[0.8, 0.4, 0.1]], bounds: [2, 3, 1] }; },
    redesignPreview: async value => { previews.push(value); return { ok: true, program: value.program, seed: value.seed, ops: [{ op: 'character', seed: value.seed }], frame: {}, playback: {}, stats: {}, validation: { ok: true, errors: [] } }; },
    ...(overrides.builder ?? {}),
  };
  const service = new GenerativeRedesignService({ builder, store, command: async provider => `/fake/${provider}`, runProvider: async (...args) => {
    calls.push(args); directories.push(args[2]); assert.deepEqual(await readdir(args[2]), []);
    return { text: JSON.stringify(program) };
  }, ...overrides, builder });
  return { service, calls, directories, previews, builder };
}
test('explicit selected model only reaches existing scoped bridge; acceptance and seed previews do not call a provider', async () => {
  const { service, calls, directories, previews } = fixture(), request = input();
  try {
    const candidate = await service.generate(request);
    assert.equal(candidate.source.objectId, objectId);
    assert.equal(candidate.source.name, 'selected');
    assert.equal(candidate.seed, '7'); assert.equal(candidate.settings.mode, 'original');
    const [provider, prompt, directory, options] = calls[0];
    assert.equal(provider, 'codex'); assert.equal(options.command, '/fake/codex'); assert.deepEqual(options.tools, []);
    assert.equal(options.handleTool, undefined); assert.equal(options.mcpConfig, undefined);
    assert.match(prompt, /parts.*body.*ears/); assert.doesNotMatch(prompt, /DO-NOT-SEND|unselected-secret|apiKey|projectId|history/i);
    assert.match(options.instructions, /not an image/);
    await assert.rejects(access(directory), { code: 'ENOENT' });
    assert.equal(directories.length, 1);
    candidate.program.title = 'tampered';
    const accepted = service.accept({ requestId: request.requestId });
    assert.equal(accepted.program.title, 'Engine fox');
    assert.deepEqual(service.accept({ requestId: request.requestId }), accepted, 'failed persistence can retry exact candidate');
    const varied = await service.preview({ requestId: request.requestId, seed: '8' });
    assert.equal(varied.seed, '8'); assert.notEqual(varied.artifactId, accepted.artifactId);
    assert.equal(calls.length, 1); assert.equal(previews.length, 2);
    assert.equal(service.accept({ requestId: request.requestId }).seed, '8');
    assert.equal(service.cancel({ requestId: request.requestId }).cancelled, true);
    assert.throws(() => service.accept({ requestId: request.requestId }), /cancelled or expired/);
  } finally { service.close(); }
});
test('theme and exact same visual parameters reach both providers as data; fresh authoring is labeled nondeterministic', async () => {
  for (const provider of ['codex', 'claude']) {
    const { service, calls } = fixture();
    const candidate = await service.generate(input({ provider, mode: 'theme', theme: 'Moonlit porcelain', model: 'chosen-model', style: { kind: 'dither', pixelSize: 5, toneLevels: 12, screen: 'bayer4' } }));
    assert.match(calls[0][1], /Moonlit porcelain/); assert.match(calls[0][1], /"kind":"dither","pixelSize":5,"toneLevels":12,"screen":"bayer4"/);
    assert.equal(calls[0][3].model, 'chosen-model'); assert.match(candidate.determinism, /not deterministic/); service.close();
  }
});
test('invalid input and unsupported screens fail before inference', async () => {
  const { service, calls } = fixture();
  for (const request of [input({ provider: 'openai' }), input({ mode: 'theme', theme: '' }), input({ style: { kind: 'dither', pixelSize: 0, toneLevels: 12, screen: 'bayer4' } }), input({ style: { kind: 'pixel', pixelSize: 4, toneLevels: 8, screen: 'invented' } }), input({ sourcePath: '/private/files' })]) await assert.rejects(service.generate(request));
  assert.equal(calls.length, 0); service.close();
});
test('cancel while inspecting selected source prevents even starting inference', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const { service, calls } = fixture({ builder: { redesignSource: async () => pending } });
  const request = input(), result = service.generate(request);
  const rejected = assert.rejects(result, /cancelled/);
  await new Promise(resolve => setImmediate(resolve));
  service.cancel({ requestId: request.requestId }); release({}); await rejected;
  assert.equal(calls.length, 0); assert.equal(service.jobs.size, 0); service.close();
});
test('cancel signals bridge and rejects late response; duplicate and overlapping turns never double invoke', async () => {
  let release, started, signal;
  const running = new Promise(resolve => { started = resolve; });
  const { service } = fixture({ runProvider: async (_provider, _prompt, _directory, options) => { signal = options.signal; started(); return new Promise(resolve => { release = resolve; }); } });
  const request = input(), result = service.generate(request), rejected = assert.rejects(result, /cancelled/);
  await running;
  await assert.rejects(service.generate(request), /already started/);
  await assert.rejects(service.generate(input()), /Another redesign/);
  service.cancel({ requestId: request.requestId }); assert.equal(signal.aborted, true);
  release({ text: JSON.stringify(program) }); await rejected;
  assert.equal(service.jobs.size, 0); service.close();
});
test('provider JSON and engine validation are enforced and failed turns cannot be accepted', async () => {
  assert.throws(() => parseRedesignResponse('process.exit(1)'), /JSON program/);
  assert.throws(() => parseRedesignResponse('{"format":"other"}'), /unsupported/);
  assert.deepEqual(parseRedesignResponse('```json\n' + JSON.stringify(program) + '\n```'), program);
  assert.throws(() => parseRedesignResponse('Explanation\n' + JSON.stringify(program)), /JSON program/);
  assert.throws(() => parseRedesignResponse(' '.repeat(160001)), /limit/);
  const { service } = fixture({ builder: { redesignPreview: async () => ({ ok: false, validation: { ok: false, errors: [{ path: 'ops[0]', message: 'work budget exceeded' }] } }) } });
  const request = input(); await assert.rejects(service.generate(request), /ops\[0\]: work budget exceeded/);
  assert.throws(() => service.accept({ requestId: request.requestId }), /cancelled or expired/); service.close();
});
test('pending seed validation blocks accept and failed seed keeps the last validated candidate', async () => {
  const { service, builder } = fixture(), request = input();
  await service.generate(request);
  let release;
  builder.redesignPreview = async () => new Promise(resolve => { release = resolve; });
  const result = service.preview({ requestId: request.requestId, seed: 'bad-seed' }), rejected = assert.rejects(result, /failed engine validation/);
  assert.throws(() => service.accept({ requestId: request.requestId }), /finish/);
  release({ ok: false, validation: { ok: false, errors: [{ path: 'seed', message: 'invalid variant' }] } }); await rejected;
  assert.equal(service.accept({ requestId: request.requestId }).seed, '7'); service.close();
});
test('prompt and retained candidates have bounded lifetime and counts', async () => {
  assert.throws(() => redesignPrompt({}, { huge: 'x'.repeat(48000) }, {}, '1'), /descriptor/);
  assert.throws(() => redesignPrompt({ programReference: 'x'.repeat(120001) }, {}, {}, '1'), /reference/);
  let now = 0; const { service } = fixture({ now: () => now });
  const first = input(); await service.generate(first);
  for (let i = 0; i < 3; i++) await service.generate(input());
  await assert.rejects(service.generate(input()), /Keep or discard/);
  now += 31 * 60000;
  assert.throws(() => service.accept({ requestId: first.requestId }), /expired/);
  assert.equal(service.jobs.size, 0); service.close();
});
