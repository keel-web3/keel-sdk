import {
  createKeelInputsScript,
  normalizeModuleInputManifest,
  normalizeModuleInputValues,
} from '@keel/protocol';

/*
 * Module settings for saved module references.
 *
 * A Studio search result keeps the catalog entry it came from. When that entry
 * declares keel-module-inputs@1 settings, the editor shows the same controls as
 * Studio, saves the chosen values on the reference, and publishes them to the
 * project preview as globalThis.KEEL_INPUTS["<module id>"] before any script runs.
 */

function entryOf(selection) {
  const metadata = selection?.metadata;
  if (!metadata || typeof metadata !== 'object') return undefined;
  return metadata.entry && typeof metadata.entry === 'object' ? metadata.entry : metadata;
}

/** The validated settings manifest a saved reference declares, if any. */
export function selectionSettingsManifest(selection) {
  const inputs = entryOf(selection)?.inputs;
  if (inputs === undefined) return undefined;
  try { return normalizeModuleInputManifest(Array.isArray(inputs) ? { protocol: 'keel-module-inputs@1', fields: inputs } : inputs); }
  catch { return undefined; }
}

/** The id a module reads its settings under. */
export function selectionModuleId(selection) {
  const id = entryOf(selection)?.id;
  return typeof id === 'string' && /^[a-z][a-z0-9._-]{0,127}$/u.test(id) ? id : undefined;
}

/** Chosen values with defaults applied; throws with a readable message when a value breaks a rule. */
export function selectionSettingsValues(selection) {
  const manifest = selectionSettingsManifest(selection);
  if (!manifest) {
    if (selection?.settings !== undefined) throw new Error(`${selection.name} has no settings to save.`);
    return undefined;
  }
  return normalizeModuleInputValues(manifest, selection.settings ?? {});
}

/** Checked on every workspace save, alongside the other cross-references. */
export function assertModuleSelectionSettings(selections) {
  for (const selection of selections) {
    if (selection.settings === undefined) continue;
    try { selectionSettingsValues(selection); }
    catch (error) { throw new Error(`${selection.name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

/** Classic script for a project's preview, or '' when none of its references have settings. */
export function projectInputsScript(selections, projectId) {
  const entries = [];
  const seen = new Set();
  for (const selection of selections) {
    if (selection.projectId !== projectId) continue;
    const moduleId = selectionModuleId(selection);
    if (!moduleId || seen.has(moduleId)) continue;
    let values;
    try { values = selectionSettingsValues(selection); } catch { continue; }
    if (!values) continue;
    seen.add(moduleId);
    entries.push({ moduleId, values });
  }
  return entries.length ? createKeelInputsScript(entries) : '';
}

/** Inserts the settings script first in <head>, so every creator script can read KEEL_INPUTS. */
export function withProjectInputs(html, script) {
  if (!script) return html;
  const tag = `<script data-keel-module-inputs="1">${script}</script>`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  const position = head ? head.index + head[0].length : /<!doctype[^>]*>/i.exec(html)?.[0].length ?? 0;
  return html.slice(0, position) + tag + html.slice(position);
}
