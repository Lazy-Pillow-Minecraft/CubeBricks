import { WebGLSceneRenderer, getMinecraftRenderType } from './webgl-renderer.js';

export function opaquePixelBounds(canvas) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!pixels[(y * width + x) * 4 + 3]) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < left ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function createModelCaptureController({ state, $, sceneCanvas, sceneRenderer, textureCanvas,
  getTextureAtlasEntries, getTextureAtlasCanvas, currentProjection, toast }) {
const modelCaptureCanvas = document.createElement('canvas');
let modelCaptureRenderer = null;
let modelCaptureImageCanvas = null;
let modelCaptureDataUrl = null;
let modelCaptureCropBounds = null;
let modelCaptureCroppedCanvas = null;
let modelCaptureMode = null;
let modelCaptureCropScanned = false;
const coverCanvas = document.createElement('canvas');
let coverRenderer = null;

function captureProjectCover() {
  if (!state.project.elements.length) return null;
  if (!coverRenderer) coverRenderer = new WebGLSceneRenderer(coverCanvas);
  const width = 256, height = 160;
  if (getTextureAtlasEntries().length) coverRenderer.setTextureAtlas(getTextureAtlasCanvas(), getTextureAtlasEntries());
  else coverRenderer.setTexture(textureCanvas);
  const camera = {
    ...state, yaw: -Math.PI * 3 / 4, pitch: Math.PI / 6,
    target: [0, 0, 0], panX: 0, panY: 0, zoom: 1,
    projection: 'perspective', axisView: null, renderMode: 'textured',
    selectedUids: new Set(), selectedUvFaces: new Set(),
    captureModelOnly: true, captureWidth: width, captureHeight: height,
    capturePixelWidth: width, capturePixelHeight: height,
    grid: false, wire: false, playerReference: false,
    modifierResultGhost: false, subdivisionEditOwnerUid: null,
    lockedDefaultAlpha: 100, lockedHoverFade: false, editorOverlayLines: [],
    cubeBirthMs: 0, cubeDeathMs: 0
  };
  const fitted = sceneRenderer.fitCameraToVisibleModel(state.project, camera, width / height);
  if (!fitted) return null;
  Object.assign(camera, fitted);
  coverRenderer.invalidateGeometry();
  coverRenderer.render(state.project, null, camera);
  return coverRenderer.captureImageCanvas().toDataURL('image/png');
}

function captureOutputCanvas() {
  if (!modelCaptureImageCanvas) return null;
  if (!$('#modelCaptureAutoCrop').checked || !modelCaptureCropBounds) return modelCaptureImageCanvas;
  if (!modelCaptureCroppedCanvas) {
    const { x, y, width, height } = modelCaptureCropBounds;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(modelCaptureImageCanvas, x, y, width, height, 0, 0, width, height);
    modelCaptureCroppedCanvas = canvas;
  }
  return modelCaptureCroppedCanvas;
}

function updateModelCaptureCrop() {
  if (!modelCaptureImageCanvas) return;
  if ($('#modelCaptureAutoCrop').checked && !modelCaptureCropScanned) {
    modelCaptureCropBounds = opaquePixelBounds(modelCaptureImageCanvas);
    modelCaptureCropScanned = true;
  }
  const { width, height } = modelCaptureImageCanvas;
  const enabled = $('#modelCaptureAutoCrop').checked && modelCaptureCropBounds;
  const outline = $('#modelCaptureCropOutline');
  outline.hidden = !enabled;
  if (enabled) {
    const bounds = modelCaptureCropBounds;
    outline.style.left = `${bounds.x / width * 100}%`;
    outline.style.top = `${bounds.y / height * 100}%`;
    outline.style.width = `${bounds.width / width * 100}%`;
    outline.style.height = `${bounds.height / height * 100}%`;
  }
  const output = captureOutputCanvas();
  $('#modelCaptureInfo').textContent = `${modelCaptureMode === 'offscreen' ? '離屏渲染 · 自動框住可見模型' : '屏幕截圖 · 僅當前視窗範圍'} · ${output.width} × ${output.height} PNG · 透明背景`;
}

async function captureModel(mode) {
  try {
    const rect = sceneCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (!state.project.elements.length) return toast('場景中沒有可截屏的模型');
    if (!modelCaptureRenderer) modelCaptureRenderer = new WebGLSceneRenderer(modelCaptureCanvas);
    const { gl } = modelCaptureRenderer;
    const mippedScale = state.renderMode === 'textured' && getMinecraftRenderType(state.project.renderType).smooth ? 1.5 : 1;
    const gpuLimit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    const scale = mode === 'offscreen' ? 2 : Math.min(window.devicePixelRatio || 1, 2);
    const maxDimension = Math.min(mode === 'offscreen' ? 3072 : 4096, Math.floor(gpuLimit / mippedScale));
    const actualScale = Math.min(scale, maxDimension / Math.max(width, height));
    const pixelWidth = Math.max(1, Math.round(width * actualScale));
    const pixelHeight = Math.max(1, Math.round(height * actualScale));
    if (getTextureAtlasEntries().length) modelCaptureRenderer.setTextureAtlas(getTextureAtlasCanvas(), getTextureAtlasEntries());
    else modelCaptureRenderer.setTexture(textureCanvas);
    const projection = currentProjection();
    const camera = {
      ...state, projection, selectedUids: new Set(), selectedUvFaces: new Set(),
      captureModelOnly: true, captureWidth: width, captureHeight: height,
      capturePixelWidth: pixelWidth, capturePixelHeight: pixelHeight,
      grid: false, wire: false, playerReference: false,
      modifierResultGhost: false, subdivisionEditOwnerUid: null,
      lockedDefaultAlpha: 100, lockedHoverFade: false, editorOverlayLines: [],
      cubeBirthMs: 0, cubeDeathMs: 0
    };
    if (mode === 'offscreen') {
      const fitted = sceneRenderer.fitCameraToVisibleModel(state.project, camera, width / height);
      if (!fitted) return toast('場景中沒有可見模型');
      Object.assign(camera, fitted);
    }
    toast(mode === 'offscreen' ? '正在離屏渲染模型…' : '正在截取屏幕內模型…');
    await new Promise(resolve => requestAnimationFrame(resolve));
    // This renderer lives across captures; project identity and atlas layout
    // stay the same after many edits, so its geometry cache must be refreshed.
    modelCaptureRenderer.invalidateGeometry();
    modelCaptureRenderer.render(state.project, null, camera);
    modelCaptureImageCanvas = modelCaptureRenderer.captureImageCanvas();
    modelCaptureDataUrl = modelCaptureImageCanvas.toDataURL('image/png');
    modelCaptureCropBounds = null;
    modelCaptureCroppedCanvas = null;
    modelCaptureMode = mode;
    modelCaptureCropScanned = false;
    $('#modelCaptureAutoCrop').checked = false;
    $('#modelCaptureImage').src = modelCaptureDataUrl;
    updateModelCaptureCrop();
    $('#modelCaptureDialog').showModal();
  } catch (error) {
    toast(`截屏失敗：${error.message}`);
  }
}

function modelCaptureBlob() {
  return new Promise((resolve, reject) => {
    const canvas = captureOutputCanvas();
    if (!canvas) return reject(new Error('尚未生成模型截圖'));
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('無法生成 PNG')), 'image/png');
  });
}

async function saveModelCapture() {
  if (!modelCaptureDataUrl) return;
  const name = `${state.project.name || 'model'}-capture.png`;
  try {
    const dataUrl = captureOutputCanvas().toDataURL('image/png');
    if (window.cubeBricksDesktop?.saveCaptureImage) {
      const saved = await window.cubeBricksDesktop.saveCaptureImage({ name, dataUrl });
      if (saved) toast('模型截圖已保存');
    } else if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: name,
        types: [{ description: 'PNG 圖片', accept: { 'image/png': ['.png'] } }] });
      const writable = await handle.createWritable();
      await writable.write(await modelCaptureBlob());
      await writable.close();
      toast('模型截圖已保存');
    } else {
      const blob = await modelCaptureBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('已下載模型截圖');
    }
  } catch (error) {
    if (error.name !== 'AbortError') toast(`保存截圖失敗：${error.message}`);
  }
}

async function copyModelCapture() {
  if (!modelCaptureDataUrl) return;
  try {
    const dataUrl = captureOutputCanvas().toDataURL('image/png');
    if (window.cubeBricksDesktop?.copyCaptureImage)
      await window.cubeBricksDesktop.copyCaptureImage(dataUrl);
    else await navigator.clipboard.write([new ClipboardItem({ 'image/png': await modelCaptureBlob() })]);
    toast('模型截圖已複製到剪切板');
  } catch (error) {
    toast(`複製截圖失敗：${error.message}`);
  }
}
function clearModelCapture() {
  modelCaptureImageCanvas = null;
  modelCaptureDataUrl = null;
  modelCaptureCropBounds = null;
  modelCaptureCroppedCanvas = null;
  modelCaptureMode = null;
  modelCaptureCropScanned = false;
  $('#modelCaptureAutoCrop').checked = false;
}

return { captureModel, captureProjectCover, saveModelCapture, copyModelCapture, clearModelCapture, updateModelCaptureCrop };
}
