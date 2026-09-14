//! Exact alpha runs prepared once per source layer. These are authoring data,
//! not extra onchain resources. No near-transparent pixel is discarded.
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Alpha {
    Empty,
    Opaque,
    Blend,
}
#[derive(Debug, Serialize)]
pub struct Run {
    pub start: usize,
    pub end: usize,
    pub alpha: Alpha,
}
#[derive(Debug, Serialize)]
pub struct LayerMap {
    pub rows: Vec<Vec<Run>>,
    pub pixels_by_alpha: [usize; 3],
}
fn class(a: u8) -> Alpha {
    match a {
        0 => Alpha::Empty,
        255 => Alpha::Opaque,
        _ => Alpha::Blend,
    }
}
pub fn analyze(bytes: &[u8], size: usize) -> LayerMap {
    assert_eq!(bytes.len(), size * size * 4);
    let mut counts = [0; 3];
    let rows = bytes
        .chunks_exact(size * 4)
        .map(|row| {
            let mut runs = Vec::new();
            let mut start = 0;
            while start < size {
                let alpha = class(row[start * 4 + 3]);
                let mut end = start + 1;
                while end < size && class(row[end * 4 + 3]) == alpha {
                    end += 1;
                }
                counts[match alpha {
                    Alpha::Empty => 0,
                    Alpha::Opaque => 1,
                    Alpha::Blend => 2,
                }] += end - start;
                runs.push(Run { start, end, alpha });
                start = end;
            }
            runs
        })
        .collect();
    LayerMap {
        rows,
        pixels_by_alpha: counts,
    }
}

/// Find the topmost opaque contributor first. Everything below it is invisible.
/// Apply remaining translucent contributors in their original bottom-up order:
/// regrouping alpha blends would change the original integer rounding.
pub fn composite(
    stack: &[usize],
    layers: &[Vec<u8>],
    maps: &[LayerMap],
    size: usize,
) -> (Vec<u8>, Vec<i16>) {
    assert!(!stack.is_empty() && stack.len() < i16::MAX as usize);
    assert_eq!(
        maps[stack[0]].pixels_by_alpha[1],
        size * size,
        "Opaque base required"
    );
    let mut floor = vec![-1i16; size * size];
    for (order, &index) in stack.iter().enumerate().rev() {
        for (y, row) in maps[index].rows.iter().enumerate() {
            for run in row.iter().filter(|r| r.alpha == Alpha::Opaque) {
                for slot in &mut floor[y * size + run.start..y * size + run.end] {
                    if *slot < 0 {
                        *slot = order as i16;
                    }
                }
            }
        }
    }
    assert!(floor.iter().all(|&v| v >= 0));
    let mut pixels = vec![0; size * size * 4];
    let mut owners = floor.clone();
    for (order, &index) in stack.iter().enumerate() {
        for (y, row) in maps[index].rows.iter().enumerate() {
            for run in row.iter().filter(|r| r.alpha != Alpha::Empty) {
                for x in run.start..run.end {
                    let p = y * size + x;
                    if (order as i16) < floor[p] {
                        continue;
                    }
                    let at = p * 4;
                    let src = &layers[index][at..at + 4];
                    let dst = &mut pixels[at..at + 4];
                    if run.alpha == Alpha::Opaque {
                        dst.copy_from_slice(src);
                    } else {
                        let a = src[3] as u32;
                        for c in 0..3 {
                            dst[c] =
                                ((src[c] as u32 * a + dst[c] as u32 * (255 - a) + 127) / 255) as u8;
                        }
                        owners[p] = -2;
                    }
                }
            }
        }
    }
    (pixels, owners)
}

/// Experimental scanline boundaries aligned to actual contributor transitions.
/// Small overlap pieces retain the current 16-pixel upper bound; opaque pieces
/// can span 256 pixels. Pixel filtering and exact-byte dedup remain unchanged.
pub fn spans(partition: &[i16]) -> Vec<(usize, usize)> {
    let mut result = Vec::new();
    let mut start = 0;
    while start < partition.len() {
        let owner = partition[start];
        let mut end = start + 1;
        while end < partition.len() && partition[end] == owner {
            end += 1;
        }
        let limit = if owner >= 0 { 256 } else { 16 };
        while start < end {
            let n = limit.min(end - start);
            result.push((start, n));
            start += n;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bidirectional_tiles_preserve_partial_edges_and_repeated_layers() {
        let size = 17;
        let layers: Vec<Vec<u8>> = (0..4)
            .map(|l| {
                (0..size * size)
                    .flat_map(|p| [
                        ((p * 17 + l * 71) % 256) as u8,
                        ((p * 39 + l * 83) % 256) as u8,
                        ((p * 13 + l * 29) % 256) as u8,
                        if l == 0 { 255 } else { [0, 1, 127, 254, 255][(p + l) % 5] },
                    ])
                    .collect()
            })
            .collect();
        let tokens = [
            crate::Token { id: 0, layers: vec![0, 1, 2, 3] },
            crate::Token { id: 1, layers: vec![0, 3, 2, 1] },
            crate::Token { id: 2, layers: vec![0, 1, 1, 0, 2] },
            crate::Token { id: 3, layers: vec![0] },
        ];
        let report = bidirectional_dependencies(&tokens.iter().collect::<Vec<_>>(), &layers, size);
        assert_eq!(report["allCompositesPixelExact"], true);
        assert_eq!(report["tileInstances"], 16);
        assert!(report["hiddenOrEmptyLayerTileVisits"].as_u64().unwrap() > 0);
    }
    #[test]
    fn preserves_hidden_layers_partial_edges_and_rounding() {
        // All alpha values, repeated stack entries, and opaque occluders.
        let size = 16;
        let layers: Vec<Vec<u8>> = (0..5)
            .map(|l| {
                (0..size * size)
                    .flat_map(|p| {
                        [
                            ((p * 17 + l * 71) % 256) as u8,
                            ((p * 39 + l * 83) % 256) as u8,
                            ((p * 13 + l * 29) % 256) as u8,
                            if l == 0 {
                                255
                            } else {
                                ((p + l * 31) % 256) as u8
                            },
                        ]
                    })
                    .collect()
            })
            .collect();
        let maps: Vec<_> = layers.iter().map(|l| analyze(l, size)).collect();
        for stack in [
            vec![0, 1, 2, 3, 4],
            vec![0, 4, 3, 2, 1],
            vec![0, 1, 1, 0, 2],
            vec![0],
        ] {
            let token = crate::Token {
                id: 0,
                layers: stack.clone(),
            };
            assert_eq!(
                composite(&stack, &layers, &maps, size),
                crate::composite(&token, &layers, size)
            );
        }
        assert_eq!(maps[1].pixels_by_alpha, [1, 1, 254]);
    }
    #[test]
    fn boundaries_cover_every_pixel_without_crossing_an_owner_change() {
        let mut partition = vec![0; 300];
        partition.extend(vec![-2; 35]);
        partition.extend(vec![2; 17]);
        let ranges = spans(&partition);
        assert_eq!(
            ranges,
            vec![
                (0, 256),
                (256, 44),
                (300, 16),
                (316, 16),
                (332, 3),
                (335, 17)
            ]
        );
        assert_eq!(
            ranges.iter().map(|(_, n)| n).sum::<usize>(),
            partition.len()
        );
    }
}

/// Source-level visibility and reusable prefix/suffix dependency analysis.
/// Positions are retained by the token map; keys describe exact tile content and
/// visible masks. A hash includes hidden tile bytes conservatively (missed reuse
/// is possible, false equality is not used to substitute pixels here).
pub fn bidirectional_dependencies(
    tokens: &[&crate::Token],
    layers: &[Vec<u8>],
    size: usize,
) -> serde_json::Value {
    use rayon::prelude::*;
    use std::collections::HashSet;
    let started = std::time::Instant::now();
    let side = size.div_ceil(16);
    struct Tile {
        hash: [u8; 32],
        active: [u64; 4],
        opaque: [u64; 4],
    }
    let tiles: Vec<Vec<Tile>> = layers
        .par_iter()
        .map(|layer| {
            (0..side * side)
                .map(|t| {
                    let (x, y) = ((t % side) * 16, (t / side) * 16);
                    let mut bytes = Vec::new();
                    let mut active = [0u64; 4];
                    let mut opaque = [0u64; 4];
                    for dy in 0..16.min(size - y) {
                        for dx in 0..16.min(size - x) {
                            let at = ((y + dy) * size + x + dx) * 4;
                            let p = &layer[at..at + 4];
                            let bit = dy * 16 + dx;
                            bytes.extend_from_slice(p);
                            if p[3] > 0 {
                                active[bit / 64] |= 1u64 << (bit % 64);
                            }
                            if p[3] == 255 {
                                opaque[bit / 64] |= 1u64 << (bit % 64);
                            }
                        }
                    }
                    Tile {
                        hash: *blake3::hash(&bytes).as_bytes(),
                        active,
                        opaque,
                    }
                })
                .collect()
        })
        .collect();
    let mut whole = HashSet::new();
    let mut prefixes = HashSet::new();
    let mut suffixes = HashSet::new();
    let (mut uses, mut contributors, mut hidden, mut single, mut prefix_uses, mut suffix_uses) =
        (0usize, 0usize, 0usize, 0usize, 0usize, 0usize);
    for token in tokens {
        let (expected, _) = crate::composite(token, layers, size);
        let mut actual = vec![0u8; size * size * 4];
        for t in 0..side * side {
            let (x, y) = ((t % side) * 16, (t / side) * 16);
            let mut covered = [0u64; 4];
            let mut visible = Vec::new();
            for &layer in token.layers.iter().rev() {
                let tile = &tiles[layer][t];
                let mut mask = [0u64; 4];
                for k in 0..4 {
                    mask[k] = tile.active[k] & !covered[k];
                    covered[k] |= tile.opaque[k];
                }
                if mask.iter().all(|&v| v == 0) {
                    hidden += 1;
                    continue;
                }
                visible.push((layer, mask));
            }
            visible.reverse();
            uses += 1;
            contributors += visible.len();
            if visible.len() == 1 {
                single += 1;
            }
            let descriptors: Vec<[u8; 32]> = visible
                .iter()
                .map(|(layer, mask)| {
                    let mut h = blake3::Hasher::new();
                    h.update(&tiles[*layer][t].hash);
                    for v in mask {
                        h.update(&v.to_le_bytes());
                    }
                    *h.finalize().as_bytes()
                })
                .collect();
            let mut h = blake3::Hasher::new();
            for d in &descriptors {
                h.update(d);
                prefixes.insert(*h.finalize().as_bytes());
                prefix_uses += 1;
            }
            whole.insert(*h.finalize().as_bytes());
            let mut h = blake3::Hasher::new();
            for d in descriptors.iter().rev() {
                h.update(d);
                suffixes.insert(*h.finalize().as_bytes());
                suffix_uses += 1;
            }
            // Re-render using only top-down-proven visible contributors, preserving
            // the original bottom-up source-over order and integer rounding.
            for (layer, mask) in visible {
                for dy in 0..16.min(size - y) {
                    for dx in 0..16.min(size - x) {
                        let bit = dy * 16 + dx;
                        if mask[bit / 64] & (1u64 << (bit % 64)) == 0 {
                            continue;
                        }
                        let at = ((y + dy) * size + x + dx) * 4;
                        let src = &layers[layer][at..at + 4];
                        let dst = &mut actual[at..at + 4];
                        let a = src[3] as u32;
                        if a == 255 {
                            dst.copy_from_slice(src);
                        } else {
                            assert_eq!(dst[3], 255, "This fixture needs an opaque base");
                            for c in 0..3 {
                                dst[c] = ((src[c] as u32 * a + dst[c] as u32 * (255 - a) + 127)
                                    / 255) as u8;
                            }
                        }
                    }
                }
            }
        }
        assert_eq!(
            actual, expected,
            "Bidirectional visibility changed token {}",
            token.id
        );
    }
    serde_json::json!({"tokens":tokens.len(),"size":size,"tileSize":16,"tileInstances":uses,"visibleContributors":contributors,"hiddenOrEmptyLayerTileVisits":hidden,"singleContributorTiles":single,"uniqueWholeDependencies":whole.len(),"prefixUses":prefix_uses,"uniqueBottomUpPrefixes":prefixes.len(),"suffixUses":suffix_uses,"uniqueTopDownSuffixes":suffixes.len(),"allCompositesPixelExact":true,"seconds":started.elapsed().as_secs_f64(),"scope":"Offline original-source dependency and visibility analysis. Prefix/suffix counts are not compressed-byte or gas savings. Authored layer order is preserved; normal source-over with opaque bases only."})
}
