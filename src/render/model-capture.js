import { WebGLSceneRenderer, getMinecraftRenderType } from './webgl-renderer.js';

export function createModelCaptureController({ state, $, sceneCanvas, sceneRenderer, textureCanvas,
  getTextureAtlasEntries, getTextureAtlasCanvas, currentProjection, toast }) {
const modelCaptureCanvas = document.createElement('canvas');
let modelCaptureRenderer = null;
let modelCaptureImageCanvas = null;
let modelCaptureDataUrl = null;

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
      lockedDefaultAlpha: 100, lockedHoverFade: false, editorOverlayLines: []
    };
    if (mode === 'offscreen') {
      const fitted = sceneRenderer.fitCameraToVisibleModel(state.project, camera, width / height);
      if (!fitted) return toast('場景中沒有可見模型');
      Object.assign(camera, fitted);
    }
    toast(mode === 'offscreen' ? '正在離屏渲染模型…' : '正在截取屏幕內模型…');
    await new Promise(resolve => requestAnimationFrame(resolve));
    modelCaptureRenderer.render(state.project, null, camera);
    modelCaptureImageCanvas = modelCaptureRenderer.captureImageCanvas();
    modelCaptureDataUrl = modelCaptureImageCanvas.toDataURL('image/png');
    $('#modelCaptureImage').src = modelCaptureDataUrl;
    $('#modelCaptureInfo').textContent = `${mode === 'offscreen' ? '離屏渲染 · 自動框住可見模型' : '屏幕截圖 · 僅當前視窗範圍'} · ${pixelWidth} × ${pixelHeight} PNG · 透明背景`;
    $('#modelCaptureDialog').showModal();
  } catch (error) {
    toast(`截屏失敗：${error.message}`);
  }
}

function modelCaptureBlob() {
  return new Promise((resolve, reject) => {
    if (!modelCaptureImageCanvas) return reject(new Error('尚未生成模型截圖'));
    modelCaptureImageCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('無法生成 PNG')), 'image/png');
  });
}

async function saveModelCapture() {
  if (!modelCaptureDataUrl) return;
  const name = `${state.project.name || 'model'}-capture.png`;
  try {
    if (window.cubeBricksDesktop?.saveCaptureImage) {
      const saved = await window.cubeBricksDesktop.saveCaptureImage({ name, dataUrl: modelCaptureDataUrl });
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
    if (window.cubeBricksDesktop?.copyCaptureImage)
      await window.cubeBricksDesktop.copyCaptureImage(modelCaptureDataUrl);
    else await navigator.clipboard.write([new ClipboardItem({ 'image/png': await modelCaptureBlob() })]);
    toast('模型截圖已複製到剪切板');
  } catch (error) {
    toast(`複製截圖失敗：${error.message}`);
  }
}
function clearModelCapture() {
  modelCaptureImageCanvas = null;
  modelCaptureDataUrl = null;
}

return { captureModel, saveModelCapture, copyModelCapture, clearModelCapture };
}
