import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient({ defaultOptions: { queries: {
  // Local state changes through explicit mutations. Focus must not restart expensive IPC reads.
  staleTime: Infinity, retry: false, refetchOnWindowFocus: false,
} } });
export const api = (name: string, value?: unknown) => window.keel.request(name, value);
