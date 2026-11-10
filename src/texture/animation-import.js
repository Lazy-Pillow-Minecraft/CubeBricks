import { textureAnimationPlan } from '../common/core/texture-animation-import.js';
import { compositeLayers, layerRasterCache } from '../common/core/texture-features.js';

export async function readCompanionAnimation(file) {
  const api = window.cubeBricksDesktop;
  if (!api?.readTextureAnimationMetadata || !api.getPathForFile) return null;
  const filePath = api.getPathForFile(file);
  return filePath ? api.readTextureAnimationMetadata({ filePath }) : null;
}

export function splitTextureAnimation(image, metadata) {
  const plan = textureAnimationPlan(metadata, image.naturalWidth || image.width, image.naturalHeight || image.height);
  if (!plan) return null;
  const layers = Array.from({ length: plan.count }, (_, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(image, index % plan.columns * plan.width, Math.floor(index / plan.columns) * plan.height, plan.width, plan.height, 0, 0, plan.width, plan.height);
    const source = canvas.toDataURL('image/png'), uid = crypto.randomUUID();
    layerRasterCache.set(uid, { canvas, savedSource: source });
    return { uid, name: `幀圖像 ${index + 1}`, source, parentUid: null, visible: true, opacity: 100, blendMode: 'normal' };
  });
  const frames = plan.frames.map(({ index, duration }, i) => ({
    uid: crypto.randomUUID(),
    type: 'frame',
    name: `幀 ${i + 1}`,
    layerUids: [layers[index].uid],
    paintLayerUid: layers[index].uid,
    duration
  }));
  // Storage order is bottom-to-top, while both visible lists run top-to-bottom.
  // Follow first use in the sequence and put unused source cells underneath.
  const order = [...new Set([...plan.frames.map(frame => frame.index), ...layers.map((_, index) => index)])];
  const result = {
    layers: order.map(index => layers[index]).reverse(), activeLayerUid: frames[0].paintLayerUid, uvWidth: plan.width, uvHeight: plan.height,
    animation: { enabled: true, fps: plan.fps, interpolate: plan.interpolate, frames }
  };
  result.source = compositeLayers(result).toDataURL('image/png');
  return result;
}
