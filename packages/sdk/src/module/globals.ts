/** Augment this interface with the names of shared APIs in your project. */
export interface GlobalModules {}

type ModuleRegistry = Record<string, unknown>;
const registryKey = Symbol.for("keel.module-globals@1");

function registry(): ModuleRegistry {
  const host = globalThis as typeof globalThis & { [registryKey]?: ModuleRegistry };
  if (host[registryKey] === undefined) {
    Object.defineProperty(host, registryKey, { value: Object.create(null), writable: false, configurable: false });
  }
  return host[registryKey]!;
}

/** Declare shared state or an API. The creator compiler supplies the item's
 * source path automatically; an explicit name lets other items address it.
 * Import the returned value for inferred, source-derived IDE types.
 * @param sourcePath Internal compiler-supplied source identity.
 */
export function declareGlobals<T extends object>(values: T, name?: string, sourcePath?: string): T {
  const key = name ?? sourcePath;
  if (typeof key !== "string" || key.length === 0 || /[\u0000-\u001f]/u.test(key)) {
    throw new TypeError("A global module needs a name or the KEEL creator compiler's source path.");
  }
  if (values === null || (typeof values !== "object" && typeof values !== "function")) {
    throw new TypeError("Module globals must be an object or function.");
  }
  const modules = registry();
  if (Object.hasOwn(modules, key)) {
    if (modules[key] !== values) throw new TypeError(`Module globals already declared: ${key}`);
    return values;
  }
  Object.defineProperty(modules, key, { value: values, enumerable: true, writable: false, configurable: false });
  return values;
}

export function getGlobals<Name extends keyof GlobalModules>(name: Name): GlobalModules[Name];
export function getGlobals(name: string): unknown;
export function getGlobals(name: string): unknown {
  const modules = registry();
  if (!Object.hasOwn(modules, name)) throw new Error(`Module globals not declared: ${name}`);
  return modules[name];
}
