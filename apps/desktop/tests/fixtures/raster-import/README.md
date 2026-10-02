# Real Fox raster sprite fixtures

These are data-only KEEL-STYLED-ASSET v5 packages compiled from the Khronos Fox sample's real skinned animation. They contain quantized RGBA sprite frames and clip/camera metadata, with no source mesh, rig, or textures.

- `fox-walk.keelasset`: the converter's emitted 64 × 64 Pixel result, Walk clip, 6 sampled frames, one view. SHA-256: `aabc1f6fb28177635713d6d3977a39c6d7d732882565ee974b16c1cda782a0bb`
- `fox-walk-four-views.keelasset`: 32 × 32, Walk clip, 3 frames per view, four camera directions
- `fox-rest-four-views.keelasset`: 32 × 32, rest pose, one frame per view, four camera directions

All three use `compileRasterStyledAsset` with the same normalized Fox native package (SHA-256 `acd663332abef65b20e314887ed305f71229987c94ff25a77c96707fbd513a5f`), paletteSize 16, kind `pixel`, screen `bayer4`, and the default azimuth 0.65, elevation 0.25 and diffuse shading. The first uses name `Fox Walk Sprite`, resolution 64, FPS 8, directions 1, clipIndex 1. The latter two use names matching their file stems, resolution 32, FPS 4, directions 4, and clipIndex 1 and null respectively. No time range override is supplied. The encoder chooses the smallest supported recipe. The SDK checks the actual packages through its worker, trusted importer, preview dispatch, and generated project loader.

Fox is CC BY 4.0. Model by [PixelMannen](https://opengameart.org/content/fox-and-shiba), animation by [tomkranis](https://sketchfab.com/3d-models/low-poly-fox-by-pixelmannen-animated-371dea88d7e04a76af5763f2a36866bc), with contributions from [AsoboStudio and scurest](https://github.com/KhronosGroup/glTF-Sample-Models/pull/150#issuecomment-406300118). The same attribution is retained in each package. Conversion changes: sampled fixed camera views and skeletal poses, rasterized flat diffuse shading, downsampled resolution, quantized RGB palette; transparent alpha retained.
