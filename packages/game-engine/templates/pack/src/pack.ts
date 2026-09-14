// The pack: every Builder asset in src/assets, sorted by what it is. Entities
// (characters, creatures) and attributes (wearables) are what other modules
// find by contract; objects (props) are handed out as they are.
import { definePack } from "@keel/game-engine";
import type { AnyAttributeDef, AnyEntityDef } from "@keel/game-engine";
import { assets } from "./assets/index.ts";

type Asset = { readonly type?: string; readonly id?: string; readonly body?: string };
const list = assets as readonly Asset[];
const entities = list.filter((a) => a?.type === "entity") as unknown as AnyEntityDef[];
const attributes = list.filter((a) => a?.type === "attribute") as unknown as AnyAttributeDef[];
/** Builder objects (props): not entities or attributes, so they ride along here. */
export const objects = list.filter((a) => a && a.type !== "entity" && a.type !== "attribute");
export const pack = definePack({ entities, attributes });
/** The contracts this pack provides: each entity's body, and wearables when it has attributes. */
export const provides = [...new Set([...entities.map((e) => e.body), ...(attributes.length ? ["attributes/wearable@1.0.0"] : [])])];
