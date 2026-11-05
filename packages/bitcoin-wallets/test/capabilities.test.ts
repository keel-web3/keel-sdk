import { describe, expect, it } from "vitest";
import { flows, liveCapabilities, mockedCapabilities, wallets } from "../src/capabilities.js";

describe("wallet capability evidence", () => {
  it("records every flow for every wallet", () => {
    for (const wallet of wallets) for (const flow of flows) {
      expect(["supported", "unsupported", "untested"]).toContain(mockedCapabilities[wallet][flow]);
      expect(liveCapabilities[wallet][flow]).toBe("untested");
    }
  });
  it("keeps unsupported boundaries explicit", () => {
    for (const wallet of wallets) expect(mockedCapabilities[wallet].genericScriptPath).toBe("unsupported");
    for (const wallet of ["leather", "magic-eden"] as const) expect(mockedCapabilities[wallet].dualRoleBip322).toBe("unsupported");
    expect(mockedCapabilities.xverse.testnet3).toBe("unsupported");
    expect(mockedCapabilities.xverse.testnet4).toBe("unsupported");
    expect(mockedCapabilities.unisat.testnet4).toBe("supported");
    expect(liveCapabilities.unisat.testnet4).toBe("untested");
  });
});
