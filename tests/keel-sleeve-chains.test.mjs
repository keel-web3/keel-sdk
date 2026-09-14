import test from "node:test";
import assert from "node:assert/strict";

const { keelTokenJSONURI, keelMetadataResolverAbi } = await import(
  process.env.KEEL_SLEEVE_TEST_MODULE ?? "../packages/sdk/dist/keel-sleeve.js"
);
const target = "0x000000000000000000000000000000000000bEEF";

test("explicit EVM chains preserve target and token independently", () => {
  for (const chainId of [1n, 8453n, 42161n, (1n << 256n) - 1n]) {
    for (const tokenId of [0n, 7n, (1n << 256n) - 1n]) {
      assert.equal(keelTokenJSONURI({ chainId, contract: target, tokenId }),
        `web3://${target.toLowerCase()}:${chainId}/tokenJSON/${tokenId}`);
    }
  }
});

test("zero and negative chain targets cannot silently resolve to another network", () => {
  for (const chainId of [0n, -1n]) {
    assert.throws(() => keelTokenJSONURI({ chainId, contract: target, tokenId: 0 }));
  }
  assert.throws(() => keelTokenJSONURI({ chainId: 1, contract: `0x${"0".repeat(40)}`, tokenId: 0 }));
});

test("minimal ABI exposes both local default and explicit chain routes", () => {
  assert.ok(keelMetadataResolverAbi.includes("function erc4804URI(uint256 tokenId) view returns (string)"));
  assert.ok(keelMetadataResolverAbi.includes("function erc4804URIOnChain(address target, uint256 chainId, uint256 tokenId) pure returns (string)"));
});
