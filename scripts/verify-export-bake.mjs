import { bakeBlockbenchTextures, createBakedBlockbenchExport } from '../src/texture/export-bake.js';
import { layerRasterCache, loadRaster } from '../src/common/core/texture-features.js';
import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv } from '../src/common/core/geometry-utils.js';
import { CubeBricksProject } from '../src/model.js';

export async function verifyExportBake() {
  const checks = [], check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  const png = (width, height, pixel) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'), data = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.data.set(pixel(x, y), (y * width + x) * 4);
    ctx.putImageData(data, 0, 0); return canvas.toDataURL();
  };
  const solid = color => png(4, 4, () => color);
  const colors = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255], [255, 255, 0, 255], [255, 0, 255, 255]];
  const asset = (id, indexes, fps, mode = 'default') => ({ uuid: id, _uid: id, id, mode, uvWidth: 4, uvHeight: 4,
    source: solid(colors[indexes[0]]), layers: indexes.map((n, i) => ({ uid: `${id}_${i}`, source: solid(colors[n]), visible: false, opacity: 100 })),
    animation: { enabled: true, fps, interpolate: true, frames: indexes.map((_, i) => ({ uid: `${id}_f${i}`, layerUids: [`${id}_${i}`], duration: i + 1 })) } });
  const model = (format, assets, faces) => ({ meta: { model_format: format, box_uv: false }, name: 'Export test', resolution: { width: 4, height: 4 },
    textures: assets.map((a, index) => ({ uuid: a.uuid, id: String(index), name: `${a.uuid}.png`, source: a.source, uv_width: 4, uv_height: 4 })),
    elements: [{ uuid: 'cube', from: [0, 0, 0], to: [2, 2, 2], box_uv: false, uv_offset: [0, 0], faces }], outliner: ['cube'] });
  const sample = (raster, texture, uv, frame = 0) => {
    const width = texture.uv_width, height = texture.uv_height, scale = raster.width / width;
    return [...raster.getContext('2d').getImageData(Math.floor((uv[0] + uv[2]) / 2 * scale),
      Math.floor(((uv[1] + uv[3]) / 2 + frame * height) * scale), 1, 1).data];
  };
  const same = (a, b) => a.join(',') === b.join(',');
  const assets = [asset('redblue', [0, 1], 10), asset('three', [2, 3, 4], 20),
    { uuid: 'static', mode: 'default', uvWidth: 4, uvHeight: 4, source: solid([50, 70, 90, 128]) }];
  const original = JSON.stringify(assets), cacheSize = layerRasterCache.size;
  const faces = { north: { texture: 'redblue', uv: [0, 0, 4, 4] }, south: { texture: 'three', uv: [0, 0, 4, 4] },
    east: { texture: 'static', uv: [0, 0, 4, 4] }, west: { texture: null, uv: [0, 0, 4, 4] }, up: { uv: [0, 0, 4, 4] } };
  const merged = await bakeBlockbenchTextures(model('bedrock', assets, structuredClone(faces)), assets);
  const texture = merged.textures[0], raster = await loadRaster(texture.source);
  check(merged.textures.length === 1 && raster.height === raster.width * 6, 'single-texture format merges the exact LCM sequence into one strip');
  check(texture.fps === 15 && texture.frame_interpolate === false, 'merged FPS is the mean; interpolation is off');
  for (let i = 0; i < 6; i++) {
    check(same(sample(raster, texture, merged.elements[0].faces.north.uv, i), colors[i % 2]), `two-frame input repeats correctly at output frame ${i}`);
    check(same(sample(raster, texture, merged.elements[0].faces.south.uv, i), colors[2 + i % 3]), `three-frame input repeats correctly at output frame ${i}`);
    check(same(sample(raster, texture, merged.elements[0].faces.east.uv, i), [50, 70, 90, 128]), `static alpha is retained at frame ${i}`);
  }
  check(merged.elements[0].faces.west.texture === null && merged.elements[0].faces.up.texture === undefined, 'culled and unassigned faces stay unassigned');
  check(JSON.stringify(assets) === original && layerRasterCache.size === cacheSize, 'export leaves editor pixels, metadata and raster caches unchanged');
  const separate = await bakeBlockbenchTextures(model('java_block', assets, structuredClone(faces)), assets);
  check(separate.textures.length === 3, 'Java block retains multiple independent textures');
  check(separate.textures[0].frame_interpolate === true && separate.textures[0].frame_time === 2
    && separate.textures[0].frame_order === '0:2 1:4', 'independent strips retain interpolation, rate and per-frame duration');
  check((await loadRaster(separate.textures[0].source)).height === 8 && (await loadRaster(separate.textures[1].source)).height === 12,
    'independent images contain all of their own frames');

  const pattern = png(4, 4, (x, y) => [x * 60, y * 60, 120, 255]);
  const tile = { uuid: 'tile', mode: 'tiled', uvWidth: 4, uvHeight: 4, source: pattern };
  const tiledFaces = { north: { texture: 'tile', uv: [100, 100, 200, 200], tiling: { offsetX: -3, offsetY: 1, width: 9, height: 7 } },
    south: { texture: 'tile', tiling: { offsetX: 5, offsetY: -3, width: 9, height: 7 } },
    up: { texture: 'tile', tiling: { offsetX: 2, offsetY: 0, width: 4, height: 4 } } };
  const tiled = await bakeBlockbenchTextures(model('java_block', [tile], structuredClone(tiledFaces)), [tile]);
  const tr = await loadRaster(tiled.textures[0].source), tf = tiled.elements[0].faces;
  check(tr.width === 10 && tr.height === 8, 'tiled faces reuse a compact periodic plane, independent of saved ordinary UVs');
  check(same(tf.north.uv, tf.south.uv), 'period-equivalent faces overlap the exact same baked UV rectangle');
  check(tf.up.uv[0] >= tf.north.uv[0] && tf.up.uv[2] <= tf.north.uv[2], 'different tiled face sizes can reuse overlapping baked pixels');
  for (let y = 0; y < tr.height; y++) for (let x = 0; x < tr.width; x++) {
    if (!same([...tr.getContext('2d').getImageData(x, y, 1, 1).data], [x % 4 * 60, y % 4 * 60, 120, 255])) throw Error('periodic pixel mismatch');
  }
  check(!tf.north.tiling && tf.north.rotation === 0, 'tiled properties become ordinary export UVs without retained renderer-only fields');
  const mixed = await bakeBlockbenchTextures(model('bedrock', [tile, assets[0]], { ...structuredClone(tiledFaces), down: { texture: 'redblue', uv: [0, 0, 4, 4] } }), [tile, assets[0]]);
  check(mixed.textures.length === 1 && same(mixed.elements[0].faces.north.uv, mixed.elements[0].faces.south.uv), 'tiling and animation merge while retaining overlap reuse');
  check(same(sample(await loadRaster(mixed.textures[0].source), mixed.textures[0], mixed.elements[0].faces.down.uv, 1), colors[1]), 'ordinary animated face stays correct beside a tiled plane');

  const boxed = await bakeBlockbenchTextures(model('modded_entity', [tile, assets[0]], {
    north: structuredClone(tiledFaces.north), south: { texture: 'redblue', uv: [0, 0, 4, 4], rotation: 90 }
  }), [tile, assets[0]]);
  const be = boxed.elements[0], bt = boxed.textures[0], br = await loadRaster(bt.source);
  check(be.box_uv === true && boxed.meta.box_uv === true && !be.faces.south.uv, 'required box-UV format retains its fixed box net');
  const south = getBlockbenchBoxUv({ size: [2, 2, 2], uv: be.uv_offset }, 'south');
  check(same(sample(br, bt, south, 1), colors[1]), 'box net rebakes animation with a shared high-resolution pixel density');
  const targetNorth = getBlockbenchBoxUv({ size: [2, 2, 2], uv: be.uv_offset }, 'north');
  const northSlots = createBlockbenchFaceUvSlots(targetNorth), density = br.width / bt.uv_width;
  const u = .25, v = .75, px = northSlots[0][0] + u * (northSlots[1][0] - northSlots[0][0]), py = northSlots[0][1] + v * (northSlots[2][1] - northSlots[0][1]);
  const targetPixel = [...br.getContext('2d').getImageData(Math.floor(px * density), Math.floor(py * density), 1, 1).data];
  check(same(targetPixel, [180, 120, 120, 255]), 'fixed box net preserves tiled face phase and orientation');

  const high = { uuid: 'high', mode: 'default', source: pattern };
  const highModel = model('bedrock', [high, assets[0]], { north: { texture: 'high', uv: [0, 0, 2, 2] } });
  highModel.textures[0].uv_width = highModel.textures[0].uv_height = 2;
  const highBaked = await bakeBlockbenchTextures(highModel, [high, assets[0]]), highUv = highBaked.elements[0].faces.north.uv;
  check(highUv[2] - highUv[0] === 4 && highUv[3] - highUv[1] === 4, 'high-resolution textures inherit missing logical UV dimensions from the exported model');
  const rectangular = asset('rectangle', [0, 1], 10);
  rectangular.uvWidth = 2; rectangular.uvHeight = 1;
  const rectangleBake = await bakeBlockbenchTextures(model('java_block', [rectangular], { north: { texture: 'rectangle', uv: [0, 0, 2, 1] } }), [rectangular]);
  check(rectangleBake.textures[0].uv_width === 4 && rectangleBake.textures[0].uv_height === 4
    && same(rectangleBake.elements[0].faces.north.uv, [0, 0, 4, 4]), 'animation frame dimensions and face UVs are converted together to physical pixels');

  const project = new CubeBricksProject({ formatId: 'bedrock_entity', name: 'Source', elements: [{ type: 'cube', uid: 'owner', position: [0, 0, 0], size: [2, 2, 2],
    uvMode: 'face', faces: { north: { texture: 'redblue', uv: [0, 0, 4, 4] } } }], outliner: ['owner'] });
  const serialized = JSON.stringify(project);
  const baked = await createBakedBlockbenchExport(project, [assets[0]]);
  check(JSON.stringify(project) === serialized && baked.elements[0].uuid === 'owner', 'shared export wrapper preserves original project and hierarchy identities');
  let rejected = false;
  try { await bakeBlockbenchTextures(model('java_block', [tile], { north: { texture: 'tile', tiling: { width: 20000, height: 16 } } }), [tile]); }
  catch { rejected = true; }
  check(rejected, 'oversize bake is rejected instead of truncating a tiled face');
  return checks;
}
