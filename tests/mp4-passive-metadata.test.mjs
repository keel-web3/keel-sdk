import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { mp4PassiveMetadataSpans } from "../packages/sdk/dist/mp4-passive-metadata.js";
import { scanKeelLinkGate } from "../packages/sdk/dist/link-gate.js";

const movie = readFileSync(new URL("./fixtures/registered-native-none/normal-artwork.mp4", import.meta.url));
const encoder = "http://www.videolan.org/x264.html";
const scan = bytes => scanKeelLinkGate({ route: "upload-plan", resources: [{ id: "original.mp4", bytes }] });
const box = (type, data) => { const header = Buffer.alloc(8); header.writeUInt32BE(data.length + 8); header.write(type, 4); return Buffer.concat([header, data]); };
function replaceDataReference(bytes) {
  const rows = [];
  for (let at = 0; at < bytes.length;) {
    const size = bytes.readUInt32BE(at), type = bytes.toString("latin1", at + 4, at + 8);
    assert.ok(size >= 8 && at + size <= bytes.length);
    let body = bytes.subarray(at + 8, at + size);
    if (["moov", "trak", "mdia", "minf", "dinf"].includes(type)) body = replaceDataReference(body);
    if (type === "dref") {
      // Real ISO data entry: self-contained flag cleared; external URL present.
      const prefix = Buffer.alloc(8); prefix.writeUInt32BE(1, 4);
      body = Buffer.concat([prefix, box("url ", Buffer.concat([Buffer.alloc(4), Buffer.from(encoder + "\0")]))]);
    }
    rows.push(box(type, body)); at += size;
  }
  return Buffer.concat(rows);
}

test("complete actual MP4 classifies passive AVC encoder metadata without changing bytes", () => {
  const before = Buffer.from(movie), report = scan(movie);
  assert.equal(report.status, "clear"); assert.deepEqual(movie, before);
  assert.ok(report.exemptions.some(row => row.url === encoder && row.reason === "passive-avc-user-data"));
  const changed = Buffer.from(movie), at = changed.indexOf(encoder);
  assert.ok(at > 0); changed.write("https://example.test/".padEnd(encoder.length, "x"), at);
  assert.equal(scan(changed).status, "clear", "classification is structural, not a trusted domain");
});
test("encoded complete containers retain the same narrow classification", () => {
  for (const bytes of [gzipSync(movie), Buffer.from(`data:video/mp4;base64,${movie.toString("base64")}`)]) {
    const report = scan(bytes); assert.equal(report.status, "clear");
    assert.ok(report.exemptions.some(row => row.reason === "passive-avc-user-data"));
  }
});
test("real external MP4 data references remain blocked even when matching the encoder URL", () => {
  // This fixture places moov after mdat, so growing dref does not alter offsets.
  const external = replaceDataReference(movie);
  assert.ok(mp4PassiveMetadataSpans(external).length, "sample table remains structurally valid");
  const report = scan(external);
  assert.equal(report.status, "blocked"); assert.ok(report.hits.some(hit => hit.url === encoder));
});
test("unreferenced, executable and unknown container locations never inherit passive authority", () => {
  for (const bytes of [Buffer.concat([movie, box("free", Buffer.from("\0" + encoder))]), Buffer.from(`<video src="${encoder}"></video>`), Buffer.from(encoder)]) {
    assert.equal(scan(bytes).status, "blocked");
  }
});
test("truncated containers and different SEI message types receive no exemption", () => {
  assert.deepEqual(mp4PassiveMetadataSpans(movie.subarray(0, movie.length - 1)), []);
  assert.equal(scan(movie.subarray(0, movie.length - 1)).status, "blocked");
  const changed = Buffer.from(movie), mdat = changed.indexOf("mdat"), firstNAL = mdat + 4 + 4;
  assert.equal(changed[firstNAL] & 31, 6); assert.equal(changed[firstNAL + 1], 5);
  changed[firstNAL + 1] = 4;
  assert.equal(scan(changed).status, "blocked");
});

test("malformed AVC configuration and NAL lengths cannot mint passive spans", () => {
  const avc = movie.indexOf("avcC"); assert.ok(avc > 0);
  for (const mutate of [
    bytes => { bytes[avc + 4] = 0; },
    bytes => { bytes[avc + 9] = 224; },
    bytes => { bytes.writeUInt32BE(0xffffffff, bytes.indexOf("mdat") + 4); },
  ]) {
    const changed = Buffer.from(movie); mutate(changed);
    assert.deepEqual(mp4PassiveMetadataSpans(changed), []);
    assert.equal(scan(changed).status, "blocked");
  }
});
