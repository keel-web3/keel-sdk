import { KEEL_MODULE_INPUTS_GLOBAL, type KeelModuleInputField, type KeelModuleInputManifest } from "@keel/protocol";

function comment(text: string): string {
  return text.replace(/\*\//gu, "*\\/").replace(/[\r\n]+/gu, " ");
}

function valueType(field: KeelModuleInputField): string {
  switch (field.type) {
    case "number": return "number";
    case "boolean": return "boolean";
    case "select": return field.options.map((option) => JSON.stringify(option.value)).join(" | ");
    case "multi-select": return `readonly (${field.options.map((option) => JSON.stringify(option.value)).join(" | ")})[]`;
    case "palette": return field.allowCustom === false && field.swatches ? `readonly (${field.swatches.map((hex) => JSON.stringify(hex)).join(" | ")})[]` : "readonly `#${string}`[]";
    case "color": return field.allowCustom === false && field.swatches ? field.swatches.map((hex) => JSON.stringify(hex)).join(" | ") : "`#${string}`";
    case "date": return "string";
    case "text": return "string";
  }
}

function describe(field: KeelModuleInputField): string {
  const notes = [field.label];
  if (field.help) notes.push(field.help);
  if (field.type === "number") notes.push(`${field.min}–${field.max}${field.unit ? ` ${field.unit}` : ""}, step ${field.step}`);
  if (field.type === "date") notes.push(field.time ? "UTC, YYYY-MM-DDTHH:MMZ" : "YYYY-MM-DD");
  if (field.default !== undefined) notes.push(`Default: ${JSON.stringify(field.default)}`);
  return comment(notes.join(" · "));
}

/**
 * Editor declarations for `globalThis.KEEL_INPUTS`. A setting is optional in
 * the type only when it is optional and has no default, so the type matches
 * what normalizeModuleInputValues can produce.
 */
export function createKeelInputsDeclarations(modules: readonly { readonly id: string; readonly manifest: KeelModuleInputManifest }[]): string {
  const blocks = modules.map(({ id, manifest }) => {
    const members = manifest.fields.map((field) => `      /** ${describe(field)} */\n      readonly ${JSON.stringify(field.key)}${field.required || field.default !== undefined ? "" : "?"}: ${valueType(field)};`);
    return `    readonly ${JSON.stringify(id)}: {\n${members.join("\n")}\n    };`;
  });
  return `export {};\ndeclare global {\n  /** Settings chosen for each included module, keyed by module id. */\n  interface KeelInputs {\n${blocks.join("\n")}\n  }\n  const ${KEEL_MODULE_INPUTS_GLOBAL}: Readonly<KeelInputs>;\n}\n`;
}
