// Seeded streams (exact integer steps: the same on every machine).
function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
export function streamOf(text) {
  let a = hash(String(text)) || 1;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const weighted = (l) => { let s = 0; for (const [, w] of l) s += w; let r = f() * s; for (const [v, w] of l) { if ((r -= w) < 0) return v; } return l[l.length - 1][0]; };
  return { f, between: (x, y) => x + (y - x) * f(), int: (x, y) => x + Math.floor(f() * (y - x + 1)), pick: (l) => l[Math.floor(f() * l.length)], chance: (p) => f() < p, weighted };
}
