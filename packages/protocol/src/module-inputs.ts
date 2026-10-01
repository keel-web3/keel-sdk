/**
 * Settings a module, script or artwork can ask its user for.
 *
 * A manifest is plain data: it names a fixed control type, its bounds and an
 * optional default. Hosts (Studio, the desktop editor, agents) render their
 * own controls for these types; a manifest can never name or load executable
 * UI. Chosen values are validated against the same manifest everywhere and
 * reach the running work as frozen data under `globalThis.KEEL_INPUTS`.
 */

import { escapeJsonForScript } from "./bytes.js";

export const KEEL_MODULE_INPUTS_PROTOCOL = "keel-module-inputs@1" as const;
export const KEEL_MODULE_INPUTS_GLOBAL = "KEEL_INPUTS" as const;
export const KEEL_MODULE_INPUTS_MAX_FIELDS = 24;
export const KEEL_MODULE_INPUTS_MAX_BYTES = 96_000;

export type KeelModuleInputType = "text" | "number" | "select" | "multi-select" | "color" | "palette" | "boolean" | "date";
/** Basic settings are shown up front; advanced settings sit behind a fold. */
export type KeelModuleInputPlacement = "basic" | "advanced";
export type KeelHexColor = `#${string}`;

interface KeelModuleInputBase {
  readonly key: string;
  readonly label: string;
  readonly help?: string;
  readonly required: boolean;
  /** Defaults to "basic". */
  readonly placement?: KeelModuleInputPlacement;
}

export interface KeelModuleInputOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Inclusive HSL bounds. Hue is in degrees; a range whose start exceeds its end
 * wraps through 0° (for example [330, 30] allows reds). Saturation and
 * lightness are percentages. Hue bounds do not apply to grays (0% saturation);
 * raise the saturation minimum to exclude them.
 */
export interface KeelColorClamp {
  readonly hue?: readonly [number, number];
  readonly saturation?: readonly [number, number];
  readonly lightness?: readonly [number, number];
}

interface KeelColorRules {
  /** Suggested colors, shown as one-tap swatches. */
  readonly swatches?: readonly KeelHexColor[];
  /** When false, only the swatches may be chosen. Defaults to true. */
  readonly allowCustom?: boolean;
  readonly clamp?: KeelColorClamp;
}

export type KeelModuleInputField =
  | (KeelModuleInputBase & {
      readonly type: "text";
      readonly minLength: number;
      readonly maxLength: number;
      readonly multiline: boolean;
      readonly placeholder?: string;
      readonly default?: string;
    })
  | (KeelModuleInputBase & {
      readonly type: "number";
      readonly min: number;
      readonly max: number;
      readonly step: number;
      /** "slider" shows a slider with an exact field; "field" shows the exact field only. */
      readonly control?: "slider" | "field";
      readonly unit?: string;
      readonly default?: number;
    })
  | (KeelModuleInputBase & {
      readonly type: "select";
      readonly options: readonly KeelModuleInputOption[];
      readonly default?: string;
    })
  | (KeelModuleInputBase & {
      readonly type: "multi-select";
      readonly options: readonly KeelModuleInputOption[];
      readonly minItems: number;
      readonly maxItems: number;
      readonly default?: readonly string[];
    })
  | (KeelModuleInputBase & KeelColorRules & {
      readonly type: "color";
      readonly default?: KeelHexColor;
    })
  | (KeelModuleInputBase & KeelColorRules & {
      readonly type: "palette";
      readonly minItems: number;
      readonly maxItems: number;
      readonly default?: readonly KeelHexColor[];
    })
  | (KeelModuleInputBase & {
      readonly type: "boolean";
      readonly default?: boolean;
    })
  | (KeelModuleInputBase & {
      readonly type: "date";
      /** When true, values are UTC minutes: YYYY-MM-DDTHH:MMZ. Otherwise YYYY-MM-DD. */
      readonly time?: boolean;
      readonly min?: string;
      readonly max?: string;
      readonly default?: string;
    });

export type KeelModuleInputValue = string | number | boolean | readonly string[];
export type KeelModuleInputValues = Readonly<Record<string, KeelModuleInputValue>>;

export interface KeelModuleInputManifest {
  readonly protocol: typeof KEEL_MODULE_INPUTS_PROTOCOL;
  readonly fields: readonly KeelModuleInputField[];
}

const KEY = /^[a-z][a-zA-Z0-9_-]{0,47}$/u;
const HEX = /^#[0-9a-fA-F]{6}$/u;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})Z$/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const TYPES: ReadonlySet<string> = new Set<KeelModuleInputType>(["text", "number", "select", "multi-select", "color", "palette", "boolean", "date"]);
const BASE_KEYS = ["key", "label", "help", "required", "placement", "type"] as const;
const COLOR_KEYS = ["swatches", "allowCustom", "clamp"] as const;
const FIELD_KEYS: Readonly<Record<KeelModuleInputType, readonly string[]>> = {
  text: [...BASE_KEYS, "minLength", "maxLength", "multiline", "placeholder", "default"],
  number: [...BASE_KEYS, "min", "max", "step", "control", "unit", "default"],
  select: [...BASE_KEYS, "options", "default"],
  "multi-select": [...BASE_KEYS, "options", "minItems", "maxItems", "default"],
  color: [...BASE_KEYS, ...COLOR_KEYS, "default"],
  palette: [...BASE_KEYS, ...COLOR_KEYS, "minItems", "maxItems", "default"],
  boolean: [...BASE_KEYS, "default"],
  date: [...BASE_KEYS, "time", "min", "max", "default"],
};

/** Configuration is data only: no evaluation, getters, prototypes, symbols or deep nesting. */
export function assertPlainModuleInputData(value: unknown, depth = 0): void {
  if (depth > 8) throw new TypeError("Module settings are nested too deeply.");
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") throw new TypeError("Module settings cannot contain executable or non-JSON values.");
  if (value === null || typeof value !== "object") return;
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new TypeError("Module settings must contain plain data.");
  for (const name of Reflect.ownKeys(value)) {
    if (typeof name !== "string") throw new TypeError("Module settings cannot contain symbol keys.");
    if (FORBIDDEN.has(name)) throw new TypeError("Module settings contain a reserved key.");
    const property = Object.getOwnPropertyDescriptor(value, name);
    if (property?.get || property?.set) throw new TypeError("Module settings cannot contain executable properties.");
    if (Array.isArray(value) && name === "length") continue;
    assertPlainModuleInputData(property?.value, depth + 1);
  }
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${what} must be an object.`);
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const name of Object.keys(value)) if (!allowed.includes(name)) throw new TypeError(`${what}: "${name}" is not supported.`);
}

function text(value: unknown, what: string, min: number, max: number): string {
  if (typeof value !== "string") throw new TypeError(`${what} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max || CONTROL.test(trimmed)) throw new TypeError(`${what} must be ${min}–${max} characters.`);
  return trimmed;
}

function integer(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${what} must be a whole number from ${min} to ${max}.`);
  return value;
}

function finite(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new TypeError(`${what} must be a number from ${min} to ${max}.`);
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${what} must be true or false.`);
  return value;
}

export function normalizeHexColor(value: unknown): KeelHexColor | undefined {
  return typeof value === "string" && HEX.test(value) ? (value.toLowerCase() as KeelHexColor) : undefined;
}

/** Hue 0–360, saturation and lightness 0–100. */
export function hexToHsl(hex: string): { readonly h: number; readonly s: number; readonly l: number } {
  const color = normalizeHexColor(hex);
  if (!color) throw new TypeError("Use a six-digit hex color.");
  const r = Number.parseInt(color.slice(1, 3), 16) / 255;
  const g = Number.parseInt(color.slice(3, 5), 16) / 255;
  const b = Number.parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: Math.min(100, s * 100), l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): KeelHexColor {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const light = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const channel = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}` as KeelHexColor;
}

/** True when a hue (degrees) is inside an inclusive range that may wrap through 0°. */
export function hueWithin(hue: number, range: readonly [number, number], tolerance = 0): boolean {
  const [from, to] = range;
  if (to - from >= 360 || (from === 0 && to === 360)) return true;
  const span = (((to - from) % 360) + 360) % 360;
  const offset = (((hue - from) % 360) + 360) % 360;
  return offset <= span + tolerance || offset >= 360 - tolerance;
}

/** Hex round-trips lose precision, so bounds allow one unit of slack. */
const CLAMP_TOLERANCE = 1;

export function colorWithinClamp(hex: string, clamp: KeelColorClamp | undefined): boolean {
  if (!clamp) return true;
  const { h, s, l } = hexToHsl(hex);
  const inside = (value: number, range: readonly [number, number] | undefined) => !range || (value >= range[0] - CLAMP_TOLERANCE && value <= range[1] + CLAMP_TOLERANCE);
  if (!inside(s, clamp.saturation) || !inside(l, clamp.lightness)) return false;
  return !clamp.hue || s < 0.5 || hueWithin(h, clamp.hue, CLAMP_TOLERANCE);
}

/** Moves a color to the nearest point inside the clamp, keeping as much of its character as possible. */
export function clampColor(hex: string, clamp: KeelColorClamp | undefined): KeelHexColor {
  const color = normalizeHexColor(hex);
  if (!color) throw new TypeError("Use a six-digit hex color.");
  if (!clamp || colorWithinClamp(color, clamp)) return color;
  let { h, s, l } = hexToHsl(color);
  if (clamp.hue && !hueWithin(h, clamp.hue)) {
    const [from, to] = clamp.hue;
    const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    h = distance(h, from) <= distance(h, to) ? from : to;
    if (s < 1) s = Math.max(s, clamp.saturation?.[0] ?? 50);
  }
  if (clamp.saturation) s = Math.min(clamp.saturation[1], Math.max(clamp.saturation[0], s));
  if (clamp.lightness) l = Math.min(clamp.lightness[1], Math.max(clamp.lightness[0], l));
  return hslToHex(h, s, l);
}

function pair(value: unknown, what: string, max: number): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError(`${what} must be a [minimum, maximum] pair.`);
  return [finite(value[0], `${what} minimum`, 0, max), finite(value[1], `${what} maximum`, 0, max)];
}

function colorClamp(value: unknown, what: string): KeelColorClamp {
  const input = record(value, `${what} clamp`);
  onlyKeys(input, ["hue", "saturation", "lightness"], `${what} clamp`);
  if (Object.keys(input).length === 0) throw new TypeError(`${what} clamp needs at least one bound.`);
  const result: { hue?: readonly [number, number]; saturation?: readonly [number, number]; lightness?: readonly [number, number] } = {};
  if (input.hue !== undefined) result.hue = pair(input.hue, `${what} hue`, 360);
  for (const name of ["saturation", "lightness"] as const) {
    if (input[name] === undefined) continue;
    const range = pair(input[name], `${what} ${name}`, 100);
    if (range[0] > range[1]) throw new TypeError(`${what} ${name} minimum exceeds its maximum.`);
    result[name] = range;
  }
  return result;
}

function parseDate(value: unknown, time: boolean): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = (time ? DATETIME : DATE).exec(value);
  if (!match) return undefined;
  const [year, month, day, hour = 0, minute = 0] = match.slice(1).map(Number) as [number, number, number, number?, number?];
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return undefined;
  const probe = new Date(Date.UTC(year, month - 1, day));
  probe.setUTCFullYear(year);
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return undefined;
  return value;
}

function options(value: unknown, what: string): readonly KeelModuleInputOption[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 256) throw new TypeError(`${what} needs 2–256 options.`);
  const result = value.map((entry, index) => {
    const option = record(entry, `${what} option ${index + 1}`);
    onlyKeys(option, ["value", "label"], `${what} option ${index + 1}`);
    return { value: text(option.value, `${what} option ${index + 1} value`, 1, 96), label: text(option.label, `${what} option ${index + 1} label`, 1, 96) };
  });
  if (new Set(result.map((option) => option.value)).size !== result.length) throw new TypeError(`${what}: option values must be unique.`);
  return result;
}

function colorRules(input: Record<string, unknown>, what: string): KeelColorRules {
  const rules: { swatches?: readonly KeelHexColor[]; allowCustom?: boolean; clamp?: KeelColorClamp } = {};
  if (input.clamp !== undefined) rules.clamp = colorClamp(input.clamp, what);
  if (input.swatches !== undefined) {
    if (!Array.isArray(input.swatches) || input.swatches.length < 1 || input.swatches.length > 64) throw new TypeError(`${what} needs 1–64 swatches.`);
    const swatches = input.swatches.map((entry) => {
      const color = normalizeHexColor(entry);
      if (!color) throw new TypeError(`${what}: swatches must be six-digit hex colors.`);
      if (!colorWithinClamp(color, rules.clamp)) throw new TypeError(`${what}: swatch ${color} is outside the allowed color range.`);
      return color;
    });
    if (new Set(swatches).size !== swatches.length) throw new TypeError(`${what}: swatches must be unique.`);
    rules.swatches = swatches;
  }
  if (input.allowCustom !== undefined) rules.allowCustom = bool(input.allowCustom, `${what} allowCustom`);
  if (rules.allowCustom === false && !rules.swatches) throw new TypeError(`${what}: swatches are required when custom colors are not allowed.`);
  return rules;
}

function colorAllowed(field: Extract<KeelModuleInputField, { type: "color" | "palette" }>, value: unknown): KeelHexColor | undefined {
  const color = normalizeHexColor(value);
  if (!color) return undefined;
  if (field.allowCustom === false) return field.swatches?.includes(color) ? color : undefined;
  return colorWithinClamp(color, field.clamp) ? color : undefined;
}

function invalid(field: KeelModuleInputField): TypeError {
  return new TypeError(`${field.label}: choose a value within the allowed settings.`);
}

/** Validates one value for one field and returns its normalized form. */
export function normalizeModuleInputValue(field: KeelModuleInputField, value: unknown): KeelModuleInputValue {
  switch (field.type) {
    case "text":
      if (typeof value !== "string" || value.trim().length < field.minLength || value.length > field.maxLength || (field.required && value.trim().length === 0)) throw invalid(field);
      return value;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value) || value < field.min || value > field.max) throw invalid(field);
      const steps = (value - field.min) / field.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-7) throw invalid(field);
      return value;
    }
    case "boolean":
      if (typeof value !== "boolean") throw invalid(field);
      return value;
    case "color": {
      const color = colorAllowed(field, value);
      if (!color) throw invalid(field);
      return color;
    }
    case "select":
      if (typeof value !== "string" || !field.options.some((option) => option.value === value)) throw invalid(field);
      return value;
    case "date": {
      const date = parseDate(value, field.time === true);
      if (!date || (field.min !== undefined && date < field.min) || (field.max !== undefined && date > field.max)) throw invalid(field);
      return date;
    }
    case "multi-select":
    case "palette": {
      if (!Array.isArray(value) || value.length < Math.max(field.required ? 1 : 0, field.minItems) || value.length > field.maxItems) throw invalid(field);
      const normalized = value.map((entry: unknown) => {
        if (field.type === "palette") {
          const color = colorAllowed(field, entry);
          if (!color) throw invalid(field);
          return color;
        }
        if (typeof entry !== "string" || !field.options.some((option) => option.value === entry)) throw invalid(field);
        return entry;
      });
      if (new Set(normalized).size !== normalized.length) throw new TypeError(`${field.label}: values must be unique.`);
      return normalized;
    }
  }
}

function field(value: unknown, index: number): KeelModuleInputField {
  const input = record(value, `Setting ${index + 1}`);
  if (typeof input.type !== "string" || !TYPES.has(input.type)) throw new TypeError(`Setting ${index + 1} has an unsupported type.`);
  const type = input.type as KeelModuleInputType;
  onlyKeys(input, FIELD_KEYS[type], `Setting ${index + 1}`);
  if (typeof input.key !== "string" || !KEY.test(input.key) || FORBIDDEN.has(input.key)) throw new TypeError(`Setting ${index + 1}: use a key that starts with a lowercase letter followed by letters, numbers, underscores or hyphens.`);
  const label = text(input.label, `Setting ${index + 1} label`, 1, 96);
  const base: { key: string; label: string; help?: string; required: boolean; placement?: KeelModuleInputPlacement } = { key: input.key, label, required: bool(input.required, `${label} required`) };
  if (input.help !== undefined) base.help = text(input.help, `${label} help`, 0, 320);
  if (input.placement !== undefined) {
    if (input.placement !== "basic" && input.placement !== "advanced") throw new TypeError(`${label}: placement must be "basic" or "advanced".`);
    base.placement = input.placement;
  }
  let result: KeelModuleInputField;
  switch (type) {
    case "text": {
      const minLength = integer(input.minLength, `${label} minimum length`, 0, 4000);
      const maxLength = integer(input.maxLength, `${label} maximum length`, 1, 4000);
      if (minLength > maxLength) throw new TypeError(`${label}: minimum length exceeds maximum.`);
      result = { ...base, type, minLength, maxLength, multiline: bool(input.multiline, `${label} multiline`), ...(input.placeholder === undefined ? {} : { placeholder: text(input.placeholder, `${label} placeholder`, 0, 160) }) };
      break;
    }
    case "number": {
      const min = finite(input.min, `${label} minimum`, -1e12, 1e12);
      const max = finite(input.max, `${label} maximum`, -1e12, 1e12);
      const step = finite(input.step, `${label} step`, 1e-6, 1e12);
      if (min > max || (max - min) / step > Number.MAX_SAFE_INTEGER) throw new TypeError(`${label}: invalid number range.`);
      if (input.control !== undefined && input.control !== "slider" && input.control !== "field") throw new TypeError(`${label}: control must be "slider" or "field".`);
      result = { ...base, type, min, max, step, ...(input.control === undefined ? {} : { control: input.control }), ...(input.unit === undefined ? {} : { unit: text(input.unit, `${label} unit`, 1, 16) }) };
      break;
    }
    case "select":
      result = { ...base, type, options: options(input.options, label) };
      break;
    case "multi-select": {
      const list = options(input.options, label);
      const minItems = integer(input.minItems, `${label} minimum selections`, 0, 64);
      const maxItems = integer(input.maxItems, `${label} maximum selections`, 1, 64);
      if (minItems > maxItems) throw new TypeError(`${label}: minimum count exceeds maximum.`);
      if (minItems > list.length) throw new TypeError(`${label}: not enough options for the minimum count.`);
      result = { ...base, type, options: list, minItems, maxItems };
      break;
    }
    case "color":
      result = { ...base, type, ...colorRules(input, label) };
      break;
    case "palette": {
      const minItems = integer(input.minItems, `${label} minimum colors`, 0, 64);
      const maxItems = integer(input.maxItems, `${label} maximum colors`, 1, 64);
      if (minItems > maxItems) throw new TypeError(`${label}: minimum count exceeds maximum.`);
      const rules = colorRules(input, label);
      if (rules.allowCustom === false && rules.swatches && minItems > rules.swatches.length) throw new TypeError(`${label}: not enough swatches for the minimum count.`);
      result = { ...base, type, minItems, maxItems, ...rules };
      break;
    }
    case "boolean":
      result = { ...base, type };
      break;
    case "date": {
      const time = input.time === undefined ? undefined : bool(input.time, `${label} time`);
      const bound = (raw: unknown, name: string) => {
        const parsed = parseDate(raw, time === true);
        if (!parsed) throw new TypeError(`${label} ${name} must be ${time ? "YYYY-MM-DDTHH:MMZ" : "YYYY-MM-DD"}.`);
        return parsed;
      };
      const min = input.min === undefined ? undefined : bound(input.min, "minimum");
      const max = input.max === undefined ? undefined : bound(input.max, "maximum");
      if (min !== undefined && max !== undefined && min > max) throw new TypeError(`${label}: earliest date is after the latest date.`);
      result = { ...base, type, ...(time === undefined ? {} : { time }), ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
      break;
    }
  }
  if (input.default !== undefined) {
    const normalized = normalizeModuleInputValue(result, input.default);
    result = { ...result, default: normalized } as KeelModuleInputField;
  }
  return result;
}

export function normalizeModuleInputManifest(value: unknown): KeelModuleInputManifest {
  assertPlainModuleInputData(value);
  const serialized = JSON.stringify(value);
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > KEEL_MODULE_INPUTS_MAX_BYTES) throw new TypeError("Module settings exceed the 96 KB limit.");
  const input = record(value, "Module settings");
  onlyKeys(input, ["protocol", "fields"], "Module settings");
  if (input.protocol !== KEEL_MODULE_INPUTS_PROTOCOL) throw new TypeError(`Module settings must use ${KEEL_MODULE_INPUTS_PROTOCOL}.`);
  if (!Array.isArray(input.fields) || input.fields.length < 1 || input.fields.length > KEEL_MODULE_INPUTS_MAX_FIELDS) throw new TypeError(`Module settings need 1–${KEEL_MODULE_INPUTS_MAX_FIELDS} fields.`);
  const fields = input.fields.map(field);
  if (new Set(fields.map((entry) => entry.key)).size !== fields.length) throw new TypeError("Module input keys must be unique.");
  return { protocol: KEEL_MODULE_INPUTS_PROTOCOL, fields };
}

/** Applies defaults, rejects undeclared keys and returns values in declaration order. */
export function normalizeModuleInputValues(manifestValue: unknown, value: unknown): KeelModuleInputValues {
  const manifest = normalizeModuleInputManifest(manifestValue);
  assertPlainModuleInputData(value);
  const answers = record(value, "Module answers");
  const known = new Set(manifest.fields.map((entry) => entry.key));
  if (Object.keys(answers).some((name) => !known.has(name))) throw new TypeError("Module answers contain an undeclared input.");
  const entries: [string, KeelModuleInputValue][] = [];
  for (const entry of manifest.fields) {
    const raw = Object.hasOwn(answers, entry.key) ? answers[entry.key] : entry.default;
    if (raw === undefined) {
      if (entry.required) throw new TypeError(`${entry.label} is required.`);
      continue;
    }
    entries.push([entry.key, normalizeModuleInputValue(entry, raw)]);
  }
  return Object.fromEntries(entries);
}

export function moduleInputDefaults(manifest: KeelModuleInputManifest): KeelModuleInputValues {
  return Object.fromEntries(manifest.fields.flatMap((entry) => (entry.default === undefined ? [] : [[entry.key, entry.default]])));
}

export function moduleInputPlacement(entry: KeelModuleInputField): KeelModuleInputPlacement {
  return entry.placement ?? "basic";
}

/** Same rules as module keys: lowercase start, then letters, numbers, dots, underscores or hyphens. */
const MODULE_ID = /^[a-z][a-z0-9._-]{0,127}$/u;

/**
 * Classic-script source that publishes chosen settings before any module runs:
 * `globalThis.KEEL_INPUTS["<module id>"]` is a deeply frozen object.
 * Values must already be normalized against each module's manifest.
 */
export function createKeelInputsScript(entries: readonly { readonly moduleId: string; readonly values: KeelModuleInputValues }[]): string {
  const map: Record<string, KeelModuleInputValues> = Object.create(null) as Record<string, KeelModuleInputValues>;
  for (const entry of entries) {
    if (!MODULE_ID.test(entry.moduleId) || FORBIDDEN.has(entry.moduleId)) throw new TypeError(`Module id "${entry.moduleId}" cannot carry settings.`);
    if (Object.hasOwn(map, entry.moduleId)) throw new TypeError(`Settings for "${entry.moduleId}" were supplied twice.`);
    assertPlainModuleInputData(entry.values);
    map[entry.moduleId] = entry.values;
  }
  return `(()=>{const f=(v)=>{if(v&&typeof v==="object"){for(const k of Object.keys(v))f(v[k]);Object.freeze(v);}return v;};const g=globalThis;const n=${escapeJsonForScript(JSON.stringify(map))};const p=g.${KEEL_MODULE_INPUTS_GLOBAL};if(p&&typeof p==="object"){for(const k of Object.keys(p))if(!Object.hasOwn(n,k))n[k]=p[k];}Object.defineProperty(g,"${KEEL_MODULE_INPUTS_GLOBAL}",{value:f(n),enumerable:false,configurable:true,writable:false});})();`;
}
