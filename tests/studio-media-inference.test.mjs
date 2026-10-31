import assert from "node:assert/strict";
import test from "node:test";
import { inferMediaType, inferRole } from "../packages/studio-core/dist/media.js";
import { KEEL_ASSET_DISPLAY_MEDIA_TYPES } from "../packages/sdk/dist/asset-display.js";

const media = {
  png: "image/png", apng: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
  wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4",
  mp4: "video/mp4", m4v: "video/x-m4v", webm: "video/webm",
};
for (const [extension, mime] of Object.entries(media)) {
  test(`extension-only ${extension} resolves its supported viewer MIME and role`, () => {
    assert.ok(KEEL_ASSET_DISPLAY_MEDIA_TYPES.includes(mime));
    for (const declared of [undefined, "", "application/octet-stream"]) {
      for (const path of [`art.${extension}`, `folder/art.${extension.toUpperCase()}`]) {
        assert.equal(inferMediaType(path, declared), mime);
        assert.equal(inferRole(inferMediaType(path, declared), path), mime.split("/")[0]);
      }
    }
  });
}
test("inference preserves declared types and executable/model identities without inventing a viewer", () => {
  for (const [extension, mime] of Object.entries({html:"text/html", js:"text/javascript", mjs:"text/javascript", wasm:"application/wasm", glb:"model/gltf-binary", gltf:"model/gltf+json", obj:"model/obj", mov:"video/quicktime"})) {
    assert.equal(inferMediaType(`art.${extension}`), mime);
  }
  assert.equal(inferMediaType("art.wav", "audio/custom"), "audio/custom");
  assert.equal(inferMediaType("art.unknown"), "application/octet-stream");
});
