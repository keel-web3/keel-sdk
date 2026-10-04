/** Internal library stubs have bytecode but no callable dispatch surface. */
export function compiledDeployableNames(solFile, artifact) {
  const name = solFile.split('/').at(-1).replace(/\.sol$/, '');
  const code = artifact?.bytecode?.object;
  if (typeof code !== 'string' || code.replace(/^0x/, '').length === 0) return [];
  const definition = artifact.ast?.nodes?.find(node => node.nodeType === 'ContractDefinition' && node.name === name);
  const library = definition?.contractKind === 'library' || solFile.startsWith('libraries/');
  if (library) {
    const selectors = artifact.methodIdentifiers ?? artifact.evm?.methodIdentifiers;
    const callable = (Array.isArray(artifact.abi) && artifact.abi.some(item => item.type === 'function'))
      || (selectors && typeof selectors === 'object' && Object.keys(selectors).length > 0);
    if (!callable) return [];
  }
  return [name];
}
