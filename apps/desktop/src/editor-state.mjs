/** Compare JSON state without allocating copies of every source file on each keystroke. */
export function sameState(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameState(item, right[index]));
  }
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  return keys.length === otherKeys.length && keys.every((key) => Object.hasOwn(right, key) && sameState(left[key], right[key]));
}

/** Ignore asynchronous results once the form that requested them has changed. */
export function latestRequest() {
  let version = 0;
  return {
    invalidate() { version++; },
    async run(load, accept) {
      const current = ++version;
      try {
        const result = await load();
        if (current === version) accept(result);
      } catch (error) {
        if (current === version) throw error;
      }
    },
  };
}
