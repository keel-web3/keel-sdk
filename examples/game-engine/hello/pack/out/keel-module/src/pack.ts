import { defineAttribute, defineEntity, definePack } from "@keel/game-engine";

// A blob: a coloured disc with eyes. Its one socket is the top of its head.
const blob = defineEntity({
  id: "blob", body: "body/blob@1.0.0", choices: { hue: [0, 360], size: [0.4, 1] },
  build: (S, pins) => ({ hue: Number(pins["hue"] ?? S.between(0, 360)), size: Number(pins["size"] ?? S.between(0.4, 1)) }),
  sockets: (d) => ({ head: { pos: [0, d.size, 0], size: [d.size * 0.8, d.size * 0.4, d.size * 0.8] } }),
});
const tallBlob = defineEntity({
  id: "tall-blob", body: "body/blob@1.0.0",
  build: (S) => ({ hue: S.between(180, 260), size: S.between(0.9, 1.3) }),
  sockets: (d) => ({ head: { pos: [0, d.size * 1.4, 0], size: [d.size * 0.5, d.size * 0.3, d.size * 0.5] } }),
});
// A hat sized to whatever head it lands on.
const hat = defineAttribute({
  id: "party-hat", slot: "head", targets: [{ body: "body/blob@^1" }],
  build: (S, fit) => ({ w: fit.size[0], h: fit.size[1] * 1.6, hue: S.between(0, 360) }),
});

export const pack = definePack({ entities: [blob, tallBlob], attributes: [hat] });
