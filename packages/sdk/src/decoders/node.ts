/** Host-only scanner for an exact declared LZMA-alone byte commitment.
 * Browser boot uses the cooperative adapter instead. Unknown output lengths
 * are never inferred from compressed data or allocated without a commitment.
 */
import { createLzmaTask } from './vendor/lzma.js';
export interface KeelCommittedSyncDecodeOptions {
  readonly decodedByteLength: number;
  readonly maxDecodedBytes?: number;
  readonly maxWork?: number;
}
export function decodeLzmaCommittedSync(bytes: Uint8Array, options: KeelCommittedSyncDecodeOptions): Uint8Array {
  const bound = (value: number, maximum: number, label: string) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError(`${label} exceeds host decoder bounds`);
    return value;
  };
  const maxDecodedBytes = bound(options.maxDecodedBytes ?? 32 * 1024 * 1024, 32 * 1024 * 1024, 'decoded limit');
  const decodedByteLength = bound(options.decodedByteLength, maxDecodedBytes, 'decoded length');
  const maxDictionaryBytes = 4 * 1024 * 1024;
  bound(bytes.byteLength, maxDecodedBytes + maxDictionaryBytes, 'stored length');
  const maxWork = bound(options.maxWork ?? Math.max(65536, decodedByteLength * 16 + bytes.byteLength * 8), 2 ** 32, 'work limit');
  const task = createLzmaTask(bytes, { decodedByteLength, maxDictionaryBytes, maxWork });
  while (!task.done) task.step(2048);
  return task.bytes;
}
