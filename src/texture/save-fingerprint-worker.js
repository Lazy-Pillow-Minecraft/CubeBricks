// Pixel-based fingerprints survive undo's PNG re-encoding. Decode and hash
// off the UI thread, one image at a time, without retaining a second snapshot.
let queue = Promise.resolve();
self.onmessage = ({ data: { id, source } }) => {
  queue = queue.catch(() => {}).then(async () => {
    try {
      let blob;
      if (source.startsWith('data:')) {
        const comma = source.indexOf(','), header = source.slice(0, comma), payload = source.slice(comma + 1);
        const bytes = header.endsWith(';base64') ? Uint8Array.from(atob(payload), char => char.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(payload));
        blob = new Blob([bytes], { type: header.slice(5).split(';')[0] });
      } else blob = await (await fetch(source)).blob();
      const image = await createImageBitmap(blob), canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      image.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const dimensions = `${canvas.width}:${canvas.height}:`;
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels.data)), n => n.toString(16).padStart(2, '0')).join('');
      canvas.width = canvas.height = 1;
      self.postMessage({ id, result: dimensions + hash });
    } catch (error) { self.postMessage({ id, error: error.message }); }
  });
};
