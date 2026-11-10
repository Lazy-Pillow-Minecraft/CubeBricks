const fs = require('node:fs/promises');
const path = require('node:path');

async function readTextureAnimationMetadata({ filePath } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.png') return null;
  const companion = `${filePath}.mcmeta`;
  try {
    const stat = await fs.stat(companion);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('貼圖動畫配置過大或不是文件');
    const metadata = JSON.parse((await fs.readFile(companion, 'utf8')).replace(/^\uFEFF/, ''));
    return metadata && typeof metadata.animation === 'object' && !Array.isArray(metadata.animation) ? metadata : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
module.exports = { readTextureAnimationMetadata };
