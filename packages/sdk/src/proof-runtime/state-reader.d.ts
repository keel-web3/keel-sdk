export function createApprovedProofStateReader(options: Record<string, unknown>): {
  request(input: { readonly method: string; readonly params?: readonly unknown[]; readonly signal?: AbortSignal }): Promise<unknown>;
  close(): void;
};
