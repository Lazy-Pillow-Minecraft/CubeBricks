// Complex blends need CPU pixels. Keep small decoded blocks rather than
// repeatedly transferring every unchanged layer through the GPU while drawing.
// The global LRU bounds retained RGBA data; source canvases are weak keys.
export class LayerRasterRegions {
  constructor({ blockSize = 64, byteLimit = 8 * 1024 * 1024, readBlock = readBlendBlock } = {}) {
    this.blockSize = blockSize;
    this.byteLimit = byteLimit;
    this.readBlock = readBlock;
    this.sources = new WeakMap();
    this.lru = new Map();
    this.bytes = 0;
  }
  remove(tile) {
    if (!this.lru.delete(tile)) return;
    tile.owner.delete(tile.key);
    this.bytes -= tile.pixels.data.byteLength;
  }
  clear() {
    this.sources = new WeakMap();
    this.lru.clear();
    this.bytes = 0;
  }
  invalidate(source, region = null) {
    const tiles = this.sources.get(source);
    if (!tiles) return;
    for (const tile of tiles.values()) if (!region || tile.x < region.x + region.width
      && tile.y < region.y + region.height && tile.x + tile.width > region.x && tile.y + tile.height > region.y) this.remove(tile);
  }
  read(source, region) {
    let tiles = this.sources.get(source);
    if (!tiles) {
      tiles = new Map();
      this.sources.set(source, tiles);
    }
    const result = source.getContext('2d').createImageData(region.width, region.height), size = this.blockSize;
    for (let y = Math.max(0, Math.floor(region.y / size) * size); y < Math.min(source.height, region.y + region.height); y += size) {
      for (let x = Math.max(0, Math.floor(region.x / size) * size); x < Math.min(source.width, region.x + region.width); x += size) {
        const key = `${x},${y}`;
        let tile = tiles.get(key);
        if (!tile) {
          const width = Math.min(size, source.width - x), height = Math.min(size, source.height - y);
          tile = {
            key, owner: tiles, x, y, width, height,
            pixels: this.readBlock(source, x, y, width, height)
          };
          tiles.set(key, tile);
          this.bytes += tile.pixels.data.byteLength;
        } else this.lru.delete(tile);
        this.lru.set(tile, true);
        const left = Math.max(x, region.x), right = Math.min(x + tile.width, region.x + region.width);
        for (let row = Math.max(y, region.y); row < Math.min(y + tile.height, region.y + region.height); row++) {
          const start = ((row - y) * tile.width + left - x) * 4;
          result.data.set(tile.pixels.data.subarray(start, start + (right - left) * 4),
            ((row - region.y) * region.width + left - region.x) * 4);
        }
        while (this.bytes > this.byteLimit) this.remove(this.lru.keys().next().value);
      }
    }
    return result;
  }
}

function readBlendBlock(source, x, y, width, height) {
  // Match the original region -> blend-source Canvas path exactly. Direct
  // read/put on the original raster changes low-alpha RGB rounding on GPUs.
  const region = document.createElement('canvas'), blend = document.createElement('canvas');
  region.width = blend.width = width;
  region.height = blend.height = height;
  region.getContext('2d').drawImage(source, x, y, width, height, 0, 0, width, height);
  const context = blend.getContext('2d');
  context.drawImage(region, 0, 0);
  return context.getImageData(0, 0, width, height);
}

export const layerRasterRegions = new LayerRasterRegions();
