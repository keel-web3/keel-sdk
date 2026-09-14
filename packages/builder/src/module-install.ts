import { lstat, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, createIntegrity, type Hex } from "@keel/protocol";
import { verifyKeelModuleFromOrigin, type VerifyKeelModuleOptions } from "./module-verification.js";

/** Fetch, reproduce, and install an exact module for both the editor and bundler.
 * Never executes the installed module or runs package lifecycle scripts. */
export async function installKeelModule(input: VerifyKeelModuleOptions & {
  readonly projectRoot: string;
  readonly expectedOutput: Hex;
  readonly name: string;
}) {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(input.name)) throw new TypeError("Module name must be a lowercase package slug.");
  if (!/^0x[0-9a-f]{64}$/u.test(input.expectedOutput)) throw new TypeError("An exact lowercase SHA-256 output digest is required.");
  const verified = await verifyKeelModuleFromOrigin(input);
  if (verified.recipe.output.integrity.digest !== input.expectedOutput) throw new Error("Verified module output does not match the requested digest.");
  if (verified.recipe.options.format !== "esm") throw new Error("Editor package installation requires an ESM module.");
  if (verified.types.schema !== "keel-module-types@1") throw new Error(`Module has no verified IDE declarations: ${verified.types.reason}`);
  const types = verified.types;
  const entry = verified.recipe.entry.replace(/\.[cm][jt]s$/u, (suffix) => suffix.startsWith(".m") ? ".d.mts" : ".d.cts").replace(/\.[jt]sx?$/u, ".d.ts");
  if (!(entry in types.files)) throw new Error("Verified entry declaration is missing.");
  const root = await realpath(input.projectRoot);
  const packageName = `@keel-modules/${input.name}`;
  const relative = `.keel/modules/${input.name}/${input.expectedOutput.slice(2)}`;
  const destination = path.join(root, relative);
  const link = path.join(root, "node_modules", "@keel-modules", input.name);
  // Refuse linked parent directories: installation must stay in this project.
  async function directory(relativePath: string) {
    let current = root;
    for (const segment of relativePath.split("/")) {
      current = path.join(current, segment);
      try { await mkdir(current); }
      catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
      const details = await lstat(current);
      if (!details.isDirectory() || details.isSymbolicLink()) throw new Error(`Module installation directory is not an ordinary directory: ${relativePath}`);
    }
  }
  await directory(relative);
  await directory("node_modules/@keel-modules");
  const files: Record<string, string | Uint8Array> = {
    "index.js": verified.outputBytes,
    "package.json": JSON.stringify({ name: packageName, version: verified.identity.version, type: "module",
      main: "./index.js", types: `./types/${entry}`,
      exports: { ".": { types: `./types/${entry}`, import: "./index.js" } } }, null, 2) + "\n",
    "keel-source-receipt.json": canonicalJson(verified.receipt) + "\n",
    "keel-build-recipe.json": canonicalJson(verified.recipe) + "\n",
    "keel-module-types.json": canonicalJson(types) + "\n",
    "keel-install.json": canonicalJson({ schema: "keel-module-install@1", packageName, origin: verified.origin,
      identity: verified.identity, output: verified.recipe.output.integrity, recipeDigest: verified.recipeDigest }) + "\n",
  };
  for (const [name, content] of Object.entries(types.files)) {
    if (name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === ".." || part === "." || part === "") || !/\.d\.(?:ts|mts|cts)$/u.test(name)) {
      throw new Error("Verified declaration has an unsafe installation path.");
    }
    files[`types/${name}`] = content;
  }
  // Existing destinations are immutable: retries verify bytes, never overwrite.
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(destination, name);
    await directory(path.relative(root, path.dirname(target)).split(path.sep).join("/"));
    try { await writeFile(target, content, { flag: "wx" }); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      const details = await lstat(target);
      if (!details.isFile() || details.isSymbolicLink()) throw new Error("Existing module installation is not an ordinary file.");
      const actual = await createIntegrity(new Uint8Array(await readFile(target)));
      const expected = await createIntegrity(typeof content === "string" ? new TextEncoder().encode(content) : content);
      if (actual.digest !== expected.digest) throw new Error(`Existing module installation differs: ${name}`);
    }
  }
  try { await symlink(path.relative(path.dirname(link), destination), link, "dir"); }
  catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    if (await realpath(link) !== destination) throw new Error(`Import ${packageName} is already occupied; no existing package was replaced.`);
  }
  return { packageName, directory: destination, importPath: packageName, output: verified.recipe.output.integrity,
    types: types.integrity, sourceCommit: verified.origin.commit };
}
