export interface CanonicalSolidityArtifact {
  readonly sourceName: string;
  readonly contractName: string;
  readonly compiler: string;
  readonly creationBytes: number;
  readonly runtimeBytes: number;
  readonly abi: readonly unknown[];
  readonly bytecode: `0x${string}`;
  readonly deployedBytecode: `0x${string}`;
  readonly linkReferences: Readonly<Record<string, Readonly<Record<string, readonly { readonly start: number; readonly length: number }[]>>>>;
  readonly deployedLinkReferences: Readonly<Record<string, Readonly<Record<string, readonly { readonly start: number; readonly length: number }[]>>>>;
  readonly immutableReferences: Readonly<Record<string, unknown>>;
  readonly methodIdentifiers: Readonly<Record<string, string>>;
  readonly metadata: string;
}

export interface CanonicalSolidityCompilation {
  readonly compilerVersion: string;
  readonly diagnostics: readonly unknown[];
  readonly artifacts: ReadonlyMap<string, CanonicalSolidityArtifact>;
  readonly summary: readonly {
    readonly sourceName: string;
    readonly contractName: string;
    readonly creationBytes: number;
    readonly runtimeBytes: number;
  }[];
}

export const EIP170_MAX_RUNTIME_BYTES: number;
export const SOLIDITY_COMPILER_SETTINGS: {
  readonly evmVersion: "prague";
  readonly optimizerRuns: 50;
  readonly viaIR: true;
  readonly bytecodeHash: "none";
  readonly appendCBOR: false;
};
export function compileCanonicalSolidityArtifacts(
  repositoryRoot?: string,
  options?: {
    readonly contractNames?: readonly string[];
    readonly sourceNames?: readonly string[];
    readonly contractsRoot?: string;
  },
): Promise<CanonicalSolidityCompilation>;
