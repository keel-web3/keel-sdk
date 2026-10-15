import { readFileSync } from 'node:fs';
import path from 'node:path';

// ABI entries form a set; declaration order differs between actual Solc and
// Forge artifacts. Parameter, result and tuple arrays remain ordered data.
const stable = value => Array.isArray(value) ? value.map(stable)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export function canonicalAbiEntries(abi) {
  if (!Array.isArray(abi)) throw new TypeError('A compiled ABI must be an array.');
  return abi.map(entry => ({ entry, key: JSON.stringify(stable(entry)) }))
    .sort((left, right) => left.key.localeCompare(right.key)).map(value => value.entry);
}

/** An explicit test harness may supply actual compiler outputs and retain its
 * receipt separately. The default remains the canonical sibling out directory. */
export function readCompiledContractAbi(contractsRoot, name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new TypeError('Invalid compiled contract name.');
  const directory = process.env.KEEL_CONTRACTS_ARTIFACTS_DIR ?? path.join(contractsRoot, 'out');
  const artifact = JSON.parse(readFileSync(path.resolve(directory, `${name}.sol`, `${name}.json`), 'utf8'));
  if (!Array.isArray(artifact.abi)) throw new TypeError('The actual compiler artifact has no ABI.');
  return artifact.abi;
}
