//! Local feasibility worker. The source manifest fixes original token identities.
//! This is not a publisher or an implementation of arbitrary authoring blend modes.
mod layer_map;
use flate2::{Compress, Compression, FlushCompress};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Cursor,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
    time::Instant,
};

type Hash = [u8; 32];
#[derive(Deserialize)]
struct Layer {
    rgba: String,
}
#[derive(Deserialize)]
struct Token {
    id: u32,
    layers: Vec<usize>,
}
#[derive(Deserialize)]
struct Input {
    size: usize,
    layers: Vec<Layer>,
    tokens: Vec<Token>,
    #[serde(rename = "sourcePNGBytes")]
    source_bytes: usize,
}
struct Chunk {
    bytes: Vec<u8>,
    adler: u32,
    raw_len: usize,
}
#[derive(Default)]
struct Catalog {
    ids: HashMap<Hash, u32>,
    chunks: Vec<Chunk>,
}
struct Band {
    choices: [Vec<u32>; 2],
    unique: [Vec<u32>; 2],
    selected: usize,
}
struct Project {
    id: u32,
    bands: Vec<Band>,
    pixel_hash: Hash,
    reference_checked: bool,
}
fn hash(b: &[u8]) -> Hash {
    *blake3::hash(b).as_bytes()
}
fn adler(b: &[u8]) -> u32 {
    let (mut a, mut sum) = (1u32, 0u32);
    for part in b.chunks(5552) {
        for &v in part {
            a += v as u32;
            sum += a;
        }
        a %= 65521;
        sum %= 65521;
    }
    (sum << 16) | a
}
fn combine(a: u32, b: u32, n: usize) -> u32 {
    let lo = ((a & 65535) as u64 + (b & 65535) as u64 + 65520) % 65521;
    let hi =
        ((a >> 16) as u64 + (b >> 16) as u64 + (n as u64 % 65521) * ((a & 65535) as u64 + 65520))
            % 65521;
    ((hi as u32) << 16) | lo as u32
}
fn png_chunk(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut b = Vec::with_capacity(body.len() + 12);
    b.extend_from_slice(&(body.len() as u32).to_be_bytes());
    b.extend_from_slice(kind);
    b.extend_from_slice(body);
    let crc = crc32fast::hash(&b[4..]);
    b.extend_from_slice(&crc.to_be_bytes());
    b
}
fn header(size: usize, channels: usize) -> Vec<u8> {
    let mut b = vec![137, 80, 78, 71, 13, 10, 26, 10];
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&(size as u32).to_be_bytes());
    ihdr.extend_from_slice(&(size as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, if channels == 3 { 2 } else { 6 }, 0, 0, 0]);
    b.extend(png_chunk(b"IHDR", &ihdr));
    b.extend(png_chunk(b"sRGB", &[0]));
    b.extend(png_chunk(b"IDAT", &[0x78, 0x9c]));
    b
}
fn footer(sum: u32) -> Vec<u8> {
    let mut end = vec![3, 0];
    end.extend_from_slice(&sum.to_be_bytes());
    let mut b = png_chunk(b"IDAT", &end);
    b.extend(png_chunk(b"IEND", &[]));
    b
}
fn decoded(bytes: &[u8]) -> Vec<u8> {
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let mut reader = decoder.read_info().unwrap();
    let mut out = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut out).unwrap();
    assert_eq!(info.bit_depth, png::BitDepth::Eight);
    out.truncate(info.buffer_size());
    match info.color_type {
        png::ColorType::Rgba => out,
        png::ColorType::Rgb => out
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        other => panic!("Unexpected PNG color type: {other:?}"),
    }
}
fn register(raw: &[u8], shared: &Mutex<Catalog>, local: &mut HashMap<Hash, u32>) -> u32 {
    let key = hash(raw);
    if let Some(&id) = local.get(&key) {
        return id;
    }
    if let Some(&id) = shared.lock().unwrap().ids.get(&key) {
        local.insert(key, id);
        return id;
    }
    let compressed = if raw == [2] {
        vec![0, 1, 0, 254, 255, 2]
    } else {
        let mut c = Compress::new(Compression::best(), false);
        let mut b = Vec::with_capacity(raw.len() * 2 + 128);
        c.compress_vec(raw, &mut b, FlushCompress::Sync).unwrap();
        assert_eq!(c.total_in(), raw.len() as u64);
        b
    };
    let chunk = Chunk {
        bytes: png_chunk(b"IDAT", &compressed),
        adler: adler(raw),
        raw_len: raw.len(),
    };
    let mut cat = shared.lock().unwrap();
    let id = if let Some(&id) = cat.ids.get(&key) {
        id
    } else {
        let id = u32::try_from(cat.chunks.len()).unwrap();
        cat.chunks.push(chunk);
        cat.ids.insert(key, id);
        id
    };
    local.insert(key, id);
    id
}
fn composite(token: &Token, layers: &[Vec<u8>], size: usize) -> (Vec<u8>, Vec<i16>) {
    // All recovered Gators have an opaque painted first layer. Explicitly prove
    // that precondition instead of silently changing transparent compositing.
    let mut pixels = layers[token.layers[0]].clone();
    assert!(
        pixels.chunks_exact(4).all(|p| p[3] == 255),
        "Nonopaque base needs the general compositor"
    );
    let mut owners = vec![0i16; size * size];
    for (order, &index) in token.layers.iter().enumerate().skip(1) {
        for (i, (dst, src)) in pixels
            .chunks_exact_mut(4)
            .zip(layers[index].chunks_exact(4))
            .enumerate()
        {
            let a = src[3] as u32;
            if a == 0 {
                continue;
            }
            if a == 255 {
                dst.copy_from_slice(src);
                owners[i] = order as i16;
            } else {
                for c in 0..3 {
                    dst[c] = ((src[c] as u32 * a + dst[c] as u32 * (255 - a) + 127) / 255) as u8;
                }
                owners[i] = -2;
            }
        }
    }
    (pixels, owners)
}
fn filtered_strip(pixels: &[u8], size: usize, y: usize, rows: usize, channels: usize) -> Vec<u8> {
    let stride = size * channels;
    let mut out = Vec::with_capacity(rows * (stride + 1));
    for row in y..y + rows {
        let start = row * stride;
        let (mut sub_score, mut up_score) = (0u64, 0u64);
        for x in 0..stride {
            let v = pixels[start + x];
            let sub = v.wrapping_sub(if x >= channels {
                pixels[start + x - channels]
            } else {
                0
            });
            let up = v.wrapping_sub(if row > y {
                pixels[start + x - stride]
            } else {
                0
            });
            sub_score += (sub as u16).min(256 - sub as u16) as u64;
            up_score += (up as u16).min(256 - up as u16) as u64;
        }
        let up = row > y && up_score < sub_score;
        out.push(if up { 2 } else { 1 });
        for x in 0..stride {
            let previous = if up {
                pixels[start + x - stride]
            } else if x >= channels {
                pixels[start + x - channels]
            } else {
                0
            };
            out.push(pixels[start + x].wrapping_sub(previous));
        }
    }
    out
}
fn spans(x: usize, count: usize, partition: &[i16], out: &mut Vec<(usize, usize)>) {
    let first = partition[x];
    if count <= 16 || (first >= 0 && partition[x..x + count].iter().all(|&v| v == first)) {
        out.push((x, count));
    } else {
        let left = count / 2;
        spans(x, left, partition, out);
        spans(x + left, count - left, partition, out);
    }
}
fn prepare(
    token: &Token,
    layers: &[Vec<u8>],
    size: usize,
    channels: usize,
    cat: &Mutex<Catalog>,
    local: &mut HashMap<Hash, u32>,
    maps: Option<&[layer_map::LayerMap]>,
) -> Project {
    let (pixels, owners) = if let Some(maps) = maps {
        let result = layer_map::composite(&token.layers, layers, maps, size);
        assert_eq!(
            result,
            composite(token, layers, size),
            "Layer-map visibility changed original pixels or owners"
        );
        result
    } else {
        composite(token, layers, size)
    };
    let pixel_hash = hash(&pixels);
    let reference = Path::new("apps/desktop/artifacts/gator-raster-study/adaptive-1080/references")
        .join(format!("{}.png", token.id));
    let reference_checked = reference.exists();
    if reference_checked {
        assert!(
            pixels == decoded(&fs::read(reference).unwrap()),
            "Native compositor differs from the independent original reference for {}",
            token.id
        );
    }
    let pixels = if channels == 3 {
        assert!(
            pixels.chunks_exact(4).all(|p| p[3] == 255),
            "RGB requires an opaque finished image"
        );
        pixels
            .chunks_exact(4)
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect::<Vec<u8>>()
    } else {
        pixels
    };
    let direct_pixels = std::env::var("KEEL_NATIVE_NO_UP").is_ok();
    let marker = register(&[if direct_pixels { 0 } else { 2 }], cat, local);
    let mut bands = Vec::new();
    let stride = size * channels;
    for y in (0..size).step_by(16) {
        let rows = 16.min(size - y);
        let mut refs = Vec::new();
        for row in y..y + rows {
            refs.push(marker);
            let mut partition = owners[row * size..(row + 1) * size].to_vec();
            if row > 0 && !direct_pixels {
                for x in 0..size {
                    if partition[x] != owners[(row - 1) * size + x] {
                        partition[x] = -2;
                    }
                }
            }
            let mut ranges = Vec::new();
            if maps.is_some() {
                ranges = layer_map::spans(&partition);
            } else {
                for x in (0..size).step_by(256) {
                    spans(x, 256.min(size - x), &partition, &mut ranges);
                }
            }
            for (x, n) in ranges {
                let start = row * stride + x * channels;
                let raw: Vec<u8> = (0..n * channels)
                    .map(|i| {
                        pixels[start + i].wrapping_sub(if row > 0 && !direct_pixels {
                            pixels[start + i - stride]
                        } else {
                            0
                        })
                    })
                    .collect();
                refs.push(register(&raw, cat, local));
            }
        }
        let strip = register(
            &filtered_strip(&pixels, size, y, rows, channels),
            cat,
            local,
        );
        let choices = [refs, vec![strip]];
        let unique = choices.each_ref().map(|c| {
            let mut v = c.clone();
            v.sort_unstable();
            v.dedup();
            v
        });
        bands.push(Band {
            choices,
            unique,
            selected: 1,
        });
    }
    Project {
        id: token.id,
        bands,
        pixel_hash,
        reference_checked,
    }
}
fn score(projects: &[Project], chunks: &[Chunk], baseline: bool) -> usize {
    let mut active = HashSet::new();
    let mut maps = 0;
    for p in projects {
        for b in &p.bands {
            let choice = if baseline { 1 } else { b.selected };
            maps += b.choices[choice]
                .iter()
                .map(|&id| chunks[id as usize].bytes.len().div_ceil(23000) * 4)
                .sum::<usize>();
            active.extend(b.unique[choice].iter().copied());
        }
    }
    maps + active
        .iter()
        .map(|&id| {
            let n = chunks[id as usize].bytes.len();
            n + 24 * n.div_ceil(23000)
        })
        .sum::<usize>()
}
fn select(projects: &mut [Project], chunks: &[Chunk]) -> serde_json::Value {
    let mut potential = vec![0usize; chunks.len()];
    let mut used = vec![0usize; chunks.len()];
    let cost = |id: u32| {
        let n = chunks[id as usize].bytes.len();
        n + 24 * n.div_ceil(23000)
    };
    for p in projects.iter() {
        for b in &p.bands {
            let ids: HashSet<u32> = b.unique.iter().flatten().copied().collect();
            for id in ids {
                potential[id as usize] += 1;
            }
        }
    }
    for p in projects.iter_mut() {
        for b in &mut p.bands {
            let scores = b.choices.each_ref().map(|c| {
                c.iter()
                    .map(|&id| chunks[id as usize].bytes.len().div_ceil(23000) * 4)
                    .sum::<usize>() as f64
            });
            let mut totals = [scores[0], scores[1]];
            for c in 0..2 {
                for &id in &b.unique[c] {
                    totals[c] += cost(id) as f64 / potential[id as usize] as f64;
                }
            }
            b.selected = if totals[1] <= totals[0] { 1 } else { 0 };
            for &id in &b.unique[b.selected] {
                used[id as usize] += 1;
            }
        }
    }
    let mut changes = 0;
    for _ in 0..4 {
        let mut changed = 0;
        for p in projects.iter_mut() {
            for b in &mut p.bands {
                let current = b.selected;
                for &id in &b.unique[current] {
                    used[id as usize] -= 1;
                }
                let marginal = |c: usize| {
                    b.choices[c]
                        .iter()
                        .map(|&id| chunks[id as usize].bytes.len().div_ceil(23000) * 4)
                        .sum::<usize>()
                        + b.unique[c]
                            .iter()
                            .filter(|&&id| used[id as usize] == 0)
                            .map(|&id| cost(id))
                            .sum::<usize>()
                };
                if marginal(1 - current) < marginal(current) {
                    b.selected = 1 - current;
                    changed += 1;
                }
                for &id in &b.unique[b.selected] {
                    used[id as usize] += 1;
                }
            }
        }
        changes += changed;
        if changed == 0 {
            break;
        }
    }
    let baseline = score(projects, chunks, true);
    let fallback = score(projects, chunks, false) > baseline;
    if fallback {
        for p in projects.iter_mut() {
            for b in &mut p.bands {
                b.selected = 1;
            }
        }
    }
    json!({"baselineBytes":baseline,"selectedBytes":score(projects,chunks,false),"fallback":fallback,"improvements":changes})
}
fn main() {
    let start = Instant::now();
    let input: Input = serde_json::from_slice(
        &fs::read("apps/desktop/artifacts/gator-raster-study/full-1080/input.json").unwrap(),
    )
    .unwrap();
    assert_eq!(input.size, 1080);
    let channels = if std::env::var("KEEL_NATIVE_RGB").is_ok() {
        3
    } else {
        4
    };
    let layer_maps = std::env::var("KEEL_NATIVE_LAYER_MAP").is_ok();
    let sample = std::env::var("KEEL_NATIVE_SAMPLE").is_ok();
    let sample_ids: HashSet<u32> = if sample {
        serde_json::from_slice::<Vec<u32>>(
            &fs::read("apps/desktop/artifacts/gator-raster-study/sample-ids.json").unwrap(),
        )
        .unwrap()
        .into_iter()
        .collect()
    } else {
        HashSet::new()
    };
    let tokens: Vec<&Token> = input
        .tokens
        .iter()
        .filter(|t| !sample || sample_ids.contains(&t.id))
        .collect();
    let count = std::env::var("KEEL_NATIVE_COUNT")
        .ok()
        .map(|v| v.parse::<usize>().unwrap())
        .unwrap_or(tokens.len());
    let threads = std::env::var("KEEL_NATIVE_THREADS")
        .ok()
        .map(|v| v.parse().unwrap())
        .unwrap_or(4);
    rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build_global()
        .unwrap();
    let suffix = format!(
        "{}{}{}{}",
        if sample { "-sample" } else { "" },
        if channels == 3 { "-rgb" } else { "" },
        if layer_maps { "-layer-map" } else { "" },
        if std::env::var("KEEL_NATIVE_NO_UP").is_ok() {
            "-no-up"
        } else {
            ""
        }
    );
    let root =
        format!("apps/desktop/artifacts/gator-raster-study/full-1080/native-{count}{suffix}");
    fs::create_dir_all(&root).unwrap();
    if let Ok(ids) = std::env::var("KEEL_NATIVE_EXPORT_TOKENS") {
        let ids: HashSet<u32> = ids.split(',').map(|id| id.parse().unwrap()).collect();
        let selected: Vec<&Token> = input
            .tokens
            .iter()
            .filter(|t| ids.contains(&t.id))
            .collect();
        assert_eq!(selected.len(), ids.len(), "Unknown original token ID");
        let mut layers = vec![Vec::new(); input.layers.len()];
        for token in &selected {
            for &index in &token.layers {
                if layers[index].is_empty() {
                    layers[index] = fs::read(&input.layers[index].rgba).unwrap();
                }
            }
        }
        fs::create_dir_all(format!("{root}/references")).unwrap();
        for token in selected {
            let (pixels, _) = composite(token, &layers, input.size);
            let mut output = Vec::new();
            {
                let mut encoder =
                    png::Encoder::new(&mut output, input.size as u32, input.size as u32);
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                let mut writer = encoder.write_header().unwrap();
                writer.write_image_data(&pixels).unwrap();
            }
            assert_eq!(hash(&decoded(&output)), hash(&pixels));
            fs::write(format!("{root}/references/{}.png", token.id), output).unwrap();
        }
        println!("{}", json!({"exportedOriginalReferences": ids.len()}));
        return;
    }
    let layers: Vec<Vec<u8>> = input
        .layers
        .par_iter()
        .map(|l| {
            let bytes = fs::read(&l.rgba).unwrap();
            assert_eq!(bytes.len(), input.size * input.size * 4);
            bytes
        })
        .collect();
    println!(
        "{}",
        json!({"phase":"loaded","layers":layers.len(),"tokens":count,"threads":threads})
    );
    if std::env::var("KEEL_NATIVE_DEPENDENCIES_ONLY").is_ok() {
        let report = layer_map::bidirectional_dependencies(&tokens[..count], &layers, input.size);
        fs::write(format!("apps/desktop/artifacts/gator-raster-study/full-1080/layer-dependencies-{count}.json"),serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        println!("{report}");
        return;
    }
    let maps = if layer_maps {
        let analysis_start = Instant::now();
        let maps: Vec<_> = layers
            .par_iter()
            .map(|l| layer_map::analyze(l, input.size))
            .collect();
        let totals = maps.iter().fold([0usize; 3], |mut sum, m| {
            for (i, n) in m.pixels_by_alpha.iter().enumerate() {
                sum[i] += n;
            }
            sum
        });
        let report = json!({"layers":maps.len(),"size":input.size,"pixelsByAlpha":{"empty":totals[0],"opaque":totals[1],"blend":totals[2]},"runs":maps.iter().flat_map(|m| &m.rows).map(|r|r.len()).sum::<usize>(),"seconds":analysis_start.elapsed().as_secs_f64(),"scope":"Offline source-layer alpha maps; no additional onchain resource required"});
        fs::write(
            format!("{root}/layer-map-analysis.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
        println!("{}", report);
        Some(maps)
    } else {
        None
    };
    let cat = Mutex::new(Catalog::default());
    let completed = AtomicUsize::new(0);
    let mut projects:Vec<Project>=tokens[..count].par_iter().map_init(HashMap::new,|local,t|{let p=prepare(t,&layers,input.size,channels,&cat,local,maps.as_deref());let done=completed.fetch_add(1,Ordering::Relaxed)+1;if done%32==0{println!("{}",json!({"phase":"candidates","done":done,"total":count,"seconds":start.elapsed().as_secs_f64()}));}p}).collect();
    drop(layers);
    // Thread scheduling must not alter IDs, ordering, or tie-breaking.
    let Catalog { ids, chunks } = cat.into_inner().unwrap();
    let mut keys: Vec<(Hash, u32)> = ids.into_iter().collect();
    keys.sort_unstable();
    let mut old: Vec<Option<Chunk>> = chunks.into_iter().map(Some).collect();
    let mut remap = vec![0u32; old.len()];
    let mut chunks = Vec::with_capacity(old.len());
    for (key, old_id) in keys {
        let _ = key;
        remap[old_id as usize] = chunks.len() as u32;
        chunks.push(old[old_id as usize].take().unwrap());
    }
    drop(old);
    for p in &mut projects {
        for b in &mut p.bands {
            for c in 0..2 {
                for id in &mut b.choices[c] {
                    *id = remap[*id as usize];
                }
                b.unique[c] = b.choices[c].clone();
                b.unique[c].sort_unstable();
                b.unique[c].dedup();
            }
        }
    }
    drop(remap);
    let cat = Catalog {
        ids: HashMap::new(),
        chunks,
    };
    let decision = select(&mut projects, &cat.chunks);
    println!(
        "{}",
        json!({"phase":"selected","decision":decision,"seconds":start.elapsed().as_secs_f64()})
    );
    // Count and save only selected binary data. Physical pieces may split any logical
    // PNG fragment; their size never rejects an image or caps the library.
    let mut physical = HashMap::<Hash, u32>::new();
    let mut locations = Vec::<[usize; 3]>::new();
    let mut expanded = HashMap::<u32, Vec<u32>>::new();
    let mut page = Vec::new();
    let mut pages = 0usize;
    let mut image_bytes = 0usize;
    fs::create_dir_all(format!("{root}/pages")).unwrap();
    let active: HashSet<u32> = projects
        .iter()
        .flat_map(|p| {
            p.bands
                .iter()
                .flat_map(|b| b.choices[b.selected].iter().copied())
        })
        .collect();
    let mut active: Vec<u32> = active.into_iter().collect();
    active.sort_by_key(|&id| hash(&cat.chunks[id as usize].bytes));
    let mut store_bytes = |bytes: &[u8]| -> Vec<u32> {
        let mut result = Vec::new();
        for piece in bytes.chunks(23000) {
            let key = hash(piece);
            let id = if let Some(&id) = physical.get(&key) {
                id
            } else {
                if page.len() + piece.len() > 23000 {
                    fs::write(format!("{root}/pages/{pages}.bin"), &page).unwrap();
                    pages += 1;
                    page.clear();
                }
                let id = locations.len() as u32;
                locations.push([pages, page.len(), piece.len()]);
                page.extend_from_slice(piece);
                image_bytes += piece.len();
                physical.insert(key, id);
                id
            };
            result.push(id);
        }
        result
    };
    for id in active {
        expanded.insert(id, store_bytes(&cat.chunks[id as usize].bytes));
    }
    let head = header(input.size, channels);
    let head_refs = store_bytes(&head);
    let mut results = Vec::new();
    let mut map_bytes = 0usize;
    let mut largest = (0u32, 0usize);
    let mut most_refs = (0u32, 0usize);
    for p in &projects {
        let mut sum = 1;
        let mut png = head.clone();
        let mut refs = head_refs.clone();
        let mut raw_count = 0;
        for b in &p.bands {
            for &id in &b.choices[b.selected] {
                let c = &cat.chunks[id as usize];
                sum = combine(sum, c.adler, c.raw_len);
                raw_count += c.raw_len;
                png.extend_from_slice(&c.bytes);
                refs.extend_from_slice(&expanded[&id]);
            }
        }
        assert_eq!(raw_count, (input.size * channels + 1) * input.size);
        let tail = footer(sum);
        png.extend_from_slice(&tail);
        refs.extend(store_bytes(&tail));
        let pixels = decoded(&png);
        assert_eq!(
            hash(&pixels),
            p.pixel_hash,
            "PNG reconstruction changed token {}",
            p.id
        );
        let packed: Vec<u8> = refs.iter().flat_map(|id| id.to_be_bytes()).collect();
        fs::write(format!("{root}/token-{}.map", p.id), &packed).unwrap();
        map_bytes += packed.len();
        if png.len() > largest.1 {
            largest = (p.id, png.len());
        }
        if refs.len() > most_refs.1 {
            most_refs = (p.id, refs.len());
        }
        // Retain a reproducible pixel witness without saving thousands of duplicate previews.
        if p.reference_checked || p.id == 0 {
            fs::write(format!("{root}/token-{}.png", p.id), &png).unwrap();
        }
        results.push(json!({"tokenId":p.id,"pngBytes":png.len(),"references":refs.len(),"pixelHash":blake3::Hash::from(p.pixel_hash).to_hex().to_string(),"regionBands":p.bands.iter().filter(|b|b.selected==0).count(),"stripBands":p.bands.iter().filter(|b|b.selected==1).count()}));
        if results.len() % 128 == 0 {
            println!(
                "{}",
                json!({"phase":"verified","done":results.len(),"total":count,"seconds":start.elapsed().as_secs_f64()})
            );
        }
    }
    drop(store_bytes);
    if !page.is_empty() {
        fs::write(format!("{root}/pages/{pages}.bin"), &page).unwrap();
        pages += 1;
    }
    fs::write(
        format!("{root}/catalog.json"),
        serde_json::to_vec(&locations).unwrap(),
    )
    .unwrap();
    let total = image_bytes + locations.len() * 24 + map_bytes;
    let report = json!({"schema":"keel-native-raster-study@1","size":input.size,"tokens":count,"originalTokenCount":input.tokens.len(),"imageBytes":image_bytes,"catalogBytes":locations.len()*24,"mapBytes":map_bytes,"preparedBytes":total,"sourceLayerBytes":input.source_bytes,"preparedWithSourcesBytes":total+input.source_bytes,"under250MBWithSources":total+input.source_bytes<=250_000_000,"under500MBWithSources":total+input.source_bytes<=500_000_000,"under250MB":total<=250_000_000,"under500MB":total<=500_000_000,"exactRGBAAllTokens":true,"independentOriginalReferenceChecks":projects.iter().filter(|p|p.reference_checked).count(),"decision":decision,"largestPNG":largest,"mostReferences":most_refs,"carrierPages":pages,"seconds":start.elapsed().as_secs_f64(),"publicChainPublished":false,"scope":"Selected binary PNG pieces, catalog records, and token maps; source-layer archive reported separately and in combined totals. Collection contract, metadata and gas are separate checks.","results":results});
    fs::write(
        format!("{root}/report.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    let mut summary = report;
    summary.as_object_mut().unwrap().remove("results");
    println!("{summary}");
}
