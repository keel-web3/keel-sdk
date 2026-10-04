/** Browser-safe, cooperative decoders for verified KEEL resources.
 * The caller must verify stored bytes/dictionary SHA-256 before decoding, and
 * verify decoded SHA-256 before mounting. A length is an allocation commitment.
 */
import { createBrotliTask } from './vendor/brotli.js';
import { createLzmaTask } from './vendor/lzma.js';

export interface KeelDecodeOptions {
  readonly decodedByteLength: number;
  readonly maxDecodedBytes?: number;
  readonly maxDictionaryBytes?: number;
  readonly maxWork?: number;
  readonly workPerYield?: number;
  readonly dictionary?: Uint8Array;
  readonly signal?: AbortSignal;
  /** A real task boundary, never merely a resolved Promise. */
  readonly yieldTask?: () => Promise<void>;
}
export type KeelDecodeCodec = 'brotli' | 'lzma';
interface DecodeTask { readonly done: boolean; readonly bytes: Uint8Array; step(work: number): void; }
function integer(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError(`${label} exceeds decoder bounds`);
  return value;
}
async function decode(factory: (bytes: Uint8Array, options: Record<string, unknown>) => DecodeTask, bytes: Uint8Array, options: KeelDecodeOptions): Promise<Uint8Array> {
  const maxDecodedBytes = integer(options.maxDecodedBytes ?? 32 * 1024 * 1024, 'decoded limit', 256 * 1024 * 1024);
  const decodedByteLength = integer(options.decodedByteLength, 'decoded length', maxDecodedBytes);
  const maxDictionaryBytes = integer(options.maxDictionaryBytes ?? 4 * 1024 * 1024, 'dictionary limit', 64 * 1024 * 1024);
  integer(bytes.byteLength, 'stored length', maxDecodedBytes + maxDictionaryBytes);
  if (options.dictionary) integer(options.dictionary.byteLength, 'shared dictionary length', maxDictionaryBytes);
  const maxWork = integer(options.maxWork ?? Math.max(65536, decodedByteLength * 16 + bytes.byteLength * 8), 'work limit', 2 ** 32);
  const workPerYield = integer(options.workPerYield ?? 2048, 'work per yield', 65536);
  if (!workPerYield) throw new RangeError('work per yield must be positive');
  const checkAbort = () => { if (options.signal?.aborted) throw options.signal.reason ?? new Error('KEEL decode aborted'); };
  // Reuse one channel per decode: actual event-loop tasks without timer clamping.
  let channel: MessageChannel | undefined;
  let pending: (() => void) | undefined;
  const yieldTask = options.yieldTask ?? (() => new Promise<void>((resolve) => {
    if (typeof MessageChannel !== 'function') { setTimeout(resolve, 0); return; }
    if (!channel) {
      channel = new MessageChannel();
      channel.port1.onmessage = () => { const next = pending; pending = undefined; next?.(); };
    }
    pending = resolve;
    channel.port2.postMessage(0);
  }));
  checkAbort();
  const task = factory(bytes, { decodedByteLength, maxDictionaryBytes, maxWork, dictionary: options.dictionary });
  try {
    while (!task.done) {
      checkAbort();
      task.step(workPerYield);
      if (!task.done) await yieldTask();
    }
    checkAbort();
    return task.bytes;
  } finally { channel?.port1.close(); channel?.port2.close(); }
}
export const decodeBrotli = (bytes: Uint8Array, options: KeelDecodeOptions): Promise<Uint8Array> => {
  if (options.dictionary) throw new TypeError('Raw Brotli dictionaries require a verified protocol and decoder profile not enabled here');
  return decode(createBrotliTask, bytes, options);
};
export const decodeLzma = (bytes: Uint8Array, options: KeelDecodeOptions): Promise<Uint8Array> => {
  if (options.dictionary) throw new TypeError('LZMA-alone has no external dictionary dependency');
  return decode(createLzmaTask, bytes, options);
};
export const decodeKeelResource = (codec: KeelDecodeCodec, bytes: Uint8Array, options: KeelDecodeOptions): Promise<Uint8Array> => {
  if (codec === 'brotli') return decodeBrotli(bytes, options);
  if (codec === 'lzma') return decodeLzma(bytes, options);
  throw new TypeError(`Unsupported KEEL decoder codec: ${String(codec)}`);
};

export { KEEL_DECODER_PROVENANCE } from './provenance.js';
