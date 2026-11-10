// Frame elements are metadata only. Pixel storage, evaluation and playback
// intentionally remain outside this first frame-list implementation.
export function textureFrameElements(asset) {
  return Array.isArray(asset?.animation?.frames) ? asset.animation.frames : [];
}

export function migrateTextureAnimationMode(asset) {
  if (asset?.mode !== 'animation') return;
  asset.mode = 'default';
  asset.animation = { ...asset.animation, enabled: true };
}

export function createTextureFrameElement(frames = [], original = null) {
  if (original) return { ...structuredClone(original), uid: crypto.randomUUID(), type: 'frame' };
  const occupied = new Set(frames.map(frame => Number(String(frame.name || '').match(/^(?:幀|帧) (\d+)$/)?.[1])));
  let number = 1;
  while (occupied.has(number)) number++;
  return { uid: crypto.randomUUID(), type: 'frame', name: `幀 ${number}` };
}

export function insertTextureFrameElement(frames, frame, afterUid = null) {
  const index = frames.findIndex(entry => entry.uid === afterUid);
  const result = [...frames];
  result.splice(index < 0 ? result.length : index + 1, 0, frame);
  return result;
}

export function moveTextureFrameElement(frames, uid, insertionIndex) {
  const index = frames.findIndex(frame => frame.uid === uid);
  if (index < 0) return frames;
  const target = Math.max(0, Math.min(frames.length - 1, insertionIndex));
  if (target === index) return frames;
  const result = [...frames], frame = result.splice(index, 1)[0];
  result.splice(target, 0, frame);
  return result;
}
