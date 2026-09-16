// NOCTURNES' room, read as a mood: what its scoreOf(g) read off a genome --
// the theme (or, for a room set by hand, the theme its things fit), a floor
// room's corner, the palette's hue and harmony, what's out the window, the
// picture's loop, the candles and fans and screens in the room -- handed to
// the engine's scoreOf. scoreOf(moodOfNocturnes(g)) is NOCTURNES' plan byte
// for byte (tests/audio-equality.test.mjs checks tokens 1..300, rooms without
// a theme and every pin).

import { BANDS, streamOf } from "./score.js";

// A floor room's corner, over its theme.
export const KIT_BAND = {
  "Music Corner": { keys: [["guitar", 3], ["rhodes", 1]], lead: [["guitar", 1], ["vibes", 1]], feel: [["brushed", 2], ["soft", 1]] },
  "Media Corner": { lead: [["chip", 2], ["kalimba", 1]], feel: [["boombap", 2], ["chip", 1]], tempo: [78, 93], scratch: 0.7 },
  "Reading Corner": { keys: [["felt", 2], ["piano", 1]], feel: [["soft", 2], ["brushed", 1]] },
  Stargazing: { keys: [["rhodes", 2], ["vibes", 1]], lead: [["celesta", 1], ["kalimba", 1]], feel: [["soft", 2]], vox: 0.5 },
  "Teen Room": { lead: [["chip", 2], ["guitar", 1]], feel: [["boombap", 3]], tempo: [80, 93], scratch: 0.9 },
  "Summer Night": { keys: [["felt", 1], ["guitar", 2]], lead: [["musicbox", 1], ["kalimba", 1]], feel: [["brushed", 2]] },
};
// A room set by hand has no theme: what's in it says which record it is.
const ANCHOR_KIT = { tv: "Media Corner", guitar: "Music Corner", telescope: "Stargazing", fan: "Summer Night", speaker: "Teen Room", amp: "Teen Room", chair: "Reading Corner", plant: "Reading Corner", lamp: "Reading Corner" };
// What's out the window, under the record.
export const WEATHER = {
  Rain: ["rain"], Snow: ["hush", "chimes"], City: ["traffic"], Skyscraper: ["traffic", "wind"], Town: ["traffic", "hush"],
  Suburb: ["crickets", "car"], CountryRoad: ["crickets", "car"], Sea: ["waves"], Cruise: ["waves"],
  Fog: ["hush"], Aurora: ["shimmer"], Space: ["shimmer"], Moon: ["hush"], Stars: ["hush"],
  Hills: ["crickets"], Dusk: ["hush"], Void: ["hush"], Vaporwave: ["hush"],
};
export const DARK = { Rain: 0.35, Fog: 0.4, Void: 0.3, Stars: 0.5, Moon: 0.6, Space: 0.55, Aurora: 0.6 };
// Which mode the palette's harmony sounds like.
export const SCHEME_MODE = {
  Nocturne: "aeolian", Monochrome: "dorian", Duotone: "dorian", "Two Worlds": "mixolydian", Triad: "lydian",
  Split: "aeolian", "Neon Noir": "dorian", Spectrum: "lydian", Prism: "ionian",
};
// NOCTURNES' themes as far as the music needs them: [name, heroes, company] ([realm, key] each), in its order.
const THEME_ITEMS = [
  ["Late Shift", [["Desk", "lamp"], ["Still Life", "Houseplant"], ["Decor", "photo"], ["Decor", "flipclock"]], [["Still Life", "Mug"], ["Desk", "energy"], ["Decor", "pencils"], ["Still Life", "Houseplant"], ["Desk", "smartphone"], ["Decor", "calendar"]]],
  ["Retro Den", [["Relic", "console"], ["Relic", "gamepad"], ["Relic", "cartridge"]], [["Relic", "gamepad"], ["Relic", "soda"], ["Relic", "cartridge"], ["Relic", "cases"], ["Relic", "joystick"], ["Relic", "floppies"]]],
  ["Candlelight", [["Occult", "candles"], ["Still Life", "Light"]], [["Decor", "vase"], ["Still Life", "Book"], ["Still Life", "Drink"], ["Still Life", "Flowers"]]],
  ["Bedside", [["Relic", "clockRadio"], ["Desk", "lamp"], ["Decor", "flipclock"]], [["Still Life", "Vessel"], ["Relic", "phone"], ["Relic", "glasses"], ["Still Life", "Book"], ["Desk", "lamp"], ["Relic", "watch"], ["Relic", "analogWatch"], ["Desk", "smartphone"]]],
  ["The Reading", [["Occult", "crystalBall"], ["Occult", "tarot"], ["Occult", "board"], ["Occult", "orrery"]], [["Occult", "candles"], ["Occult", "tarot"], ["Occult", "incense"], ["Occult", "runes"], ["Occult", "pendulum"], ["Occult", "skull"]]],
  ["Night Desk", [["Desk", "lamp"], ["Decor", "globe"], ["Decor", "flipclock"]], [["Still Life", "Book"], ["Still Life", "Mug"], ["Decor", "pencils"], ["Decor", "photo"], ["Decor", "calendar"], ["Decor", "rolodex"], ["Decor", "stapler"]]],
  ["Game Night", [["Relic", "handheldLine"], ["Relic", "console"], ["Relic", "handheld"], ["Relic", "tamagotchi"]], [["Relic", "controller"], ["Relic", "cartridge"], ["Relic", "cases"], ["Relic", "soda"], ["Desk", "energy"], ["Relic", "cards"]]],
  ["Nightcap", [["Still Life", "Drink"], ["Still Life", "Vessel"]], [["Desk", "ashtray"], ["Relic", "lighter"], ["Relic", "phone"], ["Still Life", "Plate"], ["Desk", "keys"], ["Desk", "wallet"]]],
  ["Collector", [["Relic", "bobble"], ["Relic", "robot"], ["Relic", "vinyl"], ["Relic", "troll"], ["Relic", "dino"]], [["Relic", "vinyl"], ["Relic", "robot"], ["Relic", "dino"], ["Relic", "troll"], ["Relic", "duck"], ["Relic", "blister"], ["Relic", "cards"]]],
  ["Green Sill", [["Still Life", "Houseplant"], ["Still Life", "Flowers"], ["Decor", "vase"]], [["Still Life", "Mug"], ["Still Life", "Houseplant"], ["Still Life", "Book"], ["Decor", "cat"], ["Decor", "diffuser"]]],
  ["Mixtape", [["Relic", "boombox"], ["Relic", "walkman"], ["Relic", "discman"]], [["Relic", "cassette"], ["Relic", "headphones"], ["Relic", "cases"], ["Relic", "cd"], ["Relic", "player"]]],
];

/** The theme a handful of things belongs to (NOCTURNES' themeForItems): heroes count 2, company 1, ties to the seed; null under 1. */
export function themeForItems(items, S) {
  let best = null;
  let bestScore = 0;
  for (const [name, hero, company] of THEME_ITEMS) {
    let score = 0;
    for (const it of items) {
      if (hero.some(([r, k]) => r === it.realm && k === it.key)) score += 2;
      else if (company.some(([r, k]) => r === it.realm && k === it.key)) score += 1;
    }
    score += S.f() * 0.5; // (a tie goes to the seed)
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return bestScore >= 1 ? best : null;
}

function themeOfScene(g) {
  if (g.canvas?.theme && g.canvas.theme !== "Loose") return g.canvas.theme;
  if (g.setting === "Workstation") return g.monitor?.crt ? "Retro Den" : "Late Shift";
  if (g.setting === "Floor") return "A Room";
  const items = (g.placements ?? []).map((pl) => ({ realm: pl.obj.realm, key: pl.obj.key }));
  return themeForItems(items, streamOf(`${g.seed}|theme`)) ?? "Loose";
}
function kitOfScene(g) {
  if (g.setting !== "Floor") return null;
  const pls = g.placements ?? [];
  const anchor = pls.find((pl) => pl.obj.kitRole === "anchor") ?? pls.find((pl) => pl.obj.realm === "Floor");
  return (anchor && ANCHOR_KIT[anchor.obj.key]) ?? g.canvas?.kit ?? null;
}

/** A NOCTURNES genome as a mood (its recipe.music as pins; "theme" is the band pin). */
export function moodOfNocturnes(g) {
  const o = g.recipe?.music ?? {};
  const theme = themeOfScene(g);
  const view = g.view?.kind ?? "Stars";
  const has = (re) => (g.placements ?? []).some((pl) => re.test(`${pl.obj.form ?? ""} ${pl.obj.family ?? ""}`));
  const room = [];
  if (has(/Candle|Incense|Censer|Lantern|Lighter/)) room.push("crackle");
  if (has(/Fan/)) room.push("fan");
  if (has(/TV|Television|CRT|Monitor/) || g.setting === "Workstation") room.push("hum");
  const { theme: bandPin, ...rest } = o;
  return {
    seed: g.seed, name: theme,
    band: { ...(BANDS[theme] ?? {}), ...(KIT_BAND[kitOfScene(g)] ?? {}) },
    hue: g.palette?.hue ?? g.palette?.ramps?.key?.hues?.[0],
    mode: SCHEME_MODE[g.palette?.scheme], eclipse: Boolean(g.view?.eclipse),
    picture: ((g.frames ?? 48) * (g.delay ?? 9)) / 100,
    view, weather: WEATHER[view] ?? ["hush"], room, dark: DARK[view] ?? 0.72,
    space: g.setting === "Floor" ? 0.08 : 0,
    pins: { ...rest, ...(bandPin ? { band: bandPin } : {}) },
  };
}

