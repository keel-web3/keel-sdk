import { defineModule, type DefineModuleInput } from "./define.js";
import { defineDocument, type TrustedHtml } from "./document.js";
import type { ModuleDescriptor } from "./descriptor.js";

export interface Signal<T> { value: T }
let observer: (() => void) | undefined;
const signalReaders = new WeakMap<object, () => unknown>();
export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const result = { get value() { if (observer) { listeners.add(observer); dependencyCollector?.add(listeners); } return value; }, set value(next: T) { if (Object.is(value, next)) return; value = next; for (const notify of [...listeners]) notify(); } };
  signalReaders.set(result, () => result.value);
  return result;
}
export const Fragment = Symbol("keel.fragment");
export type TemplateChild = TemplateNode | string | number | boolean | null | undefined | Signal<unknown> | readonly TemplateChild[] | (() => TemplateChild);
export interface TemplateNode {
  readonly kind: "keel-template-node@1";
  readonly type: string | typeof Fragment | ((props: any) => TemplateChild);
  readonly props: Readonly<Record<string, unknown>>;
}
export function jsx(type: TemplateNode["type"], props: Record<string, unknown> | null): TemplateNode {
  return { kind: "keel-template-node@1", type, props: props ?? {} };
}
export const jsxs = jsx;
export const jsxDEV = jsx;

type Disposal = () => void;
const mounts = new WeakMap<Element, Disposal>();
/** Mounts into the existing KEEL document. Text is always text, never parsed HTML. */
export function mountTemplate(root: Element, view: TemplateChild): Disposal {
  mounts.get(root)?.();
  const document = root.ownerDocument;
  const cleanups: Disposal[] = [];
  function append(parent: Node, child: TemplateChild, cleanup: Disposal[], svg = false): void {
    if (child == null || typeof child === "boolean") return;
    if (Array.isArray(child)) { for (const value of child) append(parent, value, cleanup, svg); return; }
    const reader = typeof child === "function" ? child : typeof child === "object" ? signalReaders.get(child) : undefined;
    if (reader) {
      const start = document.createComment("keel"); const end = document.createComment("/keel"); parent.appendChild(start); parent.appendChild(end);
      let children: Disposal[] = []; let alive = true;
      const dependencies = new Set<Set<() => void>>();
      const update = () => {
        if (!alive) return;
        for (const dispose of children.splice(0)) dispose();
        for (const dependency of dependencies) dependency.delete(update);
        dependencies.clear();
        while (start.nextSibling && start.nextSibling !== end) start.parentNode!.removeChild(start.nextSibling);
        const fragment = document.createDocumentFragment(); const previous = observer;
        observer = update;
        const previousCollector = dependencyCollector; dependencyCollector = dependencies;
        try { append(fragment, reader() as TemplateChild, children, svg); }
        finally { observer = previous; dependencyCollector = previousCollector; }
        end.parentNode!.insertBefore(fragment, end);
      };
      cleanup.push(() => { alive = false; for (const dependency of dependencies) dependency.delete(update); for (const dispose of children) dispose(); });
      update(); return;
    }
    if (typeof child === "string" || typeof child === "number") { parent.appendChild(document.createTextNode(String(child))); return; }
    if (!(typeof child === "object" && "kind" in child && child.kind === "keel-template-node@1")) throw new TypeError("Unsupported KEEL template child.");
    const node = child as TemplateNode;
    if (node.type === Fragment) { append(parent, node.props.children as TemplateChild, cleanup, svg); return; }
    if (typeof node.type === "function") { append(parent, node.type(node.props), cleanup, svg); return; }
    const inSvg = svg || node.type === "svg";
    const element = inSvg ? document.createElementNS("http://www.w3.org/2000/svg", node.type) : document.createElement(node.type);
    for (const [key, value] of Object.entries(node.props)) {
      if (key === "children" || key === "key") continue;
      if (key === "innerHTML" || key === "dangerouslySetInnerHTML" || key === "outerHTML") throw new TypeError("Use template children for markup.");
      if (key === "ref") { if (typeof value !== "function") throw new TypeError("Template ref must be a function."); value(element); cleanup.push(() => value(null)); continue; }
      if (/^on[A-Z]/u.test(key)) {
        if (typeof value !== "function") throw new TypeError("Template event handlers must be functions.");
        const event = key.slice(2).toLowerCase(); element.addEventListener(event, value as EventListener); cleanup.push(() => element.removeEventListener(event, value as EventListener)); continue;
      }
      const set = (next: unknown) => {
        if (key === "style" && next && typeof next === "object") { for (const [property, setting] of Object.entries(next)) (element as HTMLElement).style.setProperty(property.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`), String(setting)); return; }
        const attribute = key === "className" ? "class" : key === "htmlFor" ? "for" : key;
        if (key === "value" || key === "checked" || key === "selected") (element as unknown as Record<string, unknown>)[key] = next;
        if (next == null || next === false) element.removeAttribute(attribute); else element.setAttribute(attribute, next === true ? "" : String(next));
      };
      const get = typeof value === "object" && value !== null ? signalReaders.get(value) : typeof value === "function" ? value as () => unknown : undefined;
      if (get) {
        const dependencies = new Set<Set<() => void>>();
        const update = () => { for (const dep of dependencies) dep.delete(update); dependencies.clear(); const old = observer; const collector = dependencyCollector; observer = update; dependencyCollector = dependencies; try { set(get()); } finally { observer = old; dependencyCollector = collector; } };
        update(); cleanup.push(() => { for (const dep of dependencies) dep.delete(update); });
      } else set(value);
    }
    append(element, node.props.children as TemplateChild, cleanup, inSvg && node.type !== "foreignObject"); parent.appendChild(element);
  }
  root.replaceChildren();
  try { append(root, view, cleanups); } catch (error) { for (const cleanup of cleanups) cleanup(); root.replaceChildren(); throw error; }
  const dispose = () => { for (const cleanup of cleanups.splice(0)) cleanup(); root.replaceChildren(); if (mounts.get(root) === dispose) mounts.delete(root); };
  mounts.set(root, dispose); return dispose;
}
let dependencyCollector: Set<Set<() => void>> | undefined;

export function defineTemplate<const Descriptors extends readonly ModuleDescriptor[] = readonly []>(
  options: Omit<DefineModuleInput<Descriptors>, "document" | "extends"> & { readonly extends?: Descriptors; readonly name: string; readonly title: string; readonly lang?: string; readonly mountId?: string; readonly head?: TrustedHtml },
  view: TemplateChild,
) {
  const {name, title, lang, mountId, head, extends: dependencies, ...module} = options;
  return defineModule(name, { ...module, extends: dependencies ?? [] as unknown as Descriptors, document: defineDocument({title, ...(lang ? {lang} : {}), ...(mountId ? {mountId} : {}), ...(head ? {head} : {}), render: ({root}) => { mountTemplate(root, view); }}) });
}
