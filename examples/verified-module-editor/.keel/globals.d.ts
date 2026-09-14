import "@keel/sdk/module";

declare module "@keel/sdk/module" {
  interface GlobalModules {
    "src/state.ts": typeof import("../src/state")["state"];
  }
}
