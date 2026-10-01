import type { GenerativeRedesignService } from './generative-redesign-service.mjs';
import { redesignIdInput, redesignPreviewInput, redesignRequestInput } from './generative-redesign-service.mjs';

// Main owns the authenticated editor IPC boundary and the tRPC instance.
// These operations are intentionally not registered as model-callable tools.
export function generativeRedesignProcedures(t: { procedure: any }, service: () => GenerativeRedesignService) {
  return {
    gameRedesignReference: t.procedure.query(() => service().reference()),
    gameRedesignGenerate: t.procedure.input(redesignRequestInput).mutation(({ input }: { input: unknown }) => service().generate(input)),
    gameRedesignPreview: t.procedure.input(redesignPreviewInput).mutation(({ input }: { input: unknown }) => service().preview(input)),
    gameRedesignAccept: t.procedure.input(redesignIdInput).mutation(({ input }: { input: unknown }) => service().accept(input)),
    gameRedesignCancel: t.procedure.input(redesignIdInput).mutation(({ input }: { input: unknown }) => service().cancel(input)),
  };
}
