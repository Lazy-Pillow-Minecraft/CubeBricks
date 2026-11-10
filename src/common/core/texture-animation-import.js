// Minecraft .png.mcmeta uses 20 ticks/second. Pixels are split once on import;
// repeated sequence entries can then share the same image layer.
export function textureAnimationPlan(metadata, imageWidth, imageHeight) {
  const data = metadata?.animation;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const positive = (value, fallback) => {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < 1) throw new Error('動畫尺寸與時間必須是正整數');
    return value;
  };
  const size = Math.min(imageWidth, imageHeight);
  const width = positive(data.width, data.height === undefined ? size : imageWidth), height = positive(data.height, data.width === undefined ? size : imageHeight);
  if (imageWidth % width || imageHeight % height || width > imageWidth || height > imageHeight) throw new Error('動畫單幀尺寸無法整齊切分貼圖');
  const columns = imageWidth / width, count = columns * (imageHeight / height), frametime = positive(data.frametime, 1);
  if (count > 65536) throw new Error('貼圖動畫包含過多圖像');
  const sequence = Array.isArray(data.frames) && data.frames.length ? data.frames : Array.from({ length: count }, (_, index) => index);
  if (sequence.length > 65536) throw new Error('貼圖動畫包含過多幀');
  const frames = sequence.map(entry => {
    const index = typeof entry === 'number' ? entry : entry?.index, time = positive(typeof entry === 'object' ? entry?.time : undefined, frametime);
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('動畫幀索引超出貼圖範圍');
    return { index, duration: time / frametime };
  });
  return { width, height, columns, count, fps: 20 / frametime, interpolate: data.interpolate === true, frames };
}
