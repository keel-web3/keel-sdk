// (Its own module so the builder worker can use it without bundling zod.)
/** A short hash of an op list's JSON (FNV-1a): the open build's and the saved file's, compared for "unsaved". */
export function opsHash(ops) {
  const text = JSON.stringify(ops ?? []);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}
