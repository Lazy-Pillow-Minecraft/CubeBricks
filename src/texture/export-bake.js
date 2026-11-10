import { CubeBricksProject, exportBlockbench } from '../model.js';
import { constrainProject } from '../common/core/format-constraints.js';
import { modelFormatRegistry } from '../common/config/model-formats.js';
import { collectExportFaces, texturePlane, packExportPlanes, combinedAnimation, checkBakeSize, boxExportPlan } from './export-plan.js';
import { bakeCanvas, captureExportTexture, paintTexturePlane, paintBoxNet } from './export-raster.js';

function animationFields(texture, frames, fps, interpolate, durations = []) {
  texture.fps = fps;
  // Java metadata uses integral game ticks. Other formats read the exact FPS.
  texture.frame_time = Math.max(1, Math.round(20 / fps));
  texture.frame_interpolate = interpolate === true;
  texture.frame_order_type = durations.some(duration => Number(duration) > 0 && Number(duration) !== 1) ? 'custom' : 'loop';
  texture.frame_order = texture.frame_order_type === 'custom' ? Array.from({ length: frames }, (_, index) => {
    const ticks = Math.max(1, Math.round((Number(durations[index]) > 0 ? Number(durations[index]) : 1) * 20 / fps));
    return `${index}:${ticks}`;
  }).join(' ') : '';
}

function writeTexture(texture, canvas, uvWidth, uvHeight) {
  texture.source = canvas.toDataURL('image/png');
  texture.width = canvas.width;
  texture.height = canvas.height;
  texture.uv_width = uvWidth;
  texture.uv_height = uvHeight;
  // A baked image must not retain a path to its unbaked source on disk.
  texture.path = '';
  delete texture.relative_path;
  texture.mode = 'bitmap';
  texture.saved = false;
}

function assignFace(entry, uv, index) {
  const { element, face } = entry;
  element.box_uv = false;
  face.uv = uv;
  face.texture = index;
  face.rotation = entry.rotation;
  delete face.tiling;
}

export async function bakeBlockbenchTextures(bbmodel, assets, { progress = async () => {}, forceBoxBake = false } = {}) {
  if (!assets.length) return bbmodel;
  const format = modelFormatRegistry.resolve(bbmodel.meta.model_format);
  const single = format?.capabilities.singleTexture === true;
  const captures = [];
  for (let index = 0; index < assets.length; index++) {
    captures.push(await captureExportTexture(assets[index]));
    await progress(.2 * (index + 1) / assets.length);
  }
  const faces = collectExportFaces(bbmodel, assets);
  const planes = assets.map((asset, index) => texturePlane({
    ...asset,
    uvWidth: asset.uvWidth || bbmodel.textures[index]?.uv_width || bbmodel.resolution?.width,
    uvHeight: asset.uvHeight || bbmodel.textures[index]?.uv_height || bbmodel.resolution?.height
  }, captures[index].first, faces.filter(face => face.index === index)));
  for (const face of faces) face.tiled = planes[face.index].tiled;
  const needsMerge = single && assets.length > 1;
  const needsBoxBake = single && format.capabilities.faceUv === false && (forceBoxBake || needsMerge || planes.some(plane => plane.tiled));

  if (needsMerge || needsBoxBake) {
    const animation = combinedAnimation(assets);
    const packed = needsBoxBake ? boxExportPlan(bbmodel, faces, planes) : packExportPlanes(planes);
    const density = packed.density || 1, side = packed.side * density;
    checkBakeSize(side, side * animation.count);
    const canvas = bakeCanvas(side, side * animation.count), context = canvas.getContext('2d');
    for (let frame = 0; frame < animation.count; frame++) {
      const sources = captures.map(capture => capture.frame(frame));
      const pixelCache = new Map();
      if (needsBoxBake) {
        for (const net of packed.entries) {
          const { x, y } = packed.placements.get(net);
          if (net.plane) paintTexturePlane(context, sources[net.index], net.plane, x * density, (frame * packed.side + y) * density);
          else paintBoxNet(context, net, sources, density, x * density, (frame * packed.side + y) * density, pixelCache);
        }
      } else for (let index = 0; index < planes.length; index++) {
        const plane = planes[index], { x, y } = packed.placements.get(plane);
        paintTexturePlane(context, sources[index], plane, x, frame * side + y);
      }
      await progress(.2 + .7 * (frame + 1) / animation.count);
    }
    if (needsBoxBake) {
      for (const net of packed.entries) {
        const { x, y } = packed.placements.get(net);
        for (const element of net.elements) {
          element.box_uv = true;
          element.uv_offset = [x, y];
          element.mirror_uv = false;
          for (const face of Object.values(element.faces || {})) if (face && face.texture !== null && face.enabled !== false && face.texture !== undefined) {
            face.texture = 0;
            delete face.uv;
            delete face.tiling;
            face.rotation = 0;
          }
        }
      }
      bbmodel.meta.box_uv = true;
    } else for (const plane of planes) {
      const { x, y } = packed.placements.get(plane);
      for (const entry of plane.faces) assignFace(entry, entry.pixelUv.map((value, axis) => value + (axis % 2 ? y : x)), 0);
    }
    const texture = { ...bbmodel.textures[0], name: 'baked_texture.png', id: '0', use_as_default: true };
    writeTexture(texture, canvas, packed.side, packed.side);
    if (animation.animated) animationFields(texture, animation.count, animation.fps, false);
    bbmodel.textures = [texture];
    bbmodel.resolution = { width: packed.side, height: packed.side };
    if (!needsBoxBake) bbmodel.meta.box_uv = false;
  } else {
    for (let index = 0; index < assets.length; index++) {
      const asset = assets[index], plane = planes[index], texture = bbmodel.textures[index];
      const animated = asset.animation?.enabled && asset.animation.frames?.length;
      // Minecraft's rectangular-frame dimensions are physical pixels. Keep
      // logical UV density out of the frame-size metadata in multi-texture
      // formats by converting the corresponding face coordinates together.
      const pixelCoordinates = plane.tiled || !single && animated;
      const count = animated ? asset.animation.frames.length : 1;
      checkBakeSize(plane.width, plane.height * count);
      const canvas = bakeCanvas(plane.width, plane.height * count), context = canvas.getContext('2d');
      for (let frame = 0; frame < count; frame++) {
        paintTexturePlane(context, captures[index].frame(frame), plane, 0, frame * plane.height);
        await progress(.2 + .7 * (index + (frame + 1) / count) / assets.length);
      }
      writeTexture(texture, canvas, pixelCoordinates ? plane.width : plane.asset.uvWidth || captures[index].first.width,
        pixelCoordinates ? plane.height : plane.asset.uvHeight || captures[index].first.height);
      for (const entry of plane.faces) {
        if (pixelCoordinates) assignFace(entry, [...entry.pixelUv], index);
        else {
          entry.face.texture = index;
          delete entry.face.tiling;
        }
      }
      if (animated) animationFields(texture, count, Number(asset.animation.fps) || 20,
        single ? false : asset.animation.interpolate, single ? [] : asset.animation.frames.map(frame => frame.duration));
    }
    if (single) bbmodel.resolution = { width: bbmodel.textures[0].uv_width, height: bbmodel.textures[0].uv_height };
  }
  for (const entry of faces) if (entry.wasBox && !entry.element.box_uv && !entry.face.uv) {
    entry.face.uv = [...entry.uv];
    entry.face.rotation = 0;
  }
  await progress(1);
  return bbmodel;
}

export async function createBakedBlockbenchExport(project, textureAssets, options) {
  // serialize() updates modifiedAt; exporting is read-only for the source.
  const snapshot = JSON.parse(JSON.stringify(project));
  snapshot.elements = snapshot.elements.filter(element => !element.subdivisionOwnerUid);
  const model = new CubeBricksProject(snapshot);
  const assets = structuredClone(textureAssets);
  constrainProject(model);
  // Geometry, hierarchy and modifier chains use the existing shared baker.
  return bakeBlockbenchTextures(exportBlockbench(model, assets), assets, options);
}
