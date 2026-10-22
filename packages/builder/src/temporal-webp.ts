/** libwebp's movie encoder can infer the final delay from an earlier frame.
 * Assign the complete, already decoded source timeline to standard ANMF
 * duration fields. Pixel payloads and frame order remain byte-identical; the
 * caller must still decode every resulting frame and verify pixels/timing.
 * Format authority: https://developers.google.com/speed/webp/docs/riff_container
 * (RIFF padding/header; VP8X; ANIM; ANMF's 16-byte header and uint24 ms delay).
 * This narrowly accepts the pinned encoder's animation profile, not arbitrary
 * future WebP extensions or a replacement image decoder. */
export function assignTemporalWebPDelays(bytes: Uint8Array, timeline: {
  readonly frameTimesMs: readonly number[];
  readonly frameDurationsMs: readonly number[];
}): Uint8Array<ArrayBuffer> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > 256 * 1024 * 1024) throw new RangeError("The temporal WebP exceeds the bounded media byte budget.");
  const output = Uint8Array.from(bytes), view = new DataView(output.buffer);
  const fourCC = (offset: number) => String.fromCharCode(...output.subarray(offset, offset + 4));
  const uint24 = (offset: number) => output[offset]! + output[offset + 1]! * 256 + output[offset + 2]! * 65536;
  if (output.length < 12 || fourCC(0) !== "RIFF" || fourCC(8) !== "WEBP" || view.getUint32(4, true) + 8 !== output.length) throw new TypeError("The temporal encoder returned an invalid complete WebP container.");
  const delays = timeline.frameDurationsMs, times = timeline.frameTimesMs;
  if (!delays.length || delays.length > 1800 || delays.length !== times.length) throw new TypeError("Every bounded WebP frame needs its exact source timestamp and delay.");
  let next = 0;
  for (let i = 0; i < delays.length; i++) {
    const delay = delays[i]!;
    if (times[i] !== next || !Number.isSafeInteger(delay) || delay <= 0 || delay > 0xffffff) throw new TypeError("This source timeline cannot be represented exactly by WebP millisecond delays. Original retained.");
    next += delay;
  }
  const offsets: number[] = [];
  let position = 12, animation = false, extended = false, canvasWidth = 0, canvasHeight = 0;
  const once = new Set<string>();
  while (position < output.length) {
    if (position + 8 > output.length) throw new TypeError("The temporal WebP has a truncated chunk header.");
    const kind = fourCC(position), length = view.getUint32(position + 4, true), start = position + 8;
    if (length > output.length - start || start + length + (length & 1) > output.length) throw new TypeError("The temporal WebP has an incomplete chunk payload.");
    if ((length & 1) && output[start + length] !== 0) throw new TypeError("The temporal WebP has invalid RIFF padding.");
    if (!extended && kind !== "VP8X") throw new TypeError("The temporal WebP needs its exact extended header first.");
    if (kind !== "ANMF") {
      if (once.has(kind) || !["VP8X", "ICCP", "ANIM", "EXIF", "XMP "].includes(kind)) throw new TypeError("The temporal WebP contains duplicate or unsupported chunks.");
      once.add(kind);
    }
    if (kind === "VP8X") {
      if (position !== 12 || length !== 10 || !(output[start]! & 2) || (output[start]! & 0xc1)
        || output[start + 1] || output[start + 2] || output[start + 3]) throw new TypeError("The temporal WebP extended animation flags are invalid.");
      canvasWidth = uint24(start + 4) + 1; canvasHeight = uint24(start + 7) + 1;
      if (canvasWidth * canvasHeight > 0xffffffff) throw new TypeError("The temporal WebP canvas exceeds the format bound.");
      extended = true;
    }
    if (kind === "ICCP" && (animation || offsets.length)) throw new TypeError("The temporal WebP color profile is reordered.");
    if (kind === "ANIM") {
      if (animation || length !== 6 || offsets.length) throw new TypeError("The temporal WebP animation header is invalid or reordered.");
      animation = true;
    }
    if (kind === "ANMF") {
      if (!animation || length < 16 || once.has("EXIF") || once.has("XMP ") || (output[start + 15]! & 0xfc)
        || uint24(start) * 2 + uint24(start + 6) + 1 > canvasWidth
        || uint24(start + 3) * 2 + uint24(start + 9) + 1 > canvasHeight) throw new TypeError("The temporal WebP frame has no valid complete animation header.");
      let sub = start + 16, bitstream = false, alpha = false;
      while (sub < start + length) {
        if (sub + 8 > start + length) throw new TypeError("The temporal WebP frame has a truncated bitstream header.");
        const subKind = fourCC(sub), subLength = view.getUint32(sub + 4, true), subStart = sub + 8;
        if (subLength < 1 || subLength > start + length - subStart || subStart + subLength + (subLength & 1) > start + length
          || (subLength & 1) && output[subStart + subLength] !== 0) throw new TypeError("The temporal WebP frame has an incomplete padded bitstream.");
        if (subKind === "ALPH") {
          if (alpha || bitstream) throw new TypeError("The temporal WebP frame alpha is duplicate or reordered.");
          alpha = true;
        } else if (subKind === "VP8 " || subKind === "VP8L") {
          if (bitstream || subKind === "VP8L" && alpha) throw new TypeError("The temporal WebP frame bitstream is duplicate or incompatible.");
          bitstream = true;
        } else throw new TypeError("The temporal WebP frame has an unsupported bitstream chunk.");
        sub = subStart + subLength + (subLength & 1);
      }
      if (!bitstream) throw new TypeError("The temporal WebP frame has no complete image bitstream.");
      offsets.push(start + 12);
    }
    position = start + length + (length & 1);
  }
  if (!animation || offsets.length !== delays.length) throw new TypeError("The temporal WebP encoder omitted or merged source frames. Original retained.");
  offsets.forEach((offset, i) => {
    const delay = delays[i]!;
    output[offset] = delay & 255; output[offset + 1] = (delay >>> 8) & 255; output[offset + 2] = (delay >>> 16) & 255;
  });
  return output;
}
