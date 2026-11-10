import { pngPixels } from '../utils/image/png-pixels.js';
let queue = Promise.resolve();
self.onmessage = ({ data: { id, source } }) => {
  queue = queue.catch(() => {}).then(async () => {
    try {
      let image = null;
      try { image = await pngPixels(source); } catch { /* Unsupported/corrupt data is compared losslessly as source text. */ }
      const bytes = image?.rgba || new TextEncoder().encode(JSON.stringify(source));
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
      self.postMessage({ id, result: image ? `${image.width}:${image.height}:${hash}` : `source:${hash}` });
    } catch (error) { self.postMessage({ id, error: error.message }); }
  });
};
