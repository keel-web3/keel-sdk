// Typed-array conveniences shared by the existing parser and browser shell.
// No Node globals, builtins, or environment-dependent implementations.
export class Bytes extends Uint8Array {
  static from(value, encoding) {
    if (typeof value !== 'string') return new Bytes(value);
    if (encoding !== 'hex') return new Bytes(new TextEncoder().encode(value));
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(value)) throw Error('invalid hex');
    return new Bytes(value.match(/../g)?.map(x => parseInt(x, 16)) ?? []);
  }
  static alloc(n) { return new Bytes(n); }
  static isBytes(x) { return x instanceof Uint8Array; }
  static byteLength(s) { return new TextEncoder().encode(s).length; }
  static concat(parts) {
    const result = new Bytes(parts.reduce((n, x) => n + x.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  }
  static compare(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  }
  equals(other) { return Bytes.compare(this, other) === 0; }
  copy(target, offset = 0) { target.set(this, offset); }
  toString(encoding = 'utf8') {
    if (encoding === 'base64') return btoa(Array.from(this, x => String.fromCharCode(x)).join(''));
    return encoding === 'hex' ? Array.from(this, x => x.toString(16).padStart(2, '0')).join('') : new TextDecoder().decode(this);
  }
  view() { return new DataView(this.buffer, this.byteOffset, this.byteLength); }
  readUInt16BE(offset = 0) { return this.view().getUint16(offset); }
  readUInt16LE(offset = 0) { return this.view().getUint16(offset, true); }
  readUInt32BE(offset = 0) { return this.view().getUint32(offset); }
  readUInt32LE(offset = 0) { return this.view().getUint32(offset, true); }
  readBigUInt64BE(offset = 0) { return this.view().getBigUint64(offset); }
  readBigUInt64LE(offset = 0) { return this.view().getBigUint64(offset, true); }
  uint32(n) { if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw RangeError('u32 range'); return n; }
  uint64(n) { if (typeof n !== 'bigint' || n < 0n || n > 0xffffffffffffffffn) throw RangeError('u64 range'); return n; }
  writeUInt32BE(n, offset = 0) { this.view().setUint32(offset, this.uint32(n)); }
  writeUInt32LE(n, offset = 0) { this.view().setUint32(offset, this.uint32(n), true); }
  writeBigUInt64BE(n, offset = 0) { this.view().setBigUint64(offset, this.uint64(n)); }
  writeBigUInt64LE(n, offset = 0) { this.view().setBigUint64(offset, this.uint64(n), true); }
}
