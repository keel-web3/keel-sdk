import React, { useState } from 'react';
import {
  clampColor,
  colorWithinClamp,
  moduleInputDefaults,
  moduleInputPlacement,
  normalizeHexColor,
  normalizeModuleInputValue,
  type KeelColorClamp,
  type KeelModuleInputField,
  type KeelModuleInputManifest,
  type KeelModuleInputValue,
  type KeelModuleInputValues,
} from '@keel/protocol';
import { Badge } from './ui';

/*
 * The editor's form for module settings: the same fixed controls and rules as
 * Studio (keel-module-inputs@1), styled for the desktop. Basic settings sit up
 * front; advanced ones fold away and open on their own when one needs a fix.
 */

type Change = (value: KeelModuleInputValue | undefined) => void;
type Of<T extends KeelModuleInputField['type']> = Extract<KeelModuleInputField, { type: T }>;

function clampText(clamp: KeelColorClamp | undefined): string {
  if (!clamp) return '';
  return [clamp.hue && `hue ${clamp.hue[0]}°–${clamp.hue[1]}°`, clamp.saturation && `saturation ${clamp.saturation[0]}–${clamp.saturation[1]}%`, clamp.lightness && `lightness ${clamp.lightness[0]}–${clamp.lightness[1]}%`].filter(Boolean).join(' · ');
}

function problem(field: KeelModuleInputField, value: KeelModuleInputValue | undefined): string | undefined {
  if (value === undefined) return field.required ? 'Required.' : undefined;
  try { normalizeModuleInputValue(field, value); return undefined; } catch (error) { return error instanceof Error ? error.message.replace(`${field.label}: `, '') : 'Check this value.'; }
}

const pad = (value: number) => String(value).padStart(2, '0');
function toLocal(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value.replace(/Z$/u, ':00Z'));
  return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toUtc(value: string): string | undefined {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? `${date.toISOString().slice(0, 16)}Z` : undefined;
}

function Swatches({ colors, active, onPick, disabled }: { colors: readonly string[]; active: (hex: string) => boolean; onPick: (hex: string) => void; disabled?: (hex: string) => boolean }) {
  return <div className="module-settings__swatches">{colors.map((hex) => <button type="button" key={hex} title={hex} aria-label={hex} aria-pressed={active(hex)} disabled={disabled?.(hex)} className="module-settings__swatch" style={{ background: hex }} onClick={() => onPick(hex)} />)}</div>;
}

function ColorControl({ field, value, onChange }: { field: Of<'color'>; value: KeelModuleInputValue | undefined; onChange: Change }) {
  const hex = typeof value === 'string' ? normalizeHexColor(value) : undefined;
  const custom = field.allowCustom !== false;
  const [draft, setDraft] = useState({ source: hex, text: hex ?? '' });
  let text = draft.text;
  if (draft.source !== hex) { text = hex ?? ''; setDraft({ source: hex, text }); }
  const setText = (next: string) => setDraft({ source: hex, text: next });
  return <div className="module-settings__row">
    {custom && <input type="color" aria-label={`${field.label} picker`} value={hex ?? clampColor('#4553e6', field.clamp)} onChange={(event) => { const next = clampColor(event.target.value, field.clamp); setText(next); onChange(next); }} />}
    {custom && <input aria-label={`${field.label} hex`} className="module-settings__hex" value={text} maxLength={7} placeholder="#4553e6" onChange={(event) => { setText(event.target.value); const next = normalizeHexColor(event.target.value); if (next) onChange(next); }} />}
    {field.swatches && <Swatches colors={field.swatches} active={(item) => item === hex} onPick={onChange} />}
    {field.clamp && <small>Allowed: {clampText(field.clamp)}. Picks outside it move to the nearest allowed color.</small>}
  </div>;
}

function PaletteControl({ field, value, onChange }: { field: Of<'palette'>; value: KeelModuleInputValue | undefined; onChange: Change }) {
  const colors = Array.isArray(value) ? value : [];
  const [draft, setDraft] = useState(() => clampColor(field.swatches?.[0] ?? '#4553e6', field.clamp));
  const full = colors.length >= field.maxItems;
  const add = (hex: string) => { if (!full && !colors.includes(hex)) onChange([...colors, hex]); };
  return <div className="module-settings__column">
    <div className="module-settings__row">{colors.length ? colors.map((hex) => <button type="button" key={hex} className="module-settings__chip" onClick={() => onChange(colors.filter((item) => item !== hex))}><span style={{ background: hex }} />{hex} ×</button>) : <small>No colors yet.</small>}</div>
    {field.swatches && <Swatches colors={field.swatches} active={(hex) => colors.includes(hex)} disabled={(hex) => full && !colors.includes(hex)} onPick={(hex) => colors.includes(hex) ? onChange(colors.filter((item) => item !== hex)) : add(hex)} />}
    {field.allowCustom !== false && <div className="module-settings__row"><input type="color" aria-label={`${field.label} new color`} value={draft} onChange={(event) => setDraft(clampColor(event.target.value, field.clamp))} /><button type="button" disabled={full || colors.includes(draft) || !colorWithinClamp(draft, field.clamp)} onClick={() => add(draft)}>Add {draft}</button></div>}
    <small>{colors.length} of {field.maxItems} colors{field.clamp ? ` · ${clampText(field.clamp)}` : ''}</small>
  </div>;
}

function Control({ field, value, onChange }: { field: KeelModuleInputField; value: KeelModuleInputValue | undefined; onChange: Change }) {
  switch (field.type) {
    case 'number': {
      const number = typeof value === 'number' ? value : undefined;
      const slider = field.control !== 'field' && (field.max - field.min) / field.step <= 2000;
      return <div className="module-settings__row">
        {slider && <input type="range" aria-label={`${field.label} slider`} min={field.min} max={field.max} step={field.step} value={number ?? field.default ?? field.min} onChange={(event) => onChange(Number(event.target.value))} />}
        <input type="number" aria-label={field.label} className="module-settings__number" min={field.min} max={field.max} step={field.step} value={number ?? ''} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.valueAsNumber)} />
        {field.unit && <small>{field.unit}</small>}
      </div>;
    }
    case 'boolean':
      return <div className="segmented"><button type="button" className={value === true ? 'selected' : ''} onClick={() => onChange(true)}>On</button><button type="button" className={value === false ? 'selected' : ''} onClick={() => onChange(false)}>Off</button></div>;
    case 'select':
      return field.options.length <= 4
        ? <div className="segmented">{field.options.map((option) => <button type="button" key={option.value} className={value === option.value ? 'selected' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>
        : <select aria-label={field.label} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || undefined)}><option value="">{field.required ? 'Choose…' : 'Not set'}</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
    case 'multi-select': {
      const chosen = Array.isArray(value) ? value : [];
      return <div className="segmented">{field.options.map((option) => { const on = chosen.includes(option.value); return <button type="button" key={option.value} className={on ? 'selected' : ''} disabled={!on && chosen.length >= field.maxItems} onClick={() => onChange(on ? chosen.filter((item) => item !== option.value) : [...chosen, option.value])}>{option.label}</button>; })}</div>;
    }
    case 'color': return <ColorControl field={field} value={value} onChange={onChange} />;
    case 'palette': return <PaletteControl field={field} value={value} onChange={onChange} />;
    case 'date':
      return field.time
        ? <input type="datetime-local" aria-label={field.label} value={toLocal(typeof value === 'string' ? value : undefined)} min={toLocal(field.min) || undefined} max={toLocal(field.max) || undefined} onChange={(event) => onChange(toUtc(event.target.value))} />
        : <input type="date" aria-label={field.label} value={typeof value === 'string' ? value : ''} min={field.min} max={field.max} onChange={(event) => onChange(event.target.value || undefined)} />;
    case 'text':
      return field.multiline
        ? <textarea aria-label={field.label} rows={3} maxLength={field.maxLength} placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || undefined)} />
        : <input aria-label={field.label} maxLength={field.maxLength} placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || undefined)} />;
  }
}

export function ModuleSettingsForm({ manifest, values, onChange }: { manifest: KeelModuleInputManifest; values: KeelModuleInputValues; onChange: (values: KeelModuleInputValues) => void }) {
  const set = (key: string, value: KeelModuleInputValue | undefined) => { const next: Record<string, KeelModuleInputValue> = { ...values }; if (value === undefined) delete next[key]; else next[key] = value; onChange(next); };
  const render = (field: KeelModuleInputField) => {
    const value = values[field.key] ?? field.default;
    const issue = problem(field, value);
    return <div className="module-settings__field" key={field.key}>
      <span className="module-settings__label">{field.label}{field.required ? ' *' : ''}{values[field.key] !== undefined && field.default !== undefined && <button type="button" className="text-button" onClick={() => set(field.key, undefined)}>Reset</button>}</span>
      {field.help && <small>{field.help}</small>}
      <Control field={field} value={value} onChange={(next) => set(field.key, next)} />
      {issue && <small className="error-text">{issue}</small>}
    </div>;
  };
  const basic = manifest.fields.filter((field) => moduleInputPlacement(field) === 'basic');
  const advanced = manifest.fields.filter((field) => moduleInputPlacement(field) === 'advanced');
  const attention = advanced.some((field) => problem(field, values[field.key] ?? field.default));
  return <div className="module-settings">
    {basic.map(render)}
    {advanced.length > 0 && <details className="disclosure" open={attention || basic.length === 0 || undefined}><summary>Advanced settings · {advanced.length}</summary>{advanced.map(render)}</details>}
  </div>;
}

/** A saved module reference with its settings, saved on the reference and applied to previews. */
export function ModuleSettingsCard({ name, moduleId, manifest, saved, onSave }: { name: string; moduleId?: string; manifest: KeelModuleInputManifest; saved?: Record<string, unknown>; onSave: (values: KeelModuleInputValues | undefined) => Promise<void> }) {
  const [values, setValues] = useState<KeelModuleInputValues>(() => ({ ...moduleInputDefaults(manifest), ...(saved as KeelModuleInputValues | undefined) }));
  const [busy, setBusy] = useState(false);
  const issues = manifest.fields.map((field) => problem(field, values[field.key] ?? field.default)).filter(Boolean);
  const changed = JSON.stringify(values) !== JSON.stringify({ ...moduleInputDefaults(manifest), ...(saved as KeelModuleInputValues | undefined) });
  return <article className="memory-card module-settings-card">
    <div className="module-settings__head"><h3>{name}</h3><Badge>{manifest.fields.length} settings</Badge>{saved ? <Badge tone="cool">Saved</Badge> : <Badge>Defaults</Badge>}</div>
    <p>Choose how this module behaves in your work. The preview receives these as <code>KEEL_INPUTS[{JSON.stringify(moduleId ?? name)}]</code> before your code runs.</p>
    <ModuleSettingsForm manifest={manifest} values={values} onChange={setValues} />
    <div className="inline-actions">
      <button className="primary" disabled={busy || issues.length > 0 || !changed} onClick={() => { setBusy(true); void onSave(values).finally(() => setBusy(false)); }}>{busy ? 'Saving…' : 'Save settings'}</button>
      {saved && <button disabled={busy} onClick={() => { setBusy(true); setValues(moduleInputDefaults(manifest)); void onSave(undefined).finally(() => setBusy(false)); }}>Use defaults</button>}
      {issues.length > 0 && <small className="error-text">{issues.length === 1 ? 'One setting needs a fix.' : `${issues.length} settings need a fix.`}</small>}
    </div>
  </article>;
}
