// Generate the same authoring outputs users export, for compilation/real local RPC parity.
import {mkdir,writeFile} from 'node:fs/promises';
import {createSVGRendererRecipe,prepareSVGRenderer,previewSVGRenderer} from '../packages/sdk/dist/svg-renderer-authoring.js';
const root=process.argv[2];if(!root)throw Error('Pass the isolated Foundry harness directory.');
await mkdir(`${root}/src`,{recursive:true});
const recipes=[];
for(const preset of ['orbit','blocks','blank']){const recipe={...createSVGRendererRecipe(preset),name:preset[0].toUpperCase()+preset.slice(1)+'Renderer'};const prepared=prepareSVGRenderer(recipe);await writeFile(`${root}/src/${prepared.fileName}`,prepared.solidity);recipes.push({preset,recipe,previews:['1','2','255'].map(tokenId=>({tokenId,...previewSVGRenderer(recipe,tokenId)}))});}
await writeFile(`${root}/artifacts/renderer-recipes.json`,JSON.stringify(recipes,null,2));
await writeFile(`${root}/test/SVGAuthoring.t.sol`, `// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;
import {ERC721A} from "erc721a/contracts/ERC721A.sol";
import {TestBase} from "@fray-tests/TestBase.sol";
import {OrbitRenderer} from "../src/OrbitRenderer.sol";
import {BlocksRenderer} from "../src/BlocksRenderer.sol";
import {BlankRenderer} from "../src/BlankRenderer.sol";
contract SVGAuthoringCollection is ERC721A {
 constructor() ERC721A("Renderer test", "ART") {}
 function _startTokenId() internal pure override returns(uint256){return 1;}
 function mint() external {_mint(msg.sender, 255);}
}
contract SVGAuthoringTest is TestBase {
 function testAllGeneratedRenderersCompileAndRejectMissingToken() public {
  SVGAuthoringCollection nft = new SVGAuthoringCollection();
  OrbitRenderer orbit = new OrbitRenderer(address(nft));
  BlocksRenderer blocks = new BlocksRenderer(address(nft));
  BlankRenderer blank = new BlankRenderer(address(nft));
  vm.expectRevert();orbit.svg(1);nft.mint();
  assertTrue(bytes(orbit.svg(1)).length>0);assertTrue(bytes(blocks.svg(255)).length>0);assertTrue(bytes(blank.svg(2)).length>0);
  assertTrue(address(orbit).code.length<=24576);assertTrue(address(blocks).code.length<=24576);assertTrue(address(blank).code.length<=24576);
  assertTrue(keccak256(bytes(orbit.svg(1)))!=keccak256(bytes(orbit.svg(2))));
 }
}
`);
console.log('Prepared orbit, blocks and blank renderer compilation/parity fixtures.');
