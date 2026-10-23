/*!
 * basE91 algorithm Copyright (c) 2000-2006 Joachim Henke. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 * - Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 * - Neither the name of Joachim Henke nor the names of his contributors may
 *   be used to endorse or promote products derived from this software without
 *   specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
/** Lossless binary-to-text carriage. Storage and compression are independent.
 * base91-v1 follows Henke's basE91. base90-v1 is KEEL's explicitly versioned
 * variant: printable ASCII, excluding double quote, backslash, percent and hash.
 * Pair coding uses 12/13 bits (threshold 4003), rather than basE91's 13/14.
 * HTML script delimiters must still be escaped by the enclosing serializer.
 * See docs/KEEL_DENSE_TRANSPORT.md for the format and BSD attribution.
 */
export type KeelDenseTransportProfile = "base90-v1" | "base91-v1" | "base90-block-v2" | "uri81-block-v1";
export const KEEL_BASE90_ALPHABET = "!$&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~";
export const KEEL_BASE91_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"';
const MAX_BYTES = 4 * 1024 * 1024;

/** Every symbol is literal-safe at both direct data URI and JSON boundaries.
 * Version 1: 19 source bytes, 24 least-significant-first radix-81 digits.
 * Final blocks have exactly ceil(8*n/log2(81)) digits; overflow is rejected.
 */
export const KEEL_URI81_ALPHABET = "!$&'()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";
const URI81_DIGITS = [0,2,3,4,6,7,8,9,11,12,13,14,16,17,18,19,21,22,23,24] as const;
function encodeURI81(bytes: Uint8Array): string {
  let text = "";
  const words = new Uint32Array(5);
  for (let offset = 0; offset < bytes.length; offset += 19) {
    const count = Math.min(19, bytes.length - offset), size = URI81_DIGITS[count]!;
    words.fill(0);
    for (let i = 0; i < count; i++) {
      const shift = count - 1 - i;
      words[shift >> 2]! |= bytes[offset + i]! << ((shift & 3) * 8);
    }
    for (let digit = 0; digit < size; digit++) {
      let carry = 0;
      for (let w = 4; w >= 0; w--) {
        const value = words[w]! + carry * 4294967296, quotient = Math.floor(value / 81);
        words[w] = quotient; carry = value - quotient * 81;
      }
      text += KEEL_URI81_ALPHABET[carry]!;
    }
  }
  return text;
}

/** Specialized browser entry, so other dense decoders need not ship with URI81.
 * Limbs and carries stay below 2^53; no BigInt or host-dependent endian access.
 */
export function decodeKeelURI81Transport(text: string, options: {
  readonly profile: KeelDenseTransportProfile; readonly byteLength: number;
}): Uint8Array {
  const length = options.byteLength;
  if (options.profile !== "uri81-block-v1") throw new TypeError("Unsupported URI81 transport profile.");
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BYTES || typeof text !== "string"
      || text.length !== Math.floor(length / 19) * 24 + URI81_DIGITS[length % 19]!) {
    throw new RangeError("URI81 text length exceeds its committed byte bound.");
  }
  const lookup = new Int16Array(128).fill(-1), words = new Uint32Array(5), out = new Uint8Array(length);
  for (let i = 0; i < 81; i++) lookup[KEEL_URI81_ALPHABET.charCodeAt(i)] = i;
  let cursor = 0;
  for (let offset = 0; offset < length; offset += 19) {
    const count = Math.min(19, length - offset), size = URI81_DIGITS[count]!;
    words.fill(0);
    for (let i = size - 1; i >= 0; i--) {
      const code = text.charCodeAt(cursor + i);
      let carry = code < 128 ? lookup[code]! : -1;
      if (carry < 0) throw new TypeError("Invalid URI81 transport character.");
      for (let w = 0; w < 5; w++) {
        const value = words[w]! * 81 + carry;
        words[w] = value; carry = Math.floor(value / 4294967296);
      }
      if (carry) throw new RangeError("Noncanonical URI81 block overflow.");
    }
    const top = (count - 1) >> 2, highBits = ((count - 1) & 3) * 8 + 8;
    if (words[top]! >= 2 ** highBits || words.subarray(top + 1).some(word => word !== 0)) {
      throw new RangeError("Noncanonical URI81 block overflow.");
    }
    for (let i = 0; i < count; i++) {
      const shift = count - 1 - i;
      out[offset + i] = words[shift >> 2]! >>> ((shift & 3) * 8);
    }
    cursor += size;
  }
  return out;
}

function parameters(profile: KeelDenseTransportProfile) {
  if (profile === "base90-v1") return { alphabet: KEEL_BASE90_ALPHABET, radix: 90, bits: 12, mask: 4095, threshold: 4003 };
  if (profile === "base91-v1") return { alphabet: KEEL_BASE91_ALPHABET, radix: 91, bits: 13, mask: 8191, threshold: 88 };
  throw new TypeError("Unsupported KEEL dense transport profile.");
}
export function encodeKeelDenseTransport(bytes: Uint8Array, profile: KeelDenseTransportProfile): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES) throw new RangeError("Dense transport input exceeds its byte bound.");
  if (profile === "uri81-block-v1") return encodeURI81(bytes);
  if(profile === "base90-block-v2") {
    let text="";
    for(let start=0;start<bytes.length;start+=4) {
      const count=Math.min(4,bytes.length-start);let value=0;
      for(let i=0;i<count;i++)value=value*256+bytes[start+i]!;
      for(let i=0;i<=count;i++){text+=KEEL_BASE90_ALPHABET[value%90]!;value=Math.floor(value/90);}
    }
    return text;
  }
  const { alphabet, radix, bits, mask, threshold } = parameters(profile);
  let queue = 0, count = 0, text = "";
  for (const byte of bytes) {
    queue |= byte << count; count += 8;
    if (count > bits) {
      let value = queue & mask;
      const take = value > threshold ? bits : bits + 1;
      if (take > bits) value = queue & (mask * 2 + 1);
      queue >>>= take; count -= take;
      text += alphabet[value % radix]! + alphabet[Math.floor(value / radix)]!;
    }
  }
  if (count) {
    text += alphabet[queue % radix]!;
    if (count > 7 || queue >= radix) text += alphabet[Math.floor(queue / radix)]!;
  }
  return text;
}
/** Reject foreign characters, oversized input/output and nonzero tail bits.
 * Exact committed length bounds allocation. Callers also verify the stored SHA.
 */
export function decodeKeelLegacyDenseTransport(text: string, options: {
  readonly profile: KeelDenseTransportProfile;
  readonly byteLength: number;
}): Uint8Array {
  if(options.profile === "base90-block-v2") {
    const length=options.byteLength;
    if(!Number.isSafeInteger(length)||length<0||length>MAX_BYTES||typeof text!=="string"||text.length!==Math.floor(length/4)*5+(length%4?length%4+1:0))throw new RangeError("Invalid Base90 block commitment.");
    const lookup=new Int16Array(128).fill(-1);for(let i=0;i<90;i++)lookup[KEEL_BASE90_ALPHABET.charCodeAt(i)]=i;
    const out=new Uint8Array(length);let cursor=0;
    for(let start=0;start<length;start+=4){const count=Math.min(4,length-start);let value=0,mult=1;
      for(let i=0;i<=count;i++){const digit=lookup[text.charCodeAt(cursor++)]??-1;if(digit<0)throw new TypeError("Invalid Base90 block digit.");value+=digit*mult;mult*=90;}
      if(value>=256**count)throw new RangeError("Noncanonical Base90 block overflow.");
      for(let i=count-1;i>=0;i--){out[start+i]=value%256;value=Math.floor(value/256);}
    }
    return out;
  }
  const { alphabet, radix, bits, mask, threshold } = parameters(options.profile);
  const length = options.byteLength;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BYTES || typeof text !== "string"
      || text.length > 2 * Math.ceil(length * 8 / bits) + 2 || (!length && text.length)) throw new RangeError("Dense transport exceeds its byte bound.");
  const lookup = new Int16Array(128).fill(-1);
  for (let index = 0; index < radix; index++) lookup[alphabet.charCodeAt(index)] = index;
  const output = new Uint8Array(length);
  let queue = 0, count = 0, previous = -1, cursor = 0;
  const emit = (value: number) => {
    if (cursor >= length) throw new RangeError("Dense transport exceeds its committed length.");
    output[cursor++] = value;
  };
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index), digit = code < 128 ? lookup[code]! : -1;
    if (digit < 0) throw new TypeError("Invalid dense transport character.");
    if (previous < 0) previous = digit;
    else {
      const value = previous + digit * radix;
      queue |= value << count; count += (value & mask) > threshold ? bits : bits + 1;
      while (count > 7) { emit(queue & 255); queue >>>= 8; count -= 8; }
      previous = -1;
    }
  }
  if (previous >= 0) { queue |= previous << count; emit(queue & 255); queue >>>= 8; }
  if (cursor !== length || queue !== 0) throw new RangeError("Dense transport length or tail bits do not match its commitment.");
  return output;
}

/** Existing format versions retain their decoding rules. */
export function decodeKeelDenseTransport(text: string, options: {
  readonly profile: KeelDenseTransportProfile; readonly byteLength: number;
}): Uint8Array {
  return options.profile === "uri81-block-v1" ? decodeKeelURI81Transport(text, options)
    : decodeKeelLegacyDenseTransport(text, options);
}

export const KEEL_DENSE_TRANSPORT_LICENSE = "basE91 algorithm Copyright (c) 2000-2006 Joachim Henke. All rights reserved.\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are met:\n- Redistributions of source code must retain the above copyright notice,\n  this list of conditions and the following disclaimer.\n- Redistributions in binary form must reproduce the above copyright notice,\n  this list of conditions and the following disclaimer in the documentation\n  and/or other materials provided with the distribution.\n- Neither the name of Joachim Henke nor the names of his contributors may\n  be used to endorse or promote products derived from this software without\n  specific prior written permission.\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\"\nAND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE\nIMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE\nARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE\nLIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR\nCONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF\nSUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS\nINTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN\nCONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)\nARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE\nPOSSIBILITY OF SUCH DAMAGE.";

/** JSON placed directly in a script text node; no quoted-HTML embedding. */
export function serializeKeelDenseTransportJSON(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError("Dense transport JSON is not serializable.");
  return text.replace(/<(?=\/script|script|!--)/giu, "\\u003c")
    .replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}
/** RFC 2397 imports RFC 2396 urlchar. JSON, HTML and binary carriage
 * do not make excluded URI characters safe. Question marks are valid data.
 */
const URI_LITERAL = /^[A-Za-z0-9\-_.!~*'();/?:@&=+$,]$/u;
export function toKeelDenseTransportDataURL(kind: "html" | "metadata", text: string): string {
  if ((kind !== "html" && kind !== "metadata") || typeof text !== "string") throw new TypeError("Invalid dense transport data-URI input.");
  let encoded = "";
  for (const character of text) encoded += URI_LITERAL.test(character) ? character : encodeURIComponent(character);
  return `data:${kind === "html" ? "text/html" : "application/json"};charset=utf-8,${encoded}`;
}

/** Inspection also supports existing browser-readable noncompliant returns.
 * Publication separately rejects them instead of treating playback as URI proof.
 */
export function inspectKeelDataURICompatibility(uri: string) {
  if (typeof uri !== "string" || !uri.startsWith("data:") || uri.indexOf(",") < 5) throw new TypeError("Expected a self-contained data URI.");
  const comma = uri.indexOf(","), header = uri.slice(0, comma), body = uri.slice(comma + 1);
  const examples = new Set<string>(); let unsafeLiteralCount = 0, malformedEscapeCount = 0;
  if (!/;base64$/iu.test(header)) for (let i = 0; i < body.length; i++) {
    const character = body[i]!;
    if (character === "%" && /^[0-9A-Fa-f]{2}$/u.test(body.slice(i + 1, i + 3))) i += 2;
    else if (character === "%") malformedEscapeCount++;
    else if (!URI_LITERAL.test(character)) { unsafeLiteralCount++; if (examples.size < 32) examples.add(character); }
  }
  return Object.freeze({ strictURICompatible: unsafeLiteralCount === 0 && malformedEscapeCount === 0,
    unsafeLiteralCount, unsafeLiteralExamples: [...examples], malformedEscapeCount });
}
export function assertKeelDataURICompatibility(uri: string, label: string): void {
  const result = inspectKeelDataURICompatibility(uri);
  if (!result.strictURICompatible) throw new TypeError(`${label} contains unescaped URI characters or malformed escapes. Browser playback is not strict URI compatibility; prepare both metadata and HTML boundaries before upload.`);
}

/** Decode a committed prepared dense fragment through the metadata percent,
 * JSON-string and HTML percent boundaries. Generic fragment policy stays strict.
 */
export function decodeKeelPreparedDenseCopyFragment(bytes: Uint8Array): Uint8Array {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const percent = (text: string): string => {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 37) {
        if (!/^[0-9A-F]{2}$/u.test(text.slice(i + 1, i + 3))) throw new TypeError("Invalid prepared dense percent escape.");
        i += 2;
      } else if (code <= 32 || code >= 127 || code === 35) throw new TypeError("Unsafe prepared dense literal byte.");
    }
    return decodeURIComponent(text);
  };
  const quoted = percent(decoder.decode(bytes));
  const htmlPercent: unknown = JSON.parse('"' + quoted + '"');
  if (typeof htmlPercent !== "string") throw new TypeError("Invalid prepared dense JSON fragment.");
  return new TextEncoder().encode(percent(htmlPercent));
}
