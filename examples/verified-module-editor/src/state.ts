import { declareGlobals } from "@keel/sdk/module";

/** Shared state. The compiler assigns this script its namespace. */
export const state = declareGlobals({ captures: 0, label: "hero" });
