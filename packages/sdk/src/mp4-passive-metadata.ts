import { inspectVideoISO } from "./registered-native-none.js";

export interface PassiveMediaSpan { readonly start: number; readonly end: number }

/** Narrow byte classification, not a decoder or a MIME-based exemption.
 * Only H.264 user_data_unregistered (SEI type 5) inside samples reached through
 * a complete ISO BMFF sample table qualifies. No URL/domain is trusted.
 * Container references, other SEI types, unreferenced mdat bytes, free boxes,
 * appended text, malformed files and unsupported codecs receive no exemption.
 */
export function mp4PassiveMetadataSpans(bytes: Uint8Array): readonly PassiveMediaSpan[] {
  if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp") return [];
  const spans: PassiveMediaSpan[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = (): never => { throw new TypeError("Unqualified AVC metadata"); };
  let units = 0;
  try {
    inspectVideoISO(bytes, "video/mp4", (start, end, entry) => {
      if (entry.kind !== "avc1") return;
      let lengthSize = 0;
      for (let at = entry.body + 78; at < entry.end;) {
        if (at + 8 > entry.end) bad();
        const size = view.getUint32(at);
        if (size < 8 || size > entry.end - at) bad();
        if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === "avcC") {
          if (lengthSize || size < 15 || bytes[at + 8] !== 1) bad();
          lengthSize = (bytes[at + 12]! & 3) + 1;
          if (lengthSize === 3 || (bytes[at + 12]! & 252) !== 252 || (bytes[at + 13]! & 224) !== 224) bad();
          let cursor = at + 14;
          const parameters = (count: number, kind: number) => {
            if (!count) bad();
            for (let i = 0; i < count; i++) {
              if (cursor + 2 > at + size) bad();
              const length = view.getUint16(cursor); cursor += 2;
              if (!length || length > at + size - cursor || (bytes[cursor]! & 31) !== kind || (bytes[cursor]! & 128)) bad();
              cursor += length;
            }
          };
          parameters(bytes[at + 13]! & 31, 7);
          if (cursor >= at + size) bad();
          parameters(bytes[cursor++]!, 8);
          if (cursor < at + size) {
            if (![100, 110, 122, 144, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(bytes[at + 9]!) || cursor + 4 > at + size) bad();
            if ((bytes[cursor]! & 252) !== 252 || (bytes[cursor + 1]! & 248) !== 248 || (bytes[cursor + 2]! & 248) !== 248) bad();
            cursor += 3;
            const count = bytes[cursor++]!;
            if (count) parameters(count, 13);
          }
          if (cursor !== at + size) bad();
        }
        at += size;
      }
      if (!lengthSize) return;
      for (let at = start; at < end;) {
        if (++units > 1_000_000 || at + lengthSize > end) bad();
        let size = 0;
        for (let i = 0; i < lengthSize; i++) size = size * 256 + bytes[at + i]!;
        at += lengthSize;
        if (!size || size > end - at || (bytes[at]! & 128)) bad();
        const next = at + size;
        if ((bytes[at]! & 31) === 6) {
          if (bytes[at] !== 6) bad();
          // Remove emulation-prevention bytes while retaining original offsets.
          const rbsp: number[] = [], offsets: number[] = [];
          let zeros = 0;
          for (let i = at + 1; i < next; i++) {
            const value = bytes[i]!;
            if (zeros >= 2 && value === 3) {
              if (i + 1 >= next || bytes[i + 1]! > 3) bad();
              zeros = 0;
              continue;
            }
            if (zeros >= 2 && value <= 2) bad();
            rbsp.push(value); offsets.push(i);
            zeros = value === 0 ? zeros + 1 : 0;
          }
          let cursor = 0;
          const extended = () => {
            let value = 0, byte: number;
            do { if (cursor >= rbsp.length) return bad(); byte = rbsp[cursor++]!; value += byte; } while (byte === 255);
            return value;
          };
          while (cursor < rbsp.length - 1) {
            const type = extended(), length = extended();
            if (length > rbsp.length - 1 - cursor) bad();
            if (type === 5) {
              if (length < 16) bad();
              if (length > 16) spans.push({ start: offsets[cursor + 16]!, end: offsets[cursor + length - 1]! + 1 });
            }
            cursor += length;
          }
          if (cursor !== rbsp.length - 1 || rbsp[cursor] !== 128) bad();
        }
        at = next;
      }
    });
    return spans;
  } catch {
    // A late structural error invalidates every span gathered earlier.
    return [];
  }
}
