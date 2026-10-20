import { rgbToHsv, hsvToRgb, rgbToHex, insetControlRatio, insetControlPosition, trianglePickerGeometry, barycentric2d, closestPointOnTriangle2d, TRIANGLE_RING_WIDTH } from './math.js';
import { pickerSession } from './session.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createColorPickerController({ state, inspector, hexToRgb, setPaintColor,
  renderPaintColorHistory, recordPaintColorHistory, renderInspector, setTool, addPaintSwatchToSelection }) {
function renderTrianglePickerCanvas(surface) {
  const canvas = surface?.querySelector('.color-picker-triangle-field');
  if (!canvas || state.paintColorPickerMode !== 'triangle') return;
  const rect = surface.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const renderKey = `${width}:${height}:${state.paintColorPickerHue.toFixed(6)}`;
  if (canvas.dataset.renderKey === renderKey) return;
  canvas.dataset.renderKey = renderKey;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const geometry = trianglePickerGeometry({ width, height });
  const hueRgb = hsvToRgb(state.paintColorPickerHue, 1, 1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const weights = barycentric2d([x + .5, y + .5], geometry.hue, geometry.white, geometry.black);
    if (!weights || weights.some(weight => weight < -1e-5)) continue;
    const offset = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) image.data[offset + channel] = Math.round(
      hueRgb[channel] * weights[0] + 255 * weights[1]);
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function updatePaintColorPickerVisual(root = pickerSession.popupRoot || pickerSession.spaceRoot || inspector) {
  const surface = $('[data-color-picker-surface]', root);
  if (!surface) return;
  const rgb = hexToRgb(state.paintColor);
  // Keep HSV as independent picker coordinates. Reading them back from rounded
  // 8-bit RGB on every pointermove causes severe jitter near black or grey.
  const hue = state.paintColorPickerHue;
  const saturation = state.paintColorPickerSaturation;
  const value = state.paintColorPickerValue;
  const hueColor = rgbToHex(hsvToRgb(hue, 1, 1));
  const brightColor = rgbToHex(hsvToRgb(hue, saturation, 1));
  surface.style.setProperty('--picker-hue', hueColor);
  surface.style.setProperty('--picker-darkness', String(1 - value));
  const marker = surface.querySelector('.color-picker-marker');
  let markerX = saturation, markerY = 1 - value;
  if (state.paintColorPickerMode === 'circle') {
    const angle = hue * Math.PI * 2;
    markerX = .5 + Math.cos(angle) * saturation * .5;
    markerY = .5 + Math.sin(angle) * saturation * .5;
  } else if (state.paintColorPickerMode === 'triangle') {
    const hueWeight = saturation * value;
    const whiteWeight = (1 - saturation) * value;
    const blackWeight = 1 - value;
    const width = surface.clientWidth || 1, height = surface.clientHeight || 1;
    const geometry = trianglePickerGeometry({ width, height });
    markerX = (geometry.hue[0] * hueWeight + geometry.white[0] * whiteWeight + geometry.black[0] * blackWeight) / width;
    markerY = (geometry.hue[1] * hueWeight + geometry.white[1] * whiteWeight + geometry.black[1] * blackWeight) / height;
    renderTrianglePickerCanvas(surface);
  }
  marker?.style.setProperty('left', state.paintColorPickerMode === 'triangle' ? `${markerX * 100}%` : insetControlPosition(markerX));
  marker?.style.setProperty('top', state.paintColorPickerMode === 'triangle' ? `${markerY * 100}%` : insetControlPosition(markerY));
  const hueRail = $('[data-color-hue]', root);
  hueRail?.style.setProperty('--picker-bright', brightColor);
  const hueMarker = $('.color-hue-marker', root);
  if (hueMarker) hueMarker.style.top = insetControlPosition(state.paintColorPickerMode === 'circle' ? 1 - value : hue);
  const ringMarker = $('.color-picker-ring-marker', root);
  if (ringMarker && state.paintColorPickerMode === 'triangle') {
    const angle = hue * Math.PI * 2;
    const radius = Math.max(1, (surface.clientWidth || 1) / 2 - TRIANGLE_RING_WIDTH / 2 - 2);
    ringMarker.style.left = `calc(50% + ${Math.sin(angle) * radius}px)`;
    ringMarker.style.top = `calc(50% - ${Math.cos(angle) * radius}px)`;
  }
  const preview = $('.color-picker-current', root);
  if (preview) preview.style.background = state.paintColor;
  ['r', 'g', 'b'].forEach((channel, index) => {
    const input = $(`[data-paint-channel="${channel}"]`, root);
    if (input && document.activeElement !== input) input.value = String(rgb[index]);
  });
  const hex = $('[data-paint-hex]', root);
  if (hex && document.activeElement !== hex) hex.value = state.paintColor;
}

function colorPickerPoint(surface, event, lockedZone = null) {
  const rect = surface.getBoundingClientRect();
  let x = insetControlRatio(event.clientX, rect.left, rect.width);
  const y = insetControlRatio(event.clientY, rect.top, rect.height);
  const currentSaturation = state.paintColorPickerSaturation;
  const currentValue = state.paintColorPickerValue;
  if (state.paintColorPickerMode === 'circle') {
    const dx = x - .5, dy = y - .5, distance = Math.hypot(dx, dy);
    return {
      hue: distance > 1e-5 ? ((Math.atan2(dy, dx) / (Math.PI * 2)) + 1) % 1 : state.paintColorPickerHue,
      saturation: clamp(distance * 2, 0, 1), value: currentValue
    };
  }
  if (state.paintColorPickerMode === 'triangle') {
    let local = [event.clientX - rect.left, event.clientY - rect.top];
    const geometry = trianglePickerGeometry(rect);
    let weights = barycentric2d(local, geometry.hue, geometry.white, geometry.black);
    const inside = weights && weights.every(weight => weight >= -1e-4);
    const zone = lockedZone || (inside ? 'triangle' : 'hue');
    if (zone === 'hue') {
      const angle = Math.atan2(local[0] - rect.width / 2, rect.height / 2 - local[1]);
      return { hue: (angle / (Math.PI * 2) + 1) % 1, saturation: currentSaturation, value: currentValue, zone: 'hue' };
    }
    if (!inside) {
      local = closestPointOnTriangle2d(local, geometry);
      weights = barycentric2d(local, geometry.hue, geometry.white, geometry.black);
    }
    const value = clamp(weights[0] + weights[1], 0, 1);
    return {
      hue: state.paintColorPickerHue,
      saturation: value > 1e-8 ? clamp(weights[0] / value, 0, 1) : currentSaturation,
      value, zone: 'triangle'
    };
  }
  return { hue: state.paintColorPickerHue, saturation: x, value: 1 - y };
}

function bindPaintColorPicker(root = inspector) {
  const surface = $('[data-color-picker-surface]', root);
  const hueRail = $('[data-color-hue]', root);
  let surfaceZone = null;
  const useSurface = (event, lockedZone = null) => {
    const point = colorPickerPoint(surface, event, lockedZone);
    state.paintColorPickerHue = point.hue;
    state.paintColorPickerSaturation = point.saturation;
    state.paintColorPickerValue = point.value;
    setPaintColor(rgbToHex(hsvToRgb(point.hue, point.saturation, point.value)), false, true, false);
  };
  const useHue = event => {
    const rect = hueRail.getBoundingClientRect();
    const position = insetControlRatio(event.clientY, rect.top, rect.height);
    const saturation = state.paintColorPickerSaturation;
    const value = state.paintColorPickerValue;
    if (state.paintColorPickerMode === 'circle') {
      state.paintColorPickerValue = 1 - position;
      setPaintColor(rgbToHex(hsvToRgb(state.paintColorPickerHue, saturation, state.paintColorPickerValue)), false, true, false);
    } else {
      state.paintColorPickerHue = position >= 1 ? 0 : position;
      setPaintColor(rgbToHex(hsvToRgb(state.paintColorPickerHue, saturation, value)), false, true, false);
    }
  };
  const bindPointer = (node, handler) => {
    node.addEventListener('pointerdown', event => {
      event.preventDefault();
      node.setPointerCapture(event.pointerId);
      handler(event);
    });
    node.addEventListener('pointermove', event => { if (node.hasPointerCapture(event.pointerId)) handler(event); });
    node.addEventListener('pointerup', () => { if (!pickerSession.popupRoot && !pickerSession.spaceRoot) recordPaintColorHistory(state.paintColor); });
  };
  surface.addEventListener('pointerdown', event => {
    event.preventDefault();
    const point = colorPickerPoint(surface, event);
    surfaceZone = point.zone || null;
    surface.setPointerCapture(event.pointerId);
    useSurface(event, surfaceZone);
  });
  surface.addEventListener('pointermove', event => {
    if (surface.hasPointerCapture(event.pointerId)) useSurface(event, surfaceZone);
  });
  const releaseSurface = event => {
    if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    surfaceZone = null;
    if (event.type === 'pointerup' && !pickerSession.popupRoot && !pickerSession.spaceRoot) recordPaintColorHistory(state.paintColor);
  };
  surface.addEventListener('pointerup', releaseSurface);
  surface.addEventListener('pointercancel', releaseSurface);
  surface.addEventListener('lostpointercapture', () => { surfaceZone = null; });
  if (hueRail) bindPointer(hueRail, useHue);
  $$('[data-color-picker-mode]', root).forEach(button => button.addEventListener('click', () => {
    state.paintColorPickerMode = button.dataset.colorPickerMode;
    if (pickerSession.popupRoot) renderPaintColorPicker(pickerSession.popupRoot);
    else if (pickerSession.spaceRoot) renderPaintColorPicker(pickerSession.spaceRoot);
    else renderInspector();
  }));
  $$('[data-paint-channel]', root).forEach(input => input.addEventListener('change', () => {
    const rgb = ['r', 'g', 'b'].map(channel => Number($(`[data-paint-channel="${channel}"]`, root)?.value) || 0);
    setPaintColor(rgbToHex(rgb));
  }));
  $('[data-paint-hex]', root)?.addEventListener('change', event => setPaintColor(event.target.value));
  $('[data-paint-color-history]', root)?.addEventListener('click', event => {
    const swatch = event.target.closest('[data-history-color]');
    if (swatch) setPaintColor(swatch.dataset.historyColor);
  });
  $('[data-action="paintEyedropper"]', root)?.addEventListener('click', () => setTool('eyedropper'));
  $('[data-action="addPaintSwatch"]', root)?.addEventListener('click', () => {
    addPaintSwatchToSelection();
  });
  updatePaintColorPickerVisual(root);
}

function renderPaintColorPicker(root = inspector) {
  if (root === inspector) { $('#inspectorHeading').textContent = '選色器'; $('#inspectorMetaStrip').hidden = true; }
  const mode = ['square', 'circle', 'triangle'].includes(state.paintColorPickerMode) ? state.paintColorPickerMode : 'square';
  root.innerHTML = `<div class="paint-color-picker">
    <nav class="color-picker-modes" aria-label="選色器形態">
      <button type="button" data-color-picker-mode="square" class="${mode === 'square' ? 'active' : ''}">方形</button>
      <button type="button" data-color-picker-mode="circle" class="${mode === 'circle' ? 'active' : ''}">圓形</button>
      <button type="button" data-color-picker-mode="triangle" class="${mode === 'triangle' ? 'active' : ''}">三角形</button>
    </nav>
    <div class="color-picker-stage mode-${mode}">
      <div class="color-picker-surface" data-color-picker-surface><canvas class="color-picker-triangle-field"></canvas><i class="color-picker-marker"></i><i class="color-picker-ring-marker"></i></div>
      <div class="color-hue-rail" data-color-hue><i class="color-hue-marker"></i></div>
    </div>
    <div class="color-picker-values">
      <label>R<input type="number" min="0" max="255" step="1" data-paint-channel="r"></label>
      <label>G<input type="number" min="0" max="255" step="1" data-paint-channel="g"></label>
      <label>B<input type="number" min="0" max="255" step="1" data-paint-channel="b"></label>
    </div>
    <div class="color-picker-footer">
      <i class="color-picker-current"></i><input type="text" maxlength="7" data-paint-hex value="${state.paintColor}">
      ${root === inspector ? '<button type="button" data-action="addPaintSwatch" title="加入色卡">＋</button><button type="button" data-action="paintEyedropper" title="取色器">⌖</button>' : ''}
    </div>
    <div class="color-picker-history"><span>歷史色</span><div class="color-picker-history-swatches" data-paint-color-history></div></div>
  </div>`;
  bindPaintColorPicker(root);
  renderPaintColorHistory();
}

function openColorPickerPopup(color, apply) {
  if (pickerSession.popupRoot) return;
  const saved = Object.fromEntries(['paintColor', 'paintColorPickerHue', 'paintColorPickerSaturation', 'paintColorPickerValue', 'paintColorPickerMode'].map(key => [key, state[key]]));
  const dialog = document.createElement('dialog');
  dialog.className = 'theme-dialog color-picker-dialog';
  dialog.innerHTML = '<form method="dialog"><div class="dialog-heading"><h2>選擇顏色</h2></div><div data-popup-picker></div><div class="dialog-actions"><button value="cancel">取消</button><button value="apply" class="primary">套用</button></div></form>';
  document.body.append(dialog);
  pickerSession.popupRoot = $('[data-popup-picker]', dialog);
  pickerSession.popupApply = apply;
  const hsv = rgbToHsv(hexToRgb(color));
  state.paintColor = color;
  [state.paintColorPickerHue, state.paintColorPickerSaturation, state.paintColorPickerValue] = hsv;
  dialog.addEventListener('close', () => {
    const value = state.paintColor, callback = pickerSession.popupApply;
    pickerSession.popupRoot = null; pickerSession.popupApply = null;
    Object.assign(state, saved);
    dialog.remove();
    if (dialog.returnValue === 'apply') { recordPaintColorHistory(value); callback(value); }
    if (state.mode === 'paint') renderInspector();
  }, { once: true });
  dialog.showModal();
  renderPaintColorPicker(pickerSession.popupRoot);
}
  return { updatePaintColorPickerVisual, renderPaintColorPicker, openColorPickerPopup };
}
