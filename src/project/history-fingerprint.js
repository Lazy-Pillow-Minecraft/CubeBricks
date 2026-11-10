let worker = null, serial = 0, bytes = 0;
const requests = new Map(), sources = new Map();
// Opaque/alpha pixel witnesses from the actual editable raster establish a
// difference without decoding two entire PNGs on the undo keypress.
const encodedCanvases = new Set(), pixelDifferences = [];
let canvasBytes = 0, witnessBytes = 0;
const witnessLimit = 32 * 1024 * 1024;
export function noteCanvasHistoryImage(before, after, { alpha = false, opaque = false } = {}) {
  if (typeof after !== 'string') return;
  if (typeof before === 'string' && before !== after && (alpha || opaque && encodedCanvases.has(before))) {
    pixelDifferences.push([before, after]);
    witnessBytes += before.length + after.length;
    while (pixelDifferences.length > 16 || witnessBytes > witnessLimit) {
      const [a, b] = pixelDifferences.shift();
      witnessBytes -= a.length + b.length;
    }
  }
  if (!encodedCanvases.has(after)) {
    encodedCanvases.add(after);
    canvasBytes += after.length;
  }
  while (encodedCanvases.size > 20 || canvasBytes > witnessLimit) {
    const oldest = encodedCanvases.values().next().value;
    encodedCanvases.delete(oldest);
    canvasBytes -= oldest.length;
  }
}
export function knownDifferentHistoryImages(before, after) {
  return before !== after && pixelDifferences.some(([a, b]) => a === before && b === after || a === after && b === before);
}
export function historyImageFingerprint(source) {
  if (typeof Worker === 'undefined' || typeof source !== 'string' || !source.startsWith('data:image/')) return source;
  const cached = sources.get(source);
  if (cached) return cached;
  if (!worker) {
    try { worker = new Worker(new URL('./history-fingerprint-worker.js', import.meta.url), { type: 'module' }); }
    catch (error) { return Promise.reject(error); }
    worker.onmessage = ({ data }) => {
      const request = requests.get(data.id);
      if (!request) return;
      requests.delete(data.id);
      clearTimeout(request.timer);
      if (data.error) request.reject(Error(data.error)); else request.resolve(data.result);
    };
    worker.onerror = error => {
      for (const request of requests.values()) {
        clearTimeout(request.timer);
        request.reject(Error(error.message));
      }
      requests.clear();
      worker.terminate();
      worker = null;
      sources.clear();
      bytes = 0;
    };
  }
  const promise = new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => {
      requests.delete(id);
      reject(Error('History pixel comparison timed out'));
    }, 15000);
    requests.set(id, { resolve, reject, timer });
    try { worker.postMessage({ id, source }); }
    catch (error) {
      requests.delete(id);
      clearTimeout(timer);
      reject(error);
    }
  });
  void promise.then(result => { if (sources.get(source) === promise) sources.set(source, result); }, () => {
    if (sources.get(source) === promise) {
      sources.delete(source);
      bytes -= source.length * 2;
    }
  });
  sources.set(source, promise);
  bytes += source.length * 2;
  while (sources.size > 256 || bytes > 32 * 1024 * 1024) {
    const oldest = sources.keys().next().value;
    sources.delete(oldest);
    bytes -= oldest.length * 2;
  }
  return promise;
}
