export const TEXTURE_RESIZE_MODES = ['crop', 'repeat', 'stretch'];

export function resizeTextureRaster(source, width, height, mode) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 8192 || height > 8192 || !TEXTURE_RESIZE_MODES.includes(mode)) {
    throw new RangeError('贴图尺寸须为 1–8192 的整数');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  if (mode === 'repeat') {
    context.fillStyle = context.createPattern(source, 'repeat');
    context.fillRect(0, 0, width, height);
  } else if (mode === 'stretch') {
    context.drawImage(source, 0, 0, width, height);
  } else {
    context.drawImage(source, 0, 0);
  }
  return canvas;
}
