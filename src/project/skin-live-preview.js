import { createSkinProject } from './skin-project.js';

const SIZE = 256;
const BASE_VIEW = Object.freeze({
  yaw: -135 * Math.PI / 180, pitch: 45 * Math.PI / 180,
  projection: 'orthographic', zoom: 1, target: [0, 0, 0], panX: 0, panY: 0,
  captureWidth: SIZE, captureHeight: SIZE,
  capturePixelWidth: SIZE, capturePixelHeight: SIZE,
  captureModelOnly: true, grid: false, wire: false, previewShade: true,
  cubeBirthMs: 0, cubeDeathMs: 0, renderMode: 'textured'
});

function imageFromSource(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('皮膚貼圖載入失敗'));
    image.src = source;
  });
}

function textureAtlas(images, assets) {
  const canvas = document.createElement('canvas');
  canvas.width = images.reduce((sum, image) => sum + image.width + 2, 0);
  canvas.height = Math.max(1, ...images.map(image => image.height + 2));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  let x = 1;
  const entries = images.map((image, index) => {
    const asset = assets[index];
    context.drawImage(image, x, 1);
    const entry = {
      uid: asset.uuid, references: [asset.uuid, String(asset.id), String(index)],
      default: index === 0, x, y: 1, width: image.width, height: image.height,
      uvWidth: asset.uvWidth, uvHeight: asset.uvHeight
    };
    x += image.width + 2;
    return entry;
  });
  return { canvas, entries };
}

export function createSkinLivePreview({ canvas, list, readAsset, createRenderer, onError, onStatus }) {
  canvas.width = canvas.height = SIZE;
  let renderer = null;
  let activeEntry = null;
  let selectedEntry = null;
  let selectedCamera = null;
  let selectedToken = 0;
  let listGeneration = 0;
  let listObserver = null;
  let queue = [];
  let processing = false;
  let drag = null;
  const models = new Map();
  const prepared = new Map();

  function scene() { return renderer ||= createRenderer(canvas); }
  function remember(cache, key, value, limit) {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  }
  function modelFor(record) {
    const existing = models.get(record.id);
    if (existing) return existing;
    const value = readAsset(record.model).then(JSON.parse);
    value.catch(() => { if (models.get(record.id) === value) models.delete(record.id); });
    return remember(models, record.id, value, 8);
  }
  function entryFor(record, textureId, template) {
    const key = `${record.id}\u0000${template ? 'template' : textureId}`;
    const existing = prepared.get(key);
    if (existing) return existing;
    const value = (async () => {
      const model = await modelFor(record);
      const texture = record.textures.find(item => item.id === textureId);
      const gameTexture = template || !texture ? null
        : { ...texture, source: await readAsset(texture.file) };
      const { project, textureAssets } = createSkinProject(record, model, {
        textureMode: template ? 'template' : 'game', gameTexture
      });
      const images = await Promise.all(textureAssets.map(asset => imageFromSource(asset.source)));
      const atlas = images.length > 1 ? textureAtlas(images, textureAssets) : null;
      return {
        project,
        texture: images.length === 1 ? { source: images[0], entries: null }
          : { source: atlas.canvas, entries: atlas.entries },
        fittedCamera: null
      };
    })();
    value.catch(() => { if (prepared.get(key) === value) prepared.delete(key); });
    return remember(prepared, key, value, 6);
  }

  function render(entry, camera = BASE_VIEW) {
    const target = scene();
    if (activeEntry !== entry) {
      if (entry.texture.entries) target.setTextureAtlas(entry.texture.source, entry.texture.entries);
      else target.setTexture(entry.texture.source);
      activeEntry = entry;
    }
    if (!entry.fittedCamera) {
      target.render(entry.project, null, camera);
      const fitted = target.fitCameraToVisibleModel(entry.project, camera, 1, 1.3);
      entry.fittedCamera = fitted ? { ...fitted, zoom: fitted.zoom * .9 } : camera;
    }
    const view = { ...entry.fittedCamera, yaw: camera.yaw, pitch: camera.pitch };
    target.render(entry.project, null, view);
    return view;
  }

  function renderSelected() {
    if (!selectedEntry) {
      if (renderer) {
        const gl = renderer.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }
      return;
    }
    selectedCamera = render(selectedEntry, selectedCamera || BASE_VIEW);
  }

  async function select(record, textureId, template) {
    const token = ++selectedToken;
    selectedEntry = null;
    selectedCamera = null;
    renderSelected();
    onStatus?.(record ? 'loading' : 'empty');
    if (!record) return;
    try {
      const entry = await entryFor(record, textureId, template);
      if (token !== selectedToken) return;
      selectedEntry = entry;
      renderSelected();
      onStatus?.('ready');
    } catch (error) {
      if (token === selectedToken) { onStatus?.('error'); onError(error); }
    }
  }

  async function drawCard({ record, canvas: cardCanvas, generation }) {
    const textureId = record.textures.find(item => item.id === record.defaultTextureId)?.id
      || record.textures[0]?.id;
    const entry = await entryFor(record, textureId, !textureId);
    await new Promise(resolve => {
      if (window.requestIdleCallback) window.requestIdleCallback(resolve, { timeout: 350 });
      else setTimeout(resolve, 0);
    });
    if (generation !== listGeneration || !cardCanvas.isConnected) return;
    try {
      render(entry);
      const frame = scene().captureImageCanvas();
      cardCanvas.width = cardCanvas.height = 128;
      const context = cardCanvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.drawImage(frame, 0, 0, 128, 128);
    } finally { renderSelected(); }
  }

  function pump() {
    if (processing || !queue.length) return;
    processing = true;
    const next = queue.shift();
    void drawCard(next).catch(onError).finally(() => {
      processing = false;
      if (queue.length) setTimeout(pump, 0);
    });
  }

  function observeCards(records) {
    const generation = ++listGeneration;
    listObserver?.disconnect();
    queue = [];
    const byId = new Map(records.map(record => [record.id, record]));
    const observer = new IntersectionObserver(entries => {
      if (generation !== listGeneration) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const record = byId.get(entry.target.closest('[data-skin-id]')?.dataset.skinId);
        if (record) queue.push({ record, canvas: entry.target, generation });
      }
      pump();
    }, { root: list, rootMargin: '80px 0px' });
    listObserver = observer;
    list.querySelectorAll('.skin-picker-card canvas').forEach(card => listObserver.observe(card));
  }

  function reset() {
    selectedToken++;
    listGeneration++;
    listObserver?.disconnect();
    queue = [];
    selectedEntry = null;
    selectedCamera = null;
    renderSelected();
    onStatus?.('empty');
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !selectedEntry) return;
    drag = { x: event.clientX, y: event.clientY,
      yaw: selectedCamera?.yaw ?? BASE_VIEW.yaw,
      pitch: selectedCamera?.pitch ?? BASE_VIEW.pitch };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || !selectedEntry) return;
    selectedCamera = {
      ...selectedCamera,
      yaw: drag.yaw + (event.clientX - drag.x) * .008,
      pitch: Math.max(-1.45, Math.min(1.45, drag.pitch + (event.clientY - drag.y) * .008))
    };
    renderSelected();
  });
  for (const type of ['pointerup', 'pointercancel'])
    canvas.addEventListener(type, () => { drag = null; });

  return { select, observeCards, reset };
}
