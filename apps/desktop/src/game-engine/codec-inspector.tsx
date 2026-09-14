// The codec inspector: any KEEL bit-codec document taken apart field by field
// (explainBits, in the codec worker) -- the schema it names or carries, sizes
// against its JSON, a tree of fields with their bits, the hex view painted by
// what each bit is (a value, overhead, text, the header, padding), hovering
// either side lighting the other, what's big, the schema as data, the JSON
// view (editable: re-encoded to canonical bytes, or the field that's wrong),
// and a Solidity decoder for fixed layouts. Opened from the Game engine page,
// from a project's codec records, or by any tab through openCodecInspector().
// The renderer never loads engine code: bytes go to main, JSON comes back.
import React, { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Project, Workspace } from '../types';
import { api, queryClient } from '../client';
import { Badge, Empty, Field } from '../ui';
import { codecSourcesOf, parseCodecText, toBase64Url } from './codec-project.mjs';

type BitNode = { label: string; path: string; kind: string; type: string; role: string; bit: number; bits: number; value?: string; note?: string; children?: BitNode[]; more?: number };
type Span = { bit: number; bits: number; role: string; path: string };
type SchemaInfo = { id: string; short: string; name: string | null; version: number | null; source: string; aliases?: string[]; resolved?: string };
type Explained = {
  schema: SchemaInfo; header: { mode: 'id' | 'self' | 'none'; id: string | null; bytes: number }; bytes: number; totalBits: number; textBit: number;
  tree: BitNode; nodes: number; headerNode: BitNode | null; padding: BitNode | null; spans: Span[]; spansTotal: number; spansTruncated: boolean;
  costs: { path: string; bits: number; count: number }[]; json: string | null; jsonTooLarge: boolean;
  sizes: { bytes: number; gzip: number; json: number; jsonGz: number }; schemaTree: SchemaRecord | null; schemaTreeTooLarge: boolean;
  hex: string; hexBytes: number; hexTruncated: boolean; solidity: { available: boolean; reason?: string }; check: string | null;
  source?: { label: string; format: string; ops?: number };
};
type SchemaRecord = { kind: string; [key: string]: unknown };
type Reencoded = { ok: true; base64: string; base64url: string; bytes: number; explain: Explained } | { ok: false; error: string; message?: string; path: string | null };
type Solidity = { ok: boolean; code?: string; reason?: string };
type Request = { text: string; schema?: string } | { objectId: string; schema?: string } | { projectId: string; file: string; record?: string; schema?: string };
export type CodecSource = { text: string; label?: string } | { projectId: string; file: string; record?: string; label?: string } | { objectId: string; label?: string };
export type CodecApply = (result: { base64url: string; bytes: number }) => void;

const ROLES = ['value', 'overhead', 'text', 'header', 'padding'] as const;
const ROLE_TITLES: Record<string, string> = { value: 'a field’s own bits', overhead: 'lengths, presence bits, tags, table indices', text: 'string bytes (the text section)', header: 'header: 0xB1 + schema id, or the carried schema', padding: 'zero padding to a byte' };
const SAMPLES: [string, string][] = [['sfx', 'Sound effects settings'], ['recipe', 'Music recipe'], ['song', 'Song'], ['voxels', 'Voxels (KC1:)'], ['ops', 'Builder op list'], ['level', 'Level'], ['tile', 'Fixed-layout tile (Solidity)']];
const bytesText = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} MB` : n >= 10_000 ? `${(n / 1000).toFixed(1)} KB` : `${n.toLocaleString()} B`;
const pct = (a: number, b: number) => b ? `${Math.round(a / b * 100)}%` : '—';
const schemaTitle = (s: SchemaInfo) => s.name ? `${s.name}@${s.version}` : `schema ${s.short}`;
const fromBase64 = (text: string) => { const raw = atob(text); const out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; };
const errorMessage = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Error invoking remote method 'keel:request': (TRPCClientError: |Error: )?/, '');

/** A node's ranges, its descendants' too (a string lights its length and its bytes in the text section). */
function rangesOf(node: BitNode): [number, number][] {
  const out: [number, number][] = node.bits > 0 ? [[node.bit, node.bits]] : [];
  const end = node.bit + node.bits;
  // (Descendants outside the node's own range: its strings' bytes in the text section.)
  const walk = (n: BitNode) => { for (const c of n.children ?? []) { if (out.length >= 4000) return; if ((c.bit < node.bit || c.bit >= end) && c.bits > 0) out.push([c.bit, c.bits]); else walk(c); } };
  walk(node);
  return out;
}
/** The nodes covering a bit, outermost first (explain.ts nodeAtBit, over the compacted tree). */
function nodesAtBit(x: Explained, bit: number): string[] {
  if (x.headerNode && bit < x.headerNode.bit + x.headerNode.bits) return ['#header'];
  if (x.padding && bit >= x.padding.bit && bit < x.padding.bit + x.padding.bits) return ['#padding'];
  if (bit >= x.textBit) {
    const trail: string[] = [];
    const find = (n: BitNode, path: string[]): boolean => {
      if (n.kind === 'meta' && n.label === 'text' && bit >= n.bit && bit < n.bit + n.bits) { trail.push(...path, n.path); return true; }
      return (n.children ?? []).some((c) => find(c, [...path, n.path]));
    };
    find(x.tree, []);
    return trail;
  }
  const out: string[] = [];
  let n: BitNode | undefined = x.tree;
  while (n) { out.push(n.path); n = n.children?.find((c) => bit >= c.bit && bit < c.bit + c.bits); }
  return out;
}
/** The deepest node path matching a codec error's field path (or its nearest ancestor in the tree). */
function nodeForPath(tree: BitNode, path: string | null): { path: string; ancestors: string[] } | null {
  if (path === null) return null;
  const parents = new Map<string, string[]>();
  const walk = (n: BitNode, trail: string[]) => { parents.set(n.path, trail); for (const c of n.children ?? []) walk(c, [...trail, n.path]); };
  walk(tree, []);
  let p = path;
  for (;;) {
    if (parents.has(p)) return { path: p, ancestors: parents.get(p)! };
    if (!p) return null;
    const cut = Math.max(p.lastIndexOf('.'), p.lastIndexOf('['));
    p = cut > 0 ? p.slice(0, cut) : '';
  }
}

// ---------------------------------------------------------------- the overlay: openCodecInspector from any tab

type Opened = { seq: number; source: CodecSource; onApply?: CodecApply } | null;
let opened: Opened = null;
let hosts: number[] = [];
let hostSeq = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let snapshot: { opened: Opened; top: number } = { opened, top: 0 };
const read = () => snapshot;
const publish = () => { snapshot = { opened, top: hosts.at(-1) ?? 0 }; emit(); };

/** Open the codec inspector over the current page (a CodecInspectorHost must be mounted there). */
export function openCodecInspector(source: CodecSource, options?: { onApply?: CodecApply }): void {
  opened = { seq: (opened?.seq ?? 0) + 1, source, ...(options?.onApply ? { onApply: options.onApply } : {}) };
  publish();
}
/** Close the overlay (Escape and the close button do this too). */
export function closeCodecInspector(): void { opened = null; publish(); }

/** The overlay dialog openCodecInspector opens. Mount one per page; the most recently mounted host shows it. */
export function CodecInspectorHost({ project }: { project?: Project }) {
  const [id] = useState(() => ++hostSeq);
  useEffect(() => { hosts = [...hosts, id]; publish(); return () => { hosts = hosts.filter((item) => item !== id); publish(); }; }, [id]);
  const state = useSyncExternalStore(subscribe, read, read);
  const current = state.opened;
  useEffect(() => {
    if (!current || state.top !== id) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') closeCodecInspector(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [current, state.top, id]);
  if (!current || state.top !== id) return null;
  const apply = current.onApply ? (result: { base64url: string; bytes: number }) => { current.onApply!(result); closeCodecInspector(); } : undefined;
  return <div className="codec-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCodecInspector(); }}>
    <div className="codec-dialog" role="dialog" aria-modal="true" aria-label="Codec inspector">
      <header className="codec-dialog-head"><div><div className="eyebrow">CODEC INSPECTOR</div><strong>{current.source.label ?? 'A codec document'}</strong></div><button className="codec-close" aria-label="Close codec inspector" onClick={closeCodecInspector}>×</button></header>
      <CodecInspectorPanel key={current.seq} project={project} initial={current.source} onApply={apply} />
    </div>
  </div>;
}

// ---------------------------------------------------------------- the panel

/** The inspector: inputs (paste, Files, a project's records, samples) and the explained document. */
export function CodecInspectorPanel({ project, initial, onApply }: { project?: Project; initial?: CodecSource; onApply?: CodecApply }) {
  const status = useQuery<{ available: boolean; reason?: string }>({ queryKey: ['game-status'], queryFn: () => api('gameStatus') });
  const workspace = useQuery<Workspace>({ queryKey: ['workspace'], queryFn: () => api('workspace'), structuralSharing: false });
  const [paste, setPaste] = useState(initial && 'text' in initial ? initial.text : '');
  const [schemaKey, setSchemaKey] = useState('');
  const [objectId, setObjectId] = useState(initial && 'objectId' in initial ? initial.objectId : '');
  const [sample, setSample] = useState('sfx');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Explained | null>(null);
  const [label, setLabel] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [editError, setEditError] = useState<{ message: string; path: string | null } | null>(null);
  const [reencoded, setReencoded] = useState<{ base64url: string; bytes: number; was: number; same: boolean } | null>(null);
  const [solidity, setSolidity] = useState<Solidity | null>(null);
  const [needsSchema, setNeedsSchema] = useState(false);
  // (Without a project of its own -- the Game engine page -- any saved project holding codec records can be picked.)
  const [pickedProject, setPickedProject] = useState('');
  const withRecords = useMemo(() => project ? [] : (workspace.data?.state.projects ?? []).map((p) => ({ project: p, records: codecSourcesOf(p) })).filter((item) => item.records.length), [project, workspace.data]);
  const source = project ?? withRecords.find((item) => item.project.id === pickedProject)?.project;
  const records = useMemo(() => project ? codecSourcesOf(project) : withRecords.find((item) => item.project.id === pickedProject)?.records ?? [], [project?.files, withRecords, pickedProject]);
  const objects = workspace.data?.state.objects ?? [];
  const schemas = useQuery<{ schemas: SchemaInfo[] }>({ queryKey: ['game-codec-schemas'], queryFn: () => api('gameCodecSchemas'), enabled: !!status.data?.available && needsSchema });
  const last = useRef<{ request: Request; label: string } | null>(null);

  async function run(work: string, fn: () => Promise<void>) {
    setBusy(work); setError('');
    try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  function show(x: Explained, name: string) {
    setResult(x); setLabel(name); setJsonText(x.json ?? ''); setEditError(null); setSolidity(null);
  }
  const inspect = (request: Request, name: string) => run('Reading the document…', async () => {
    last.current = { request, label: name };
    try {
      const x: Explained = await api('gameCodecExplain', request);
      setReencoded(null); setNeedsSchema(false); show(x, name);
    } catch (e) {
      if (/bare body|no codec header/i.test(errorMessage(e))) setNeedsSchema(true);
      throw e;
    }
  });
  const withSchema = (request: Request): Request => schemaKey.trim() ? { ...request, schema: schemaKey.trim() } : request;
  function inspectPaste(text = paste, name = 'Pasted') {
    try { parseCodecText(text); } catch (e) { setError(errorMessage(e)); return; }
    void inspect(withSchema({ text }), name);
  }
  function inspectSource(source: CodecSource) {
    if ('text' in source) { setPaste(source.text); inspectPaste(source.text, source.label ?? 'Pasted'); }
    else if ('objectId' in source) { setObjectId(source.objectId); void inspect(withSchema({ objectId: source.objectId }), source.label ?? objects.find((o) => o.id === source.objectId)?.name ?? 'File'); }
    else void inspect(withSchema({ projectId: source.projectId, file: source.file, ...(source.record ? { record: source.record } : {}) }), source.label ?? `${source.file}${source.record ? ` · ${source.record}` : ''}`);
  }
  useEffect(() => { if (initial && status.data?.available) inspectSource(initial); }, [status.data?.available]);

  const trySample = () => run('Making a sample…', async () => {
    const s = await api('gameCodecSample', { kind: sample });
    const text = s.text ?? s.bytes;
    setPaste(text);
    last.current = { request: { text }, label: s.label };
    const x: Explained = await api('gameCodecExplain', { text });
    setReencoded(null); setNeedsSchema(false); show(x, s.label);
  });
  const choose = () => run('Importing…', async () => {
    const current = queryClient.getQueryData<Workspace>(['workspace']) ?? workspace.data;
    if (!current) throw Error('The workspace is still loading.');
    const next = await api('importObject', { revision: current.revision });
    if (!next) return;
    queryClient.setQueryData(['workspace'], next);
    const object = next.state.objects.at(-1);
    setObjectId(object.id);
    last.current = { request: withSchema({ objectId: object.id }), label: object.name };
    const x: Explained = await api('gameCodecExplain', last.current.request);
    setReencoded(null); show(x, object.name);
  });
  const reencode = () => { if (!result) return; void run('Re-encoding…', async () => {
    const r: Reencoded = await api('gameCodecReencode', { schema: result.schema.id, json: jsonText, header: result.header.mode });
    if (!r.ok) { setEditError({ message: r.error, path: r.path }); return; }
    const was = reencoded?.was ?? result.bytes;
    const same = r.explain.hex === result.hex && r.bytes === result.bytes;
    show(r.explain, `${label.replace(/ · re-encoded$/, '')} · re-encoded`);
    setReencoded({ base64url: r.base64url, bytes: r.bytes, was, same });
  }); };
  const generate = () => { if (!result) return; void run('Generating…', async () => { setSolidity(await api('gameCodecSolidity', { schema: result.schema.id })); }); };

  if (status.data && !status.data.available) return <div className="notice game-unavailable"><strong>Game engine not connected</strong><p>{status.data.reason}</p></div>;
  const errorNode = result && editError ? nodeForPath(result.tree, editError.path) : null;
  return <div className="codec-panel" aria-busy={!!busy}>
    <div className="codec-inputs">
      <div className="codec-paste">
        <Field label="Paste a document"><textarea aria-label="Codec text" rows={3} spellCheck={false} value={paste} placeholder="KC1:…, 0x hex, or base64 of a codec document" onChange={(event) => setPaste(event.target.value)} /></Field>
        <div className="inline-actions">
          <button className="primary" disabled={!paste.trim() || !!busy} onClick={() => inspectPaste()}>Inspect</button>
          <input aria-label="Schema for a bare body" className="codec-schema-key" list="codec-schema-keys" value={schemaKey} placeholder={needsSchema ? 'schema: name@version or id' : 'schema (bare bodies only)'} onChange={(event) => setSchemaKey(event.target.value)} />
          <datalist id="codec-schema-keys">{(schemas.data?.schemas ?? []).map((s) => <option key={s.id} value={s.name ? `${s.name}@${s.version}` : s.id} />)}</datalist>
          {needsSchema && last.current && <button disabled={!schemaKey.trim() || !!busy} onClick={() => void inspect({ ...last.current!.request, schema: schemaKey.trim() } as Request, last.current!.label)}>Read with this schema</button>}
        </div>
      </div>
      <div className="codec-pickers">
        <div className="builder-row"><Field label="From Files"><select aria-label="Codec file" value={objectId} onChange={(event) => setObjectId(event.target.value)}><option value="">Choose a file…</option>{objects.map((item) => <option key={item.id} value={item.id}>{item.name} · {bytesText(item.byteLength)}</option>)}</select></Field>
          <button disabled={!objectId || !!busy} onClick={() => void inspect(withSchema({ objectId }), objects.find((o) => o.id === objectId)?.name ?? 'File')}>Inspect file</button></div>
        <div className="inline-actions"><button disabled={!!busy} onClick={choose}>Choose a file…</button>
          <select aria-label="Codec sample" value={sample} onChange={(event) => setSample(event.target.value)}>{SAMPLES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><button disabled={!!busy} onClick={trySample}>Try a sample</button></div>
      </div>
    </div>
    {!project && withRecords.length > 0 && <div className="codec-records"><span className="codec-records-title">From a project</span><select aria-label="Codec project" value={pickedProject} onChange={(event) => setPickedProject(event.target.value)}><option value="">Choose a project…</option>{withRecords.map((item) => <option key={item.project.id} value={item.project.id}>{item.project.title} · {item.records.length} {item.records.length === 1 ? 'record' : 'records'}</option>)}</select></div>}
    {source && <div className="codec-records"><span className="codec-records-title">{project ? 'In this project' : source.title}</span>{records.length ? records.map((r) => <button key={`${r.file}:${r.record}`} className="codec-record" disabled={!!busy} onClick={() => void inspect(withSchema({ projectId: source.id, file: r.file, record: r.record }), r.label)}><Badge>{r.kind}</Badge>{r.label}</button>) : <small>No codec records in this project’s files yet (sound/sound.json, KC1: voxels in pack files, builds/*.build.json).</small>}</div>}
    {busy && <p className="game-hint" role="status">{busy}</p>}
    {error && <p role="alert" className="notice error codec-error">{error}</p>}
    {!result && !busy && !error && <Empty title="Nothing inspected yet">Paste KC1: voxel text, hex or base64, pick a file, {project ? 'choose one of this project’s records, ' : ''}or try a sample.</Empty>}
    {result && <Inspection x={result} label={label} jsonText={jsonText} setJsonText={(value) => { setJsonText(value); setEditError(null); }} editError={editError} errorNode={errorNode} reencode={reencode} reset={() => { setJsonText(result.json ?? ''); setEditError(null); }} reencoded={reencoded} onApply={onApply} solidity={solidity} generate={generate} busy={!!busy} />}
  </div>;
}

function Inspection({ x, label, jsonText, setJsonText, editError, errorNode, reencode, reset, reencoded, onApply, solidity, generate, busy }: {
  x: Explained; label: string; jsonText: string; setJsonText: (value: string) => void; editError: { message: string; path: string | null } | null; errorNode: { path: string; ancestors: string[] } | null;
  reencode: () => void; reset: () => void; reencoded: { base64url: string; bytes: number; was: number; same: boolean } | null; onApply?: CodecApply; solidity: Solidity | null; generate: () => void; busy: boolean;
}) {
  const [lit, setLit] = useState<{ ranges: [number, number][]; path: string } | null>(null);
  const [atBit, setAtBit] = useState<number | null>(null);
  // (A new document: nothing hovered in it yet.)
  useEffect(() => { setLit(null); setAtBit(null); }, [x]);
  const hot = useMemo(() => new Set(atBit === null ? [] : nodesAtBit(x, atBit)), [x, atBit]);
  const deepest = useMemo(() => atBit === null ? '' : nodesAtBit(x, atBit).at(-1) ?? '', [x, atBit]);
  const s = x.sizes;
  const resolved = x.schema.resolved === 'document' ? 'carried in the document (header "self")' : x.schema.resolved === 'given' ? `the schema you gave (${x.schema.source})` : x.schema.source === 'engine' ? 'the registry: an engine schema' : `the registry: declared by ${x.schema.source}`;
  return <div className="codec-result">
    <div className="codec-schema-head">
      <div><div className="eyebrow">{label.toUpperCase()}</div><h3>{schemaTitle(x.schema)}</h3><code title={x.schema.id}>{x.schema.short}</code> <small>{x.schema.id}</small></div>
      <div className="codec-badges"><Badge>header {x.header.mode === 'id' ? '"id" · 0xB1' : x.header.mode === 'self' ? '"self" · 0xB2' : '"none" · bare body'}</Badge><Badge>{x.schema.source}</Badge></div>
    </div>
    <p className="game-hint">Resolved from {resolved}. {x.header.bytes ? `${x.header.bytes} bytes of header, ` : ''}{x.totalBits.toLocaleString()} bits; the text section starts at bit {x.textBit.toLocaleString()}.{x.source?.ops !== undefined ? ` ${x.source.ops} ops, packed as the builder stores them.` : ''}</p>
    {x.check && <p className="notice error">This document doesn’t read cleanly: {x.check}</p>}
    <div className="measurement-grid codec-sizes">
      <div><span>CODEC</span><strong>{bytesText(s.bytes)}</strong><small>{pct(s.bytes, s.json)} of its JSON</small></div>
      <div><span>CODEC + GZIP</span><strong>{bytesText(s.gzip)}</strong><small>level 9, as KEEL stores each leaf</small></div>
      <div><span>JSON</span><strong>{bytesText(s.json)}</strong><small>the JSON view, UTF-8</small></div>
      <div><span>JSON + GZIP</span><strong>{bytesText(s.jsonGz)}</strong><small>codec+gz is {pct(s.gzip, s.jsonGz)} of it</small></div>
    </div>
    <div className="codec-legend">{ROLES.map((role) => <span key={role} title={ROLE_TITLES[role]}><i className={`codec-swatch role-${role}`} />{role}</span>)}<small>{lit ? `${lit.path || '(root)'} · ${lit.ranges.reduce((n, r) => n + r[1], 0).toLocaleString()} bits` : atBit !== null ? `bit ${atBit.toLocaleString()} · ${deepest || '(root)'}` : 'Hover a field or a byte.'}</small></div>
    <div className="codec-split">
      <section className="codec-tree" aria-label="Value tree" onMouseLeave={() => setLit(null)}>
        <div className="codec-tree-head"><span>Field</span><span>Type</span><span>Value</span><span>Bits</span></div>
        {x.headerNode && <TreeRow node={x.headerNode} depth={0} hot={hot} deepest={deepest} setLit={setLit} errorNode={null} error={null} />}
        <TreeRow node={x.tree} depth={0} openDepth={x.nodes <= 400 ? 64 : 2} hot={hot} deepest={deepest} setLit={setLit} errorNode={errorNode} error={editError} />
        {x.padding && <TreeRow node={x.padding} depth={0} hot={hot} deepest={deepest} setLit={setLit} errorNode={null} error={null} />}
        <p className="game-hint codec-tree-foot">{x.nodes.toLocaleString()} nodes{x.spansTruncated ? ` · the hex view paints the first ${bytesText(x.hexBytes)}` : ''}.</p>
      </section>
      <Hex x={x} lit={lit} setAtBit={setAtBit} />
    </div>
    <Costs x={x} />
    <section className="codec-json">
      <div className="section-line"><h4>JSON view</h4><span>lossless: edit it and re-encode to canonical bytes</span></div>
      {x.json === null ? <p className="notice">{x.jsonTooLarge ? 'The JSON view is over 500 KB: too large to edit here.' : 'This document has no JSON view.'}</p> : <>
        <textarea aria-label="JSON view" className="builder-ops codec-json-edit" rows={Math.min(22, Math.max(6, jsonText.split('\n').length))} spellCheck={false} value={jsonText} onChange={(event) => setJsonText(event.target.value)} />
        {editError && <p role="alert" className="notice error codec-edit-error"><strong>{editError.path ?? 'JSON'}</strong> {editError.message}{errorNode && editError.path !== null && errorNode.path !== editError.path ? ` (in ${errorNode.path || 'the root'})` : ''}</p>}
        <div className="inline-actions"><button className="primary" disabled={busy || jsonText === x.json} onClick={reencode}>Re-encode</button><button disabled={busy || jsonText === x.json} onClick={reset}>Reset</button><small className="game-hint">Same header as the original ({x.header.mode}); nothing is saved from here.</small></div>
      </>}
      {reencoded && <div className="codec-reencoded" role="status"><strong>Re-encoded · {bytesText(reencoded.bytes)}</strong><span>{reencoded.bytes === reencoded.was ? 'the same size' : `${reencoded.bytes > reencoded.was ? '+' : ''}${(reencoded.bytes - reencoded.was).toLocaleString()} B from ${bytesText(reencoded.was)}`} · canonical</span>
        <input aria-label="Re-encoded base64url" readOnly value={reencoded.base64url} onFocus={(event) => event.currentTarget.select()} />
        {onApply && <button className="primary" onClick={() => onApply({ base64url: reencoded.base64url, bytes: reencoded.bytes })}>Use these bytes</button>}</div>}
    </section>
    {x.schemaTree && <details className="builder-section codec-schema-section"><summary>Schema as data · {schemaTitle(x.schema)}</summary><SchemaNode node={x.schemaTree} depth={0} /></details>}
    {x.schemaTreeTooLarge && <p className="game-hint">The schema’s tree is too large to show.</p>}
    <section className="codec-solidity">
      <div className="section-line"><h4>Solidity decoder</h4><span>{x.solidity.available ? 'fixed layout: every field at a known bit' : 'not a fixed layout'}</span></div>
      <div className="inline-actions"><button disabled={busy} onClick={generate}>Generate Solidity decoder</button><small className="game-hint">Read-only source: nothing is compiled or deployed.</small></div>
      {solidity && (solidity.ok ? <pre className="builder-code codec-code" aria-label="Solidity decoder">{solidity.code}</pre> : <p className="notice codec-refusal" role="status">The decoder generator refuses this schema: {solidity.reason}</p>)}
    </section>
  </div>;
}

const TreeRow = memo(function TreeRow({ node, depth, openDepth = 2, hot, deepest, setLit, errorNode, error }: { node: BitNode; depth: number; openDepth?: number; hot: Set<string>; deepest: string; setLit: (value: { ranges: [number, number][]; path: string } | null) => void; errorNode: { path: string; ancestors: string[] } | null; error: { message: string; path: string | null } | null }) {
  const kids = node.children ?? [];
  const forced = !!errorNode && (errorNode.ancestors.includes(node.path) && node.path !== errorNode.path);
  const [open, setOpen] = useState(depth < openDepth);
  const shown = open || forced;
  const isError = !!errorNode && errorNode.path === node.path && node.kind !== 'meta';
  return <>
    <div className={`codec-row role-row-${node.role}${hot.has(node.path) ? ' hl' : ''}${deepest === node.path ? ' hl-deep' : ''}${isError ? ' codec-row-error' : ''}`} data-path={node.path} onMouseEnter={() => setLit({ ranges: rangesOf(node), path: node.path })}>
      <span className="codec-label" style={{ paddingLeft: depth * 12 }}>{kids.length ? <button className="codec-toggle" aria-label={`${shown ? 'Collapse' : 'Expand'} ${node.label || 'root'}`} aria-expanded={shown} onClick={() => setOpen(!shown)}>{shown ? '▾' : '▸'}</button> : <i className={`codec-swatch role-${node.role}`} />}{node.label || (node.kind === 'named' ? node.type : '(root)')}</span>
      <span className="codec-type" title={node.type}>{node.type}</span>
      <span className="codec-value" title={node.note ? `${node.value ?? ''} ${node.note}` : node.value}>{node.value ?? (node.note ? <em>{node.note}</em> : '')}</span>
      <span className="codec-bits">{node.bits.toLocaleString()}</span>
    </div>
    {isError && error && <div className="codec-field-error" role="alert" style={{ marginLeft: depth * 12 + 16 }}>{error.path}: {error.message}</div>}
    {shown && kids.map((child, index) => <TreeRow key={`${child.path}:${index}`} node={child} depth={depth + 1} openDepth={openDepth} hot={hot} deepest={deepest} setLit={setLit} errorNode={errorNode} error={error} />)}
  </>;
});

/** The bytes painted by role, per bit: each byte's background is its bits' roles, left to right. */
function Hex({ x, lit, setAtBit }: { x: Explained; lit: { ranges: [number, number][] } | null; setAtBit: (bit: number | null) => void }) {
  const bytes = useMemo(() => fromBase64(x.hex), [x.hex]);
  const paint = useMemo(() => {
    const segs: { role: string; from: number; to: number }[][] = Array.from({ length: bytes.length }, () => []);
    for (const s of x.spans) {
      const end = Math.min(s.bit + s.bits, bytes.length * 8);
      for (let b = Math.floor(s.bit / 8); b * 8 < end; b++) segs[b]!.push({ role: s.role, from: Math.max(s.bit, b * 8) - b * 8, to: Math.min(end, b * 8 + 8) - b * 8 });
    }
    return segs.map((list) => {
      if (!list.length) return { className: 'role-none', style: undefined as React.CSSProperties | undefined };
      if (list.every((seg) => seg.role === list[0]!.role)) return { className: `role-${list[0]!.role}`, style: undefined };
      const stops = list.map((seg) => `var(--codec-${seg.role}) ${seg.from * 12.5}% ${seg.to * 12.5}%`).join(', ');
      return { className: 'role-mixed', style: { background: `linear-gradient(90deg, ${stops})` } };
    });
  }, [x.spans, bytes]);
  const mask = useMemo(() => {
    const m = new Uint8Array(bytes.length);
    for (const [bit, bits] of lit?.ranges ?? []) for (let b = Math.floor(bit / 8); b * 8 < bit + bits && b < m.length; b++) m[b] = 1;
    return m;
  }, [lit, bytes.length]);
  const rows = Math.ceil(bytes.length / 16);
  return <section className="codec-hex" aria-label="Hex view" onMouseLeave={() => setAtBit(null)} onMouseOver={(event) => { const i = (event.target as HTMLElement).dataset?.i; if (i !== undefined) setAtBit(Number(i) * 8); }}>
    {Array.from({ length: rows }, (_, r) => <HexRow key={r} row={r} bytes={bytes} paint={paint} mark={Array.from(mask.subarray(r * 16, r * 16 + 16)).join('')} />)}
    {x.hexTruncated && <p className="game-hint">The first {bytesText(x.hexBytes)} of {bytesText(x.bytes)} are shown.</p>}
  </section>;
}
const HexRow = memo(function HexRow({ row, bytes, paint, mark }: { row: number; bytes: Uint8Array; paint: { className: string; style?: React.CSSProperties }[]; mark: string }) {
  const cells = [];
  for (let k = 0; k < 16 && row * 16 + k < bytes.length; k++) {
    const i = row * 16 + k;
    cells.push(<span key={k} data-i={i} className={`codec-byte ${paint[i]!.className}${mark[k] === '1' ? ' hl' : ''}`} style={paint[i]!.style} title={`byte ${i} · bits ${i * 8}–${i * 8 + 7}`}>{bytes[i]!.toString(16).padStart(2, '0')}</span>);
  }
  return <div className="codec-hex-row"><span className="codec-offset">{(row * 16).toString(16).padStart(6, '0')}</span>{cells}</div>;
});

function Costs({ x }: { x: Explained }) {
  const max = Math.max(1, ...x.costs.map((c) => c.bits));
  return <section className="codec-costs"><div className="section-line"><h4>What’s big</h4><span>bits per field, array items folded</span></div>
    {x.costs.map((c) => <div key={c.path} className="codec-cost"><span className="codec-cost-path" title={c.path}>{c.path || '(root)'}</span><span className="codec-cost-bar"><i style={{ width: `${c.bits / max * 100}%` }} /></span><span className="codec-cost-bits">{c.bits.toLocaleString()} b{c.count > 1 ? ` · ×${c.count}` : ''}</span><small>{pct(c.bits, x.totalBits)}</small></div>)}
  </section>;
}

const SCHEMA_CHILDREN = ['of', 'key', 'value', 'fields', 'variants', 'items', 'ext'];
function SchemaNode({ node, depth, name }: { node: SchemaRecord; depth: number; name?: string }) {
  const params = Object.entries(node).filter(([key]) => key !== 'kind' && !SCHEMA_CHILDREN.includes(key) && !(key === 'doc' && !node[key])).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  const kids: [string, SchemaRecord][] = [];
  for (const key of SCHEMA_CHILDREN) {
    const v = node[key];
    if (key === 'value' && node.kind !== 'map') continue;
    if (Array.isArray(v)) v.flat().forEach((f: any, i: number) => { if (f && typeof f === 'object') kids.push(f.name !== undefined && f.type ? [String(f.name), f.type] : [`${key}[${i}]`, f]); });
    else if (v && typeof v === 'object') kids.push([key, v as SchemaRecord]);
  }
  const head = <><strong>{name ?? 'root'}</strong> <code>{node.kind}</code>{params.length ? <small> {params.join(' · ').slice(0, 240)}</small> : null}</>;
  if (!kids.length) return <div className="codec-schema-leaf" style={{ paddingLeft: depth * 12 }}>{head}</div>;
  return <details className="codec-schema-node" open={depth < 2} style={{ paddingLeft: depth ? 12 : 0 }}><summary>{head}</summary>{kids.map(([label, child], i) => <SchemaNode key={`${label}:${i}`} node={child} depth={depth + 1} name={label} />)}</details>;
}

// ---------------------------------------------------------------- the Game engine page's section

/** Every schema the inspector's registry holds, and what the workspace's manifests declared. */
export function CodecSchemasList() {
  const schemas = useQuery<{ schemas: SchemaInfo[]; modules: { id: string; version: string; schemas: string[] }[]; problems: { module: string; id: string; detail: string }[]; pending: { module: string; id: string }[] }>({ queryKey: ['game-codec-schemas'], queryFn: () => api('gameCodecSchemas') });
  const list = schemas.data?.schemas ?? [];
  return <details className="builder-section codec-schemas"><summary>Registered schemas · {schemas.data ? list.length : '…'}</summary>
    {schemas.error && <p role="alert" className="notice error">{errorMessage(schemas.error)}</p>}
    {schemas.data && <>
      <p className="builder-hint">The engine’s own schemas, the level and builder formats, and every schema a workspace module’s manifest declares ({schemas.data.modules.map((m) => `${m.id}: ${m.schemas.length}`).join(', ') || 'none'}). Documents naming any of them open here.</p>
      <div className="game-table-wrap"><table className="game-table"><thead><tr><th>Schema</th><th>Short id</th><th>From</th></tr></thead><tbody>{list.map((s) => <tr key={s.id}><td><strong>{schemaTitle(s)}</strong></td><td><code>{s.short}</code></td><td><Badge>{s.source}</Badge></td></tr>)}</tbody></table></div>
      {schemas.data.problems.map((p, i) => <p key={i} className="notice error"><strong>{p.module}</strong>{p.id ? ` · ${p.id}` : ''}: {p.detail}</p>)}
      {schemas.data.pending.map((p) => <p key={`${p.module}:${p.id}`} className="builder-hint">{p.module} declares {p.id} without its bytes: its module registers it when it runs.</p>)}
    </>}
  </details>;
}

/** The Game engine page's codec inspector card. */
export function CodecInspectorSection() {
  return <section className="setup-card codec-card"><h2>Codec inspector</h2><p>Every engine object, look, level, sound and voxel model is stored in KEEL’s bit codec. Paste one (KC1: text, hex, base64), pick a file, or try a sample: see each field’s bits, what’s big, edit the JSON view and re-encode it, or generate a Solidity decoder for a fixed layout.</p>
    <CodecInspectorPanel />
    <CodecSchemasList />
  </section>;
}

/** Bytes as the text openCodecInspector({ text }) takes (base64url). */
export const codecText = (bytes: Uint8Array) => toBase64Url(bytes);
