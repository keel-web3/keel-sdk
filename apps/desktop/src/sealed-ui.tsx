import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KEEL_SEALED_MEDIA_TYPE, KEEL_SEALED_MIN_PASSPHRASE_LENGTH, estimateKeelSealedSize, type KeelSealedHeader, type KeelSealedSlotKind } from '@keel/protocol';
import { createSealingPasskey, getPasskeySealingSupport, unlockSealedWithPasskey } from '@keel/sdk/sealed-passkey';
import { Badge, Empty, Field, fileSize } from './ui';
import { api, queryClient } from './client';
import type { Shared, Workspace } from './types';
import { checkRevealFile, readRevealFile } from './reveal-check.mjs';

// Seal & prove: proof-of-existence commitments and sealed (encrypted) files,
// using the protocol's sealed API in the main process. This page only holds
// secrets in memory while they are needed: passphrases and recovery keys are
// sent once per action and never saved; a recovery key is shown once.

type Sizes = { plaintext: number; compressed: number; header: number; sealed: number };
type Description = { objectId: string; name: string; mediaType: string; byteLength: number; compression: string; contentKeyFingerprint: string; hasCommitment: boolean; slots: { index: number; kind: KeelSealedSlotKind; rpId?: string; iterations?: number }[]; sizes: { header: number; payload: number; envelope: number }; header: KeelSealedHeader; keychain: boolean };
type Status = { keychain: boolean; maxPlaintextBytes: number };
type PasskeySupport = { supported: boolean; rpId?: string; reason?: string };
type Unlock = { kind: 'passphrase'; passphrase: string } | { kind: 'recovery'; key: string } | { kind: 'keychain' } | { kind: 'passkey'; prfOutput: string; credentialId?: string; slotIndex?: number };

const SEALED = KEEL_SEALED_MEDIA_TYPE;
// Sealed notes are often tiny; show exact bytes below 1 KB instead of "0.0 KB".
const size = (bytes: number) => bytes < 1000 ? `${bytes} bytes` : fileSize(bytes);
const b64u = (bytes: Uint8Array) => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, ''); };
const revision = () => queryClient.getQueryData<Workspace>(['workspace'])!.revision;
const accept = (next: Workspace) => queryClient.setQueryData(['workspace'], next);

/** Passkeys need a website origin; the editor's own keel-editor:// address isn't one, whatever the browser reports. */
async function editorPasskeySupport(): Promise<PasskeySupport> {
  const site = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!site) return { supported: false, reason: 'Passkeys belong to a website, and the editor runs from its own local address, so your passkey provider won’t give it one here. Use this computer’s keychain instead.' };
  const support = await getPasskeySealingSupport();
  if (support.supported && support.prf === 'yes') return { supported: true, rpId: location.hostname };
  return { supported: false, reason: support.reason ?? 'This browser can’t confirm that its passkeys can derive keys (WebAuthn PRF), so passkey sealing is off here.' };
}

async function newPasskeySlot(rpId: string) {
  const passkey = await createSealingPasskey({ rp: { name: 'KEEL editor', id: rpId }, user: { name: 'KEEL sealed content' } });
  return { credentialId: b64u(passkey.slot.credentialId), prfSalt: b64u(passkey.slot.prfSalt), prfOutput: b64u(passkey.slot.prfOutput), rpId, includeCredentialId: passkey.slot.includeCredentialId === true };
}

const slotName = (slot: Description['slots'][number]) => slot.kind === 'passphrase' ? 'Passphrase' : slot.kind === 'passkey-prf' ? `Passkey${slot.rpId ? ` · ${slot.rpId}` : ''}` : 'Recovery or keychain key';

export function SealAndProve({ state, action }: { state: Workspace['state']; action: Shared['action'] }) {
  const status = useQuery<Status>({ queryKey: ['sealed-status'], queryFn: () => api('sealedStatus') });
  const passkey = useQuery<PasskeySupport>({ queryKey: ['sealed-passkey-support'], queryFn: editorPasskeySupport });
  return <>
    <div className="page-heading compact"><div><h1>Seal &amp; prove.</h1><p>Prove you had something without showing it, or lock it so only you can open it. Sealed files are ordinary workspace files: attach them to projects and publish them like any other.</p></div></div>
    <div className="seal-columns">
      <ProveCard state={state} action={action} />
      <SealCard state={state} action={action} status={status.data} passkey={passkey.data} />
    </div>
    <CheckRevealCard state={state} action={action} />
    <SealedFiles state={state} action={action} status={status.data} passkey={passkey.data} />
  </>;
}

/* ------------------------------------------------------------------ proofs */

function ProveCard({ state, action }: { state: Workspace['state']; action: Shared['action'] }) {
  const [mode, setMode] = useState<'text' | 'file' | 'files'>('text');
  const [text, setText] = useState('');
  const [objectId, setObjectId] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [salted, setSalted] = useState(true);
  const [result, setResult] = useState<{ digest: string; label: string; reveal: unknown; salted: boolean }>();
  const [copied, setCopied] = useState(false);
  const files = state.objects.filter((item) => item.type !== SEALED);
  const ready = mode === 'text' ? text.length > 0 : mode === 'file' ? !!objectId : chosen.length >= 2;
  const reset = () => { setResult(undefined); setCopied(false); };
  const make = () => void action(async () => {
    if (mode === 'files') {
      const tree = await api('sealedMerkle', { objectIds: chosen });
      setResult({ digest: tree.root, label: `One root for ${tree.count} files. Each file is salted on its own and can be revealed by itself.`, reveal: tree.reveal, salted: true });
    } else {
      const proof = await api('sealedCommit', { source: mode === 'text' ? { kind: 'text', text } : { kind: 'object', objectId }, salted });
      setResult({ digest: proof.commitment.digest, label: mode === 'text' ? 'Fingerprint of your text.' : `Fingerprint of ${files.find((item) => item.id === objectId)?.name ?? 'the file'}.`, reveal: proof.reveal, salted });
    }
    setCopied(false);
  });
  return <section className="setup-card seal-card" aria-label="Prove you had it">
    <div className="eyebrow">PROOF OF EXISTENCE</div>
    <h2>Prove you had it.</h2>
    <p>Publish a 32-byte fingerprint now. Reveal what it stood for later, and anyone can check that it matches. Until then the fingerprint says nothing about the content.</p>
    <div className="segmented" role="group" aria-label="What to prove">{([['text', 'Text'], ['file', 'A file'], ['files', 'Several files']] as const).map(([id, label]) => <button type="button" key={id} className={mode === id ? 'selected' : ''} aria-pressed={mode === id} onClick={() => { setMode(id); reset(); }}>{label}</button>)}</div>
    {mode === 'text' && <Field label="Text"><textarea rows={4} value={text} placeholder="An idea, a prediction, a bid…" onChange={(event) => { setText(event.target.value); reset(); }} /></Field>}
    {mode === 'file' && <Field label="Workspace file"><select value={objectId} onChange={(event) => { setObjectId(event.target.value); reset(); }}><option value="">Choose a file…</option>{files.map((item) => <option key={item.id} value={item.id}>{item.name} · {size(item.byteLength)}</option>)}</select></Field>}
    {mode === 'files' && <fieldset className="file-picks"><legend className="small">Choose two or more files</legend>{files.map((item) => <label key={item.id} className="check-line"><input type="checkbox" checked={chosen.includes(item.id)} onChange={(event) => { setChosen(event.target.checked ? [...chosen, item.id] : chosen.filter((id) => id !== item.id)); reset(); }} /><span>{item.name} <small>{size(item.byteLength)}</small></span></label>)}{files.length < 2 && <p className="small">Import at least two files in Files first.</p>}</fieldset>}
    {mode !== 'files' && <label className="check-line"><input type="checkbox" checked={salted} onChange={(event) => { setSalted(event.target.checked); reset(); }} /><span>Add a secret salt (recommended)</span></label>}
    {mode !== 'files' && !salted && <p className="small warn">Without a salt anyone can test guesses against the fingerprint. Turn it off only for a public file, so ordinary SHA-256 tools give the same fingerprint.</p>}
    <button className="primary" disabled={!ready} onClick={make}>Make the proof</button>
    {result && <div className="proof-result">
      <p className="small">{result.label}</p>
      <span className="field-caption">Publish this fingerprint (bytes32)</span>
      <code className="digest">{result.digest}</code>
      <div className="inline-actions">
        <button onClick={() => void action(async () => { await navigator.clipboard.writeText(result.digest); setCopied(true); })}>{copied ? 'Copied' : 'Copy fingerprint'}</button>
        <button className="primary" onClick={() => void action(() => api('sealedSaveText', { purpose: 'reveal', suggestedName: `KEEL proof ${result.digest.slice(2, 10)}.json`, text: JSON.stringify(result.reveal, null, 2) }))}>Save reveal file…</button>
      </div>
      <p className="small">The reveal file {result.salted ? 'holds the secret salt and ' : ''}says exactly what the fingerprint stands for. Keep it private until you reveal; without it you can’t prove what you committed to. It is not kept in this workspace.</p>
    </div>}
  </section>;
}

/* ------------------------------------------------------------------ checking a reveal */

type RevealSummary = ReturnType<typeof readRevealFile>;
type RevealResult = Awaited<ReturnType<typeof checkRevealFile>>;

/**
 * Checks a reveal file (from this editor, Studio, or anyone using the shared
 * format) with the protocol's verifier: optionally against a file and the
 * value that was published. Everything happens in this window.
 */
function CheckRevealCard({ state, action }: { state: Workspace['state']; action: Shared['action'] }) {
  const [revealText, setRevealText] = useState('');
  const [revealName, setRevealName] = useState('');
  const [summary, setSummary] = useState<RevealSummary>();
  const [problem, setProblem] = useState('');
  const [source, setSource] = useState<'workspace' | 'disk'>('workspace');
  const [objectId, setObjectId] = useState('');
  const [diskFile, setDiskFile] = useState<File>();
  const [published, setPublished] = useState('');
  const [result, setResult] = useState<RevealResult>();
  const files = state.objects.filter((item) => item.type !== SEALED);
  const chooseReveal = (file: File | undefined) => void action(async () => {
    setResult(undefined); setSummary(undefined); setProblem(''); setRevealText(''); setRevealName(file?.name ?? '');
    if (!file) return;
    const text = await file.text();
    try { setSummary(readRevealFile(text)); setRevealText(text); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
  });
  const check = () => void action(async () => {
    setResult(undefined);
    let bytes: Uint8Array | undefined;
    if (summary?.needsFile && source === 'workspace' && objectId) {
      const response = await fetch(`keel-asset://${objectId}/raw`);
      if (!response.ok) throw new Error('That workspace file can’t be read.');
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (summary?.needsFile && source === 'disk' && diskFile) bytes = new Uint8Array(await diskFile.arrayBuffer());
    try { setResult(await checkRevealFile({ revealText, ...(bytes ? { file: bytes } : {}), published })); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
  });
  return <section className="setup-card seal-card reveal-check" aria-label="Check a reveal file">
    <div className="eyebrow">CHECK A PROOF</div>
    <h2>Check a reveal file.</h2>
    <p>Confirm that a reveal file, from you, from Studio or from someone else, really proves what it says, and that it matches the fingerprint that was published.</p>
    <div className="form-grid">
      <Field label="Reveal file (.json)"><input type="file" accept=".json,application/json" onChange={(event) => chooseReveal(event.target.files?.[0])} /></Field>
      <Field label="Published fingerprint or root (optional)"><input value={published} placeholder="0x…" spellCheck={false} onChange={(event) => { setPublished(event.target.value); setResult(undefined); }} /></Field>
    </div>
    {problem && <p className="field-error" role="alert">{problem}</p>}
    {summary && <p className="small">{revealName}: {summary.kind === 'merkle' ? `a root over ${summary.count} files` : summary.needsFile ? `a proof of ${summary.fileName} (${size(summary.byteLength ?? 0)})` : 'a proof of a text'}, made {new Date(summary.createdAt).toLocaleString()}.{summary.upgraded ? ' Written by an earlier version of this editor; read the same way.' : ''}</p>}
    {summary?.needsFile && <>
      <div className="segmented" role="group" aria-label="Where the file is">{([['workspace', 'A workspace file'], ['disk', 'A file on this computer']] as const).map(([id, label]) => <button type="button" key={id} className={source === id ? 'selected' : ''} aria-pressed={source === id} onClick={() => { setSource(id); setResult(undefined); }}>{label}</button>)}</div>
      {source === 'workspace'
        ? <Field label={summary.kind === 'merkle' ? 'One of the proved files' : 'The proved file'}><select value={objectId} onChange={(event) => { setObjectId(event.target.value); setResult(undefined); }}><option value="">Choose a file…</option>{files.map((item) => <option key={item.id} value={item.id}>{item.name} · {size(item.byteLength)}</option>)}</select></Field>
        : <Field label={summary.kind === 'merkle' ? 'One of the proved files' : 'The proved file'}><input type="file" onChange={(event) => { setDiskFile(event.target.files?.[0]); setResult(undefined); }} /></Field>}
    </>}
    <button className="primary" disabled={!summary} onClick={check}>Check</button>
    {result && <div className={`notice ${result.valid && result.matchesPublished !== false ? '' : 'error'}`} role="status">
      <strong>{result.valid ? (result.matchesPublished === false ? 'The proof is valid, but for a different fingerprint.' : 'It checks out.') : 'It doesn’t check out.'}</strong>
      <p>{result.valid ? `${result.item ? `${result.item} matches` : 'The text matches'} the ${result.kind === 'merkle' ? 'root' : 'fingerprint'} ${result.published.slice(0, 10)}…${result.published.slice(-6)}.` : result.reason}{result.matchesPublished === true ? ' It is the value that was published.' : result.matchesPublished === false ? ` The published value you entered is not ${result.published.slice(0, 10)}….` : ' Enter the published value to also check that.'}</p>
      {result.text !== undefined && <details><summary>The revealed text</summary><pre>{result.text}</pre></details>}
    </div>}
  </section>;
}

/* ------------------------------------------------------------------ recovery key */

function RecoveryKeyConfirm({ recoveryKey, name, action, done }: { recoveryKey: string; name: string; action: Shared['action']; done: () => void }) {
  const [typed, setTyped] = useState('');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  return <div className="recovery-key-card" role="alertdialog" aria-labelledby="recovery-key-title">
    <h3 id="recovery-key-title">Save your recovery key now.</h3>
    <p className="small">It opens “{name}” anywhere. It is shown once and is not stored anywhere, not even in this workspace. If every way in is lost, nobody can open the file, including KEEL.</p>
    <code className="recovery-key">{recoveryKey}</code>
    <div className="inline-actions">
      <button onClick={() => void action(async () => { await navigator.clipboard.writeText(recoveryKey); setCopied(true); })}>{copied ? 'Copied' : 'Copy'}</button>
      <button onClick={() => void action(async () => { const result = await api('sealedSaveText', { purpose: 'recovery', suggestedName: `KEEL recovery key - ${name.replace(/\.sealed$/u, '')}.txt`, text: `KEEL recovery key\nOpens: ${name}\n\n${recoveryKey}\n\nKeep this offline. Anyone with this key can open the sealed file.\n` }); if (result) setSaved(true); })}>{saved ? 'Saved to a file' : 'Save to a file…'}</button>
    </div>
    <Field label="Type its last 4 characters to confirm you saved it"><input value={typed} autoComplete="off" spellCheck={false} onChange={(event) => setTyped(event.target.value)} /></Field>
    <button className="primary" disabled={typed.trim() !== recoveryKey.slice(-4)} onClick={done}>I saved it</button>
  </div>;
}

/* ------------------------------------------------------------------ sealing */

function SealCard({ state, action, status, passkey }: { state: Workspace['state']; action: Shared['action']; status?: Status; passkey?: PasskeySupport }) {
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const [text, setText] = useState('');
  const [objectId, setObjectId] = useState('');
  const [name, setName] = useState('');
  const [usePassphrase, setUsePassphrase] = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [useKeychain, setUseKeychain] = useState(true);
  const [usePasskey, setUsePasskey] = useState(false);
  const [pending, setPending] = useState<{ recoveryKey: string; name: string }>();
  const [summary, setSummary] = useState<{ name: string; sizes: Sizes; slots: Description['slots'] }>();
  const files = state.objects.filter((item) => item.type !== SEALED);
  const file = files.find((item) => item.id === objectId);
  const keychain = !!status?.keychain && useKeychain;
  const withPasskey = !!passkey?.supported && usePasskey;
  const plaintext = mode === 'text' ? new TextEncoder().encode(text).byteLength : file?.byteLength ?? 0;
  const kinds: KeelSealedSlotKind[] = [...(usePassphrase ? ['passphrase' as const] : []), ...(withPasskey ? ['passkey-prf' as const] : []), ...(keychain ? ['raw-key' as const] : []), 'raw-key'];
  let estimate: number | undefined;
  try { estimate = estimateKeelSealedSize(plaintext, { slots: kinds, mediaType: mode === 'text' ? 'text/plain;charset=utf-8' : 'application/octet-stream' }).sealed; } catch { estimate = undefined; }
  const tooBig = plaintext > (status?.maxPlaintextBytes ?? 16 * 1024 * 1024);
  const passphraseProblem = !usePassphrase ? '' : [...passphrase.normalize('NFC')].length < KEEL_SEALED_MIN_PASSPHRASE_LENGTH ? `Use at least ${KEEL_SEALED_MIN_PASSPHRASE_LENGTH} characters; four or more random words is much stronger.` : passphrase !== confirm ? 'The two passphrases don’t match yet.' : '';
  const ready = (mode === 'text' ? text.length > 0 : !!file) && !passphraseProblem && !tooBig;
  const seal = () => void action(async () => {
    const passkeySlot = withPasskey && passkey?.rpId ? await newPasskeySlot(passkey.rpId) : undefined;
    const result = await api('sealedSeal', { source: mode === 'text' ? { kind: 'text', text } : { kind: 'object', objectId }, ...(name.trim() ? { name: name.trim() } : mode === 'text' ? { name: 'Sealed note' } : {}), ...(usePassphrase ? { passphrase } : {}), keychain, ...(passkeySlot ? { passkey: passkeySlot } : {}), revision: revision() });
    accept(result.workspace);
    setPassphrase(''); setConfirm(''); setText(''); setName('');
    setPending({ recoveryKey: result.recoveryKey, name: result.name });
    setSummary({ name: result.name, sizes: result.sizes, slots: result.description.slots });
  });
  return <section className="setup-card seal-card" aria-label="Seal it">
    <div className="eyebrow">SEALED CONTENT</div>
    <h2>Seal it.</h2>
    <p>Compress and encrypt text or a file. Everyone can see that something sealed exists and how big it is; only someone holding one of its keys can read it. Keys never go on-chain.</p>
    {pending ? <RecoveryKeyConfirm recoveryKey={pending.recoveryKey} name={pending.name} action={action} done={() => setPending(undefined)} /> : <>
      <div className="segmented" role="group" aria-label="What to seal">{([['text', 'Text'], ['file', 'A file']] as const).map(([id, label]) => <button type="button" key={id} className={mode === id ? 'selected' : ''} aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}</div>
      {mode === 'text' ? <Field label="Text to seal"><textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} /></Field>
        : <Field label="Workspace file"><select value={objectId} onChange={(event) => setObjectId(event.target.value)}><option value="">Choose a file…</option>{files.map((item) => <option key={item.id} value={item.id}>{item.name} · {size(item.byteLength)}</option>)}</select></Field>}
      <Field label="Name of the sealed file"><input value={name} maxLength={200} placeholder={mode === 'file' ? file?.name ?? 'Same as the file' : 'Sealed note'} onChange={(event) => setName(event.target.value)} /></Field>
      <fieldset className="ways-in"><legend>Ways in</legend>
        <label className="check-line"><input type="checkbox" checked disabled /><span><strong>Recovery key</strong>, always included. Shown once for you to keep offline.</span></label>
        <label className="check-line"><input type="checkbox" checked={usePassphrase} onChange={(event) => setUsePassphrase(event.target.checked)} /><span><strong>Passphrase.</strong> Anyone holding the sealed bytes can guess passphrases offline, forever, so make it long.</span></label>
        {usePassphrase && <div className="form-grid"><Field label="Passphrase"><input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></Field><Field label="Type it again"><input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field></div>}
        {passphraseProblem && (passphrase || confirm) && <p className="field-error">{passphraseProblem}</p>}
        {passkey?.supported
          ? <label className="check-line"><input type="checkbox" checked={usePasskey} onChange={(event) => setUsePasskey(event.target.checked)} /><span><strong>Passkey.</strong> Opens it wherever your passkey syncs, with no secret to type.</span></label>
          : <p className="small"><strong>Passkey:</strong> {passkey?.reason ?? 'Checking…'}</p>}
        {status?.keychain
          ? <label className="check-line"><input type="checkbox" checked={useKeychain} onChange={(event) => setUseKeychain(event.target.checked)} /><span><strong>This computer’s keychain.</strong> Opens it here without typing anything. Your operating system protects the key and it never leaves this computer.</span></label>
          : <p className="small"><strong>This computer’s keychain</strong> isn’t available here, so that way in is off.</p>}
      </fieldset>
      <p className="small seal-estimate">{plaintext ? <>{size(plaintext)} to seal · at most {estimate ? size(estimate) : '…'} sealed before compression</> : 'Nothing chosen yet.'}{tooBig && ' · Sealed content is limited to 16 MB.'}</p>
      <button className="primary" disabled={!ready} onClick={seal}>Seal{withPasskey ? ' (asks for your passkey)' : ''}</button>
    </>}
    {summary && !pending && <div className="proof-result" aria-label="Sealed">
      <p><strong>{summary.name}</strong> is saved in Files and listed below.</p>
      <dl className="logical-facts seal-sizes"><dt>Original</dt><dd>{size(summary.sizes.plaintext)}</dd><dt>Compressed</dt><dd>{size(summary.sizes.compressed)}</dd><dt>Sealed</dt><dd>{size(summary.sizes.sealed)} (header {size(summary.sizes.header)})</dd><dt>Ways in</dt><dd>{summary.slots.map(slotName).join(' · ')}</dd></dl>
    </div>}
  </section>;
}

/* ------------------------------------------------------------------ sealed files */

function SealedFiles({ state, action, status, passkey }: { state: Workspace['state']; action: Shared['action']; status?: Status; passkey?: PasskeySupport }) {
  const sealed = state.objects.filter((item) => item.type === SEALED);
  const [openId, setOpenId] = useState<string>();
  return <section className="content-pad sealed-files" aria-label="Your sealed files">
    <div className="section-line"><h2>Your sealed files</h2><span>{sealed.length}</span></div>
    {sealed.map((object) => <SealedRow key={object.id} object={object} open={openId === object.id} toggle={() => setOpenId(openId === object.id ? undefined : object.id)} action={action} status={status} passkey={passkey} />)}
    {!sealed.length && <Empty title="Nothing sealed yet">Seal text or a file above. Sealed files appear here and in Files.</Empty>}
  </section>;
}

function SealedRow({ object, open, toggle, action, status, passkey }: { object: Workspace['state']['objects'][number]; open: boolean; toggle: () => void; action: Shared['action']; status?: Status; passkey?: PasskeySupport }) {
  const described = useQuery<Description>({ queryKey: ['sealed-describe', object.id], queryFn: () => api('sealedDescribe', object.id) });
  const d = described.data;
  return <article className="memory-card sealed-row">
    <div className="logical-heading">
      <div><h3>{object.name}</h3><small>{d ? `${d.mediaType} · ${size(d.byteLength)} inside · ${size(object.byteLength)} sealed${d.compression !== 'none' ? ' · compressed' : ''}` : described.error ? 'This file can’t be read as a sealed file.' : 'Reading…'}</small></div>
      <Badge tone="cool">Sealed</Badge>
    </div>
    {d && <div className="tag-line">{d.slots.map((slot) => <span key={slot.index} className="tag-chip">{slotName(slot)}</span>)}{d.keychain && <span className="tag-chip">This computer can open it</span>}</div>}
    <code className="address" title="Content address (SHA-256 of the sealed bytes)">{object.id}</code>
    <div className="inline-actions"><button onClick={toggle}>{open ? 'Close and forget' : 'Open…'}</button></div>
    {open && d && <OpenSealed key={object.id} object={object} description={d} action={action} status={status} passkey={passkey} />}
  </article>;
}

function OpenSealed({ object, description, action, status, passkey }: { object: Workspace['state']['objects'][number]; description: Description; action: Shared['action']; status?: Status; passkey?: PasskeySupport }) {
  const has = (kind: KeelSealedSlotKind) => description.slots.some((slot) => slot.kind === kind);
  const ways = [...(description.keychain ? ['keychain'] : []), ...(has('passphrase') ? ['passphrase'] : []), ...(has('raw-key') ? ['recovery'] : []), ...(has('passkey-prf') && passkey?.supported ? ['passkey'] : [])] as Unlock['kind'][];
  const labels: Record<Unlock['kind'], string> = { keychain: 'This computer', passphrase: 'Passphrase', recovery: 'Recovery key', passkey: 'Passkey' };
  const [way, setWay] = useState<Unlock['kind']>(ways[0] ?? 'recovery');
  const [secret, setSecret] = useState('');
  const [unlock, setUnlock] = useState<Unlock>();
  const [opened, setOpened] = useState<{ text?: string; mediaType: string; byteLength: number }>();
  const [addWay, setAddWay] = useState<'passphrase' | 'recovery' | 'keychain' | 'passkey'>('passphrase');
  const [next, setNext] = useState('');
  const [nextConfirm, setNextConfirm] = useState('');
  const [recovery, setRecovery] = useState<{ recoveryKey: string; name: string }>();
  const [added, setAdded] = useState('');
  const openIt = () => void action(async () => {
    let request: Unlock;
    if (way === 'passkey') {
      const result = await unlockSealedWithPasskey(description.header, passkey?.rpId ? { rpId: passkey.rpId } : {});
      request = { kind: 'passkey', prfOutput: b64u(result.prfOutput), credentialId: b64u(result.credentialId), slotIndex: result.slotIndex };
    } else request = way === 'keychain' ? { kind: 'keychain' } : way === 'passphrase' ? { kind: 'passphrase', passphrase: secret } : { kind: 'recovery', key: secret };
    const result = await api('sealedOpen', { objectId: object.id, unlock: request });
    setSecret(''); setUnlock(request); setOpened(result);
  });
  const addProblem = addWay === 'passphrase' ? ([...next.normalize('NFC')].length < KEEL_SEALED_MIN_PASSPHRASE_LENGTH ? `Use at least ${KEEL_SEALED_MIN_PASSPHRASE_LENGTH} characters.` : next !== nextConfirm ? 'The two passphrases don’t match yet.' : '') : '';
  const addIt = () => void action(async () => {
    if (!unlock) return;
    const slot = addWay === 'passphrase' ? { kind: 'passphrase', passphrase: next } : addWay === 'passkey' && passkey?.rpId ? { kind: 'passkey', ...(await newPasskeySlot(passkey.rpId)) } : { kind: addWay };
    const result = await api('sealedAddSlot', { objectId: object.id, unlock, slot, revision: revision() });
    accept(result.workspace);
    setNext(''); setNextConfirm('');
    setAdded(`Saved as a new sealed file next to this one, with ${result.description.slots.length} ways in. This one and anything already published keep their old ways in.`);
    if (result.recoveryKey) setRecovery({ recoveryKey: result.recoveryKey, name: object.name });
  });
  if (!opened) return <div className="open-sealed">
    {ways.length ? <>
      <div className="segmented" role="group" aria-label="Open with">{ways.map((item) => <button type="button" key={item} className={way === item ? 'selected' : ''} aria-pressed={way === item} onClick={() => { setWay(item); setSecret(''); }}>{labels[item]}</button>)}</div>
      {(way === 'passphrase' || way === 'recovery') && <Field label={way === 'passphrase' ? 'Passphrase' : 'Recovery key'}><input type="password" autoComplete="off" spellCheck={false} value={secret} onChange={(event) => setSecret(event.target.value)} /></Field>}
      {way === 'keychain' && <p className="small">This computer’s keychain holds a key for this file. Nothing to type.</p>}
      <button className="primary" disabled={(way === 'passphrase' || way === 'recovery') && !secret} onClick={openIt}>Open</button>
    </> : <p className="small">None of this file’s ways in can be used here{has('passkey-prf') ? ' (it only has passkey slots, and passkeys aren’t available in the editor)' : ''}.</p>}
  </div>;
  return <div className="open-sealed">
    <p className="notice"><strong>Opened with {labels[unlock!.kind].toLowerCase()}.</strong> Nothing was saved. Closing hides it again.</p>
    {opened.text !== undefined ? <textarea readOnly rows={8} value={opened.text} aria-label="Opened text" /> : <p className="small">{opened.mediaType} · {size(opened.byteLength)}. Save a copy to look at it.</p>}
    <div className="inline-actions"><button onClick={() => void action(() => api('sealedExport', { objectId: object.id, unlock }))}>Save an opened copy…</button></div>
    <details className="disclosure">
      <summary>Add a backup way in</summary>
      <p className="small">Adds a key without re-encrypting the content. Up to 8 ways in.</p>
      <div className="segmented" role="group" aria-label="Way in to add">{([['passphrase', 'Passphrase'], ['recovery', 'New recovery key'], ...(status?.keychain && !description.keychain ? [['keychain', 'This computer’s keychain']] : []), ...(passkey?.supported ? [['passkey', 'Passkey']] : [])] as [typeof addWay, string][]).map(([id, label]) => <button type="button" key={id} className={addWay === id ? 'selected' : ''} aria-pressed={addWay === id} onClick={() => setAddWay(id)}>{label}</button>)}</div>
      {addWay === 'passphrase' && <div className="form-grid"><Field label="New passphrase"><input type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} /></Field><Field label="Type it again"><input type="password" autoComplete="new-password" value={nextConfirm} onChange={(event) => setNextConfirm(event.target.value)} /></Field></div>}
      {addProblem && (next || nextConfirm) && <p className="field-error">{addProblem}</p>}
      <button className="primary" disabled={description.slots.length >= 8 || !!addProblem} onClick={addIt}>Add this way in</button>
      {added && <p className="small">{added}</p>}
    </details>
    {recovery && <RecoveryKeyConfirm recoveryKey={recovery.recoveryKey} name={recovery.name} action={action} done={() => setRecovery(undefined)} />}
  </div>;
}
