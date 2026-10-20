import { ColorSpaceCurveViewport, changeColorSpaceMode, colorAtPosition, colorSpaceArcLengthPositions, colorSpaceGradientCss, constrainColorPosition, createColorSpaceCurve, equalGradientPositions, gradientRatioToUniform, positionForColor, sampleColorSpaceGradient, sampleColorSpacePosition } from '../color-space-gradient.js';
import { insetControlRatio, insetControlPosition } from '../color-picker/math.js';
import { pickerSession } from '../color-picker/session.js';

export function createPaletteController({ state, $, $$, clamp, escapeHtml, escapeAttribute, hexToRgb,
  snapshot, renderPaintGradientPreview, setPaintColor, updatePaintColorPickerVisual,
  renderPaintColorPicker, renderInspector, toast, selected, noteJournalOperation, markDirty, renderAll }) {
const paletteRows = [
  { id: crypto.randomUUID(), name: '苔原', gradient: false, marker: .5, colors: ['#172016','#273522','#3a4d2c','#526b35','#708d42','#91ad52','#b4ce68','#d3e18b','#e9efb3','#f5f5da','#c8a85a','#a77a3f','#76502f','#463324'] },
  { id: crypto.randomUUID(), name: '深潭', gradient: false, marker: .5, colors: ['#11191b','#1d2a29','#2b403a','#3b5b4c','#4b7560','#629178','#7aaf91','#9bc9aa','#c3dfc9','#f1f3dd','#8baab2','#587989','#365261','#263640'] },
  { id: crypto.randomUUID(), name: '暖岩', gradient: false, marker: .5, colors: ['#22191b','#402329','#663233','#8b443b','#b65e48','#d9805a','#eca875','#f6d09b','#f4e4c2','#8b705b','#66503e','#48382f','#2f2926','#1c1d19'] }
];
const PALETTE_ROWS_KEY = 'cubebricks.palette-rows.v1';
const PALETTE_COMPACT_KEY = 'cubebricks.palette-compact.v1';
let paletteCompact = localStorage.getItem(PALETTE_COMPACT_KEY) === 'true';
const safePaletteVector = (value, fallback) => Array.from({ length: 3 }, (_, axis) => {
  const parsed = Number(value?.[axis]);
  return Number.isFinite(parsed) ? parsed : fallback[axis];
});
try {
  const saved = JSON.parse(localStorage.getItem(PALETTE_ROWS_KEY) || 'null');
  if (Array.isArray(saved) && saved.length && saved.length <= 256) {
    const valid = saved.filter(row => row && typeof row.name === 'string' && Array.isArray(row.colors))
      .map(row => ({
        id: typeof row.id === 'string' ? row.id : crypto.randomUUID(), name: row.name.slice(0, 100),
        gradient: Boolean(row.gradient), marker: clamp(Number(row.marker) || 0, 0, 1),
        colors: row.colors.filter(color => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 256),
        gradientSegments: ['equal', 'custom', 'curve_length'].includes(row.gradientSegments) ? row.gradientSegments : 'equal',
        gradientPositions: Array.isArray(row.gradientPositions) ? row.gradientPositions.slice(0, 256).map(value => clamp(Number(value) || 0, 0, 1)) : [],
        colorSpaceGradient: Boolean(row.colorSpaceGradient),
        colorSpaceCurve: row.colorSpaceCurve && ['hsv_cube', 'rgb_cube', 'hsv_cylinder'].includes(row.colorSpaceCurve.mode)
          && Array.isArray(row.colorSpaceCurve.nodes) && row.colorSpaceCurve.nodes.length >= 2
          ? { mode: row.colorSpaceCurve.mode, revision: 0, nodes: row.colorSpaceCurve.nodes.slice(0, 128).map(entry => {
            const node = entry && typeof entry === 'object' ? entry : {};
            return {
              id: typeof node.id === 'string' ? node.id : crypto.randomUUID(),
              position: constrainColorPosition(safePaletteVector(node.position, [0, 0, 0]), row.colorSpaceCurve.mode),
              handleIn: safePaletteVector(node.handleIn, [-.12, 0, 0]),
              handleOut: safePaletteVector(node.handleOut, [.12, 0, 0]),
              handlesEnabled: node.handlesEnabled !== false, autoTangent: node.autoTangent !== false,
              symmetricHandles: node.symmetricHandles !== false
            };
          }) } : null
      }));
    if (valid.length) paletteRows.splice(0, paletteRows.length, ...valid);
  }
} catch { /* A damaged optional palette cache must not block startup. */ }
function savePaletteRows() {
  try { localStorage.setItem(PALETTE_ROWS_KEY, JSON.stringify(paletteRows)); } catch { /* Keep editing in memory. */ }
}
function ensureColorSpaceCurve(row) {
  if (!row.colorSpaceCurve) row.colorSpaceCurve = createColorSpaceCurve(row.colors);
  return row.colorSpaceCurve;
}
const paletteArcLengthCache = new WeakMap();
const equalPalettePositionCache = new Map();
function cachedEqualPalettePositions(count) {
  if (!equalPalettePositionCache.has(count)) equalPalettePositionCache.set(count, equalGradientPositions(count));
  return equalPalettePositionCache.get(count);
}
function paletteNodeCount(row) {
  return row.colorSpaceGradient ? ensureColorSpaceCurve(row).nodes.length : row.colors.length;
}
function ensurePaletteCustomPositions(row) {
  const count = paletteNodeCount(row);
  if (!Array.isArray(row.gradientPositions) || row.gradientPositions.length !== count) {
    row.gradientPositions = equalGradientPositions(count);
  }
  for (let index = 1; index < count; index++) row.gradientPositions[index] = clamp(
    Number(row.gradientPositions[index]) || 0, row.gradientPositions[index - 1], 1);
  return row.gradientPositions;
}
function paletteGradientPositions(row) {
  const count = paletteNodeCount(row);
  if (row.gradientSegments === 'custom') return row.gradientPositions?.length === count
    ? row.gradientPositions : ensurePaletteCustomPositions(row);
  if (row.gradientSegments === 'curve_length' && row.colorSpaceGradient) {
    const curve = ensureColorSpaceCurve(row);
    let cache = paletteArcLengthCache.get(curve);
    if (!cache || cache.revision !== curve.revision || cache.count !== count || cache.mode !== curve.mode) {
      cache = { revision: curve.revision, count, mode: curve.mode, positions: colorSpaceArcLengthPositions(curve) };
      paletteArcLengthCache.set(curve, cache);
    }
    return cache.positions;
  }
  return cachedEqualPalettePositions(count);
}
function samplePaletteGradient(row, ratio) {
  const uniform = gradientRatioToUniform(ratio, paletteGradientPositions(row));
  return row.colorSpaceGradient ? sampleColorSpaceGradient(ensureColorSpaceCurve(row), uniform)
    : sampleGradient(row.colors, uniform);
}
function paletteGradientCss(row) {
  const positions = paletteGradientPositions(row);
  return row.colorSpaceGradient ? colorSpaceGradientCss(ensureColorSpaceCurve(row), 64, positions)
    : row.colors.length === 1 ? `linear-gradient(90deg, ${row.colors[0]} 0%, ${row.colors[0]} 100%)`
    : `linear-gradient(90deg, ${row.colors.map((color, index) => `${color} ${(positions[index] * 100).toFixed(3)}%`).join(', ')})`;
}
function paletteNodeColor(row, index) {
  return row.colorSpaceGradient ? colorAtPosition(ensureColorSpaceCurve(row).nodes[index].position, row.colorSpaceCurve.mode) : row.colors[index];
}
function gradientBarHtml(row, attribute = '') {
  return `<div class="gradient-picker" ${attribute} style="background:${paletteGradientCss(row)}"><i class="gradient-marker" style="left:${insetControlPosition(row.marker)}"></i>${paletteGradientPositions(row).map((position, index) => `<span class="gradient-node-line" style="left:${insetControlPosition(position)}"></span><button type="button" class="gradient-node-head ${selectedPaletteRowId === row.id && selectedPaletteColorIndex === index ? 'selected' : ''}" data-gradient-node="${index}" data-gradient-row-id="${row.id}" style="left:${insetControlPosition(position)};--node-color:${paletteNodeColor(row, index)}" title="${paletteNodeColor(row, index)} · 節點 ${index + 1}" aria-label="漸變節點 ${index + 1}"></button>`).join('')}</div>`;
}
function refreshGradientBar(bar, row) {
  if (!bar) return;
  bar.style.background = paletteGradientCss(row);
  const positions = paletteGradientPositions(row);
  $$('[data-gradient-node]', bar).forEach(head => {
    const index = Number(head.dataset.gradientNode);
    head.style.left = insetControlPosition(positions[index]);
    head.style.setProperty('--node-color', paletteNodeColor(row, index));
    head.title = `${paletteNodeColor(row, index)} · 節點 ${index + 1}`;
    head.previousElementSibling.style.left = head.style.left;
    head.classList.toggle('selected', selectedPaletteRowId === row.id && selectedPaletteColorIndex === index);
    head.style.transform = '';
    head.previousElementSibling.style.transform = '';
  });
  const marker = $('.gradient-marker', bar);
  if (marker) marker.style.left = insetControlPosition(row.marker);
}
function insertPalettePosition(row, index) {
  const positions = ensurePaletteCustomPositions(row).slice();
  if (!positions.length) positions.push(0);
  else if (index <= 0) {
    if (positions[0] <= 0) positions[0] = positions.length > 1 ? positions[1] / 2 : 1;
    positions.unshift(0);
  } else if (index >= positions.length) {
    if (positions.at(-1) >= 1) positions[positions.length - 1] = positions.length > 1 ? (positions.at(-2) + 1) / 2 : 0;
    positions.push(1);
  } else positions.splice(index, 0, (positions[index - 1] + positions[index]) / 2);
  row.gradientPositions = positions;
}
function removePalettePosition(row, index) {
  row.gradientPositions?.splice(index, 1);
}
function movePaletteNodeData(row, from, to) {
  if (from === to || from < 0 || to < 0) return;
  const list = row.colorSpaceGradient ? ensureColorSpaceCurve(row).nodes : row.colors;
  if (from >= list.length || to >= list.length) return;
  const [entry] = list.splice(from, 1);
  list.splice(to, 0, entry);
  if (row.colorSpaceGradient) { row.colorSpaceCurve.revision++; alignPaletteColorsToCurve(row); }
  return true;
}
function bindGradientBar(bar, row, { onSelect = () => {}, onCommit = () => {}, allowColorPick = true } = {}) {
  if (!bar) return;
  const chooseColor = event => {
    const rect = bar.getBoundingClientRect();
    row.marker = insetControlRatio(event.clientX, rect.left, rect.width);
    $('.gradient-marker', bar).style.left = insetControlPosition(row.marker);
    if (allowColorPick) applyPaletteColor(samplePaletteGradient(row, row.marker), false, false);
  };
  bar.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.gradient-node-head')) return;
    event.preventDefault();
    if (state.mode !== 'paint') snapshot('core.texture.palette');
    bar.setPointerCapture(event.pointerId);
    chooseColor(event);
  });
  bar.addEventListener('pointermove', event => {
    if (bar.hasPointerCapture(event.pointerId)) chooseColor(event);
  });
  bar.addEventListener('pointerup', () => {
    savePaletteRows();
    if (state.mode === 'paint' && allowColorPick) recordPaintColorHistory(state.paintColor);
  });
  $$('[data-gradient-node]', bar).forEach(head => head.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    let index = Number(head.dataset.gradientNode);
    selectedPaletteRowId = row.id;
    selectedPaletteColorIndex = index;
    onSelect(index);
    refreshGradientBar(bar, row);
    head.setPointerCapture(event.pointerId);
    const rect = bar.getBoundingClientRect();
    const startX = event.clientX;
    let moved = false;
    head.onpointermove = move => {
      if (!head.hasPointerCapture(move.pointerId)) return;
      const dx = move.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;
      if (row.gradientSegments !== 'custom') {
        head.style.transform = `translateX(calc(-50% + ${dx}px))`;
        head.previousElementSibling.style.transform = `translateX(calc(-1px + ${dx}px))`;
        return;
      }
      const positions = ensurePaletteCustomPositions(row);
      const ratio = insetControlRatio(move.clientX, rect.left, rect.width);
      const remaining = positions.filter((_, candidate) => candidate !== index);
      const insertion = remaining.findIndex(position => position > ratio);
      const target = insertion < 0 ? remaining.length : insertion;
      if (target !== index) {
        movePaletteNodeData(row, index, target);
        $$('[data-gradient-node]', bar).forEach(other => {
          const old = Number(other.dataset.gradientNode);
          if (other === head) other.dataset.gradientNode = String(target);
          else if (index < target && old > index && old <= target) other.dataset.gradientNode = String(old - 1);
          else if (target < index && old >= target && old < index) other.dataset.gradientNode = String(old + 1);
        });
      }
      row.gradientPositions = [...remaining.slice(0, target), ratio, ...remaining.slice(target)];
      index = target;
      selectedPaletteColorIndex = index;
      refreshGradientBar(bar, row);
      if (state.tool === 'gradient' && state.paintGradientPalette) renderPaintGradientPreview();
    };
    const finish = up => {
      if (head.hasPointerCapture(up.pointerId)) head.releasePointerCapture(up.pointerId);
      head.onpointermove = null; head.onpointerup = null; head.onpointercancel = null;
      if (row.gradientSegments !== 'custom' && moved) {
        const ratio = insetControlRatio(up.clientX, rect.left, rect.width);
        const positions = paletteGradientPositions(row);
        const target = positions.reduce((best, value, candidate) => Math.abs(value - ratio) < Math.abs(positions[best] - ratio) ? candidate : best, 0);
        movePaletteNodeData(row, index, target);
        index = target;
      }
      selectedPaletteRowId = row.id;
      selectedPaletteColorIndex = index;
      if (!moved && allowColorPick) applyPaletteColor(paletteNodeColor(row, index), false, false);
      onSelect(index);
      onCommit(index);
      savePaletteRows();
    };
    head.onpointerup = finish;
    head.onpointercancel = finish;
  }));
}
function alignPaletteColorsToCurve(row) {
  if (!row.colorSpaceGradient) return;
  const curve = ensureColorSpaceCurve(row);
  row.colors = curve.nodes.map(node => colorAtPosition(node.position, curve.mode));
}
function insertPaletteGradientNode(row, ratio, color = null, index = null) {
  const positions = paletteGradientPositions(row);
  const next = positions.findIndex(position => position > ratio);
  const insertion = index ?? (positions.length ? Math.max(1, next < 0 ? positions.length - 1 : next) : 0);
  const sampled = color || samplePaletteGradient(row, ratio);
  const curvePosition = row.colorSpaceGradient
    ? constrainColorPosition(sampleColorSpacePosition(ensureColorSpaceCurve(row), gradientRatioToUniform(ratio, positions)), row.colorSpaceCurve.mode)
    : null;
  alignPaletteColorsToCurve(row);
  insertPalettePosition(row, insertion);
  if (row.gradientSegments === 'custom') row.gradientPositions[insertion] = clamp(ratio,
    row.gradientPositions[insertion - 1] ?? 0, row.gradientPositions[insertion + 1] ?? 1);
  row.colors.splice(insertion, 0, sampled);
  if (row.colorSpaceGradient) {
    const curve = row.colorSpaceCurve;
    curve.nodes.splice(insertion, 0, {
      id: crypto.randomUUID(), position: color ? positionForColor(color, curve.mode) : curvePosition,
      handlesEnabled: true, autoTangent: true, symmetricHandles: true,
      handleIn: [-.12, 0, 0], handleOut: [.12, 0, 0]
    });
    curve.revision++;
  }
  selectedPaletteRowId = row.id;
  selectedPaletteColorIndex = insertion;
  renderPalette();
}
let selectedPaletteRowId = paletteRows[0].id;
let selectedPaletteColorIndex = paletteRows[0].colors.indexOf(state.paintColor);
let draggedPaletteColor = null;
const PAINT_COLOR_HISTORY_KEY = 'cubebricks.paint-color-history';
const PAINT_COLOR_HISTORY_LIMIT = 12;
let paintColorHistory = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(PAINT_COLOR_HISTORY_KEY) || '[]');
    return Array.isArray(saved) ? [...new Set(saved.filter(color => /^#[0-9a-f]{6}$/i.test(color)).map(color => color.toLowerCase()))].slice(0, PAINT_COLOR_HISTORY_LIMIT) : [];
  } catch { return []; }
})();

function renderPaintColorHistory() {
  $$('[data-paint-color-history]').forEach(row => {
    row.innerHTML = paintColorHistory.map(color => `<button type="button" class="color-picker-history-swatch" data-history-color="${color}" style="background:${color}" title="${color}" aria-label="使用歷史顏色 ${color}" aria-pressed="${color === state.paintColor}"></button>`).join('')
      || '<span class="color-picker-history-empty">尚無歷史顏色</span>';
  });
}

function recordPaintColorHistory(color) {
  if (!/^#[0-9a-f]{6}$/i.test(String(color))) return;
  const normalized = color.toLowerCase();
  paintColorHistory = [normalized, ...paintColorHistory.filter(entry => entry !== normalized)].slice(0, PAINT_COLOR_HISTORY_LIMIT);
  try { localStorage.setItem(PAINT_COLOR_HISTORY_KEY, JSON.stringify(paintColorHistory)); } catch { /* history remains available for this session */ }
  renderPaintColorHistory();
}

function syncPaletteSelectionToPaintColor() {
  const color = state.paintColor.toLowerCase();
  const previousRowId = selectedPaletteRowId;
  const previousColorIndex = selectedPaletteColorIndex;
  const preferred = paletteRows.find(row => row.id === selectedPaletteRowId);
  const candidates = preferred ? [preferred, ...paletteRows.filter(row => row !== preferred)] : paletteRows;
  const match = candidates.find(row => !row.gradient && !row.colorSpaceGradient && row.colors.some(entry => entry.toLowerCase() === color));
  if (match) {
    selectedPaletteRowId = match.id;
    selectedPaletteColorIndex = match.colors.findIndex(entry => entry.toLowerCase() === color);
  } else {
    selectedPaletteColorIndex = null;
    const gradient = candidates.find(row => (row.gradient || row.colorSpaceGradient) && row.colors.some(entry => entry.toLowerCase() === color));
    if (gradient) selectedPaletteRowId = gradient.id;
  }
  if (previousRowId !== selectedPaletteRowId || previousColorIndex !== selectedPaletteColorIndex) {
    $$('.palette-row-card').forEach(card => card.classList.toggle('selected', card.dataset.paletteId === selectedPaletteRowId));
    $$('.swatch-item, .gradient-node-head').forEach(item => item.classList.toggle('selected', (item.dataset.paletteRowId || item.dataset.gradientRowId) === selectedPaletteRowId && Number(item.dataset.paletteColorIndex ?? item.dataset.gradientNode) === selectedPaletteColorIndex));
  }
}

function renderPalette() {
  const rows = $('#paletteRows');
  const restoreFocus = rows === document.activeElement || rows.contains(document.activeElement);
  $('#paletteSummary').textContent = `${paletteRows.length} 行 · ${paletteCompact ? '縮略選色' : '每行獨立設定'}`;
  $('#paletteCompactToggle').setAttribute('aria-pressed', String(paletteCompact));
  rows.classList.toggle('palette-compact', paletteCompact);
  paletteRows.forEach(row => {
    if (row.colorSpaceGradient) ensureColorSpaceCurve(row);
    if (row.gradientSegments === 'custom') ensurePaletteCustomPositions(row);
  });
  rows.innerHTML = paletteRows.map((row, index) => paletteCompact ? `
    <div class="palette-row-card compact ${selectedPaletteRowId === row.id ? 'selected' : ''}" data-palette-id="${row.id}">
      <span class="palette-compact-name" title="${escapeAttribute(row.name)}"><span class="palette-compact-name-track"><span>${escapeHtml(row.name)}</span><span aria-hidden="true">${escapeHtml(row.name)}</span></span></span>
      ${row.gradient || row.colorSpaceGradient
        ? row.colors.length || row.colorSpaceGradient ? `<div class="gradient-picker compact-gradient" data-gradient-picker="${index}" style="background:${paletteGradientCss(row)}"><i class="gradient-marker" style="left:${insetControlPosition(row.marker)}"></i></div>` : '<span class="palette-empty">空色卡</span>'
        : `<div class="palette-row" data-palette-row="${row.id}">${row.colors.map((color, colorIndex) => `<span class="swatch-item ${selectedPaletteRowId === row.id && selectedPaletteColorIndex === colorIndex ? 'selected' : ''}" data-palette-row-id="${row.id}" data-palette-color-index="${colorIndex}"><button class="swatch" data-color="${color}" style="background:${color}" title="${color}"></button></span>`).join('')}</div>`}
    </div>` : `
    <div class="palette-row-card ${selectedPaletteRowId === row.id ? 'selected' : ''}" data-palette-id="${row.id}">
      <div class="palette-row-controls">
        <span class="palette-row-name" title="${escapeAttribute(row.name)}">${escapeHtml(row.name)}</span>
        <label class="row-gradient-toggle" title="此行使用連續漸變">
          <input type="checkbox" data-gradient-row="${index}" ${row.gradient ? 'checked' : ''} /> 漸變
        </label>
        <label class="row-gradient-toggle" title="在三維色彩空間沿貝塞爾曲線取色；關閉後保留曲線設定">
          <input type="checkbox" data-color-space-row="${index}" ${row.colorSpaceGradient ? 'checked' : ''} /> 色空
        </label>
        <button class="delete-palette-row" data-delete-row="${index}" title="刪除此行">×</button>
      </div>
      ${row.gradient || row.colorSpaceGradient
        ? row.colors.length || row.colorSpaceGradient ? `<div class="palette-gradient-content"><label class="palette-segments-label">漸變分段類別 <select data-gradient-segments="${index}" aria-label="漸變分段類別"><option value="equal" ${row.gradientSegments !== 'custom' && row.gradientSegments !== 'curve_length' ? 'selected' : ''}>平均分</option><option value="custom" ${row.gradientSegments === 'custom' ? 'selected' : ''}>自定義</option>${row.colorSpaceGradient ? `<option value="curve_length" ${row.gradientSegments === 'curve_length' ? 'selected' : ''}>按曲線長度</option>` : ''}</select></label>${gradientBarHtml(row, `data-gradient-picker="${index}"`)}${row.colorSpaceGradient ? `<button class="edit-space-curve" data-edit-space-curve="${index}" title="編輯三維色彩曲線">曲線 ↗</button>` : ''}</div>`
          : `<div class="palette-empty">空色卡 · 先從選色器加入顏色</div>`
        : `<div class="palette-row" data-palette-row="${row.id}">${row.colors.length ? row.colors.map((color, colorIndex) => `<span class="swatch-item ${selectedPaletteRowId === row.id && selectedPaletteColorIndex === colorIndex ? 'selected' : ''}" draggable="true" data-palette-row-id="${row.id}" data-palette-color-index="${colorIndex}"><button class="swatch" data-color="${color}" style="background:${color}" title="${color}"></button></span>`).join('') : `<span class="palette-empty">空色卡 · 從選色器加入顏色</span>`}</div>`}
    </div>`).join('');

  $$('.palette-row-card').forEach(card => card.addEventListener('pointerdown', () => {
    selectedPaletteRowId = card.dataset.paletteId;
    const row = paletteRows.find(entry => entry.id === selectedPaletteRowId);
    const matchingIndex = state.mode === 'paint' && !row?.gradient && !row?.colorSpaceGradient
      ? row.colors.findIndex(color => color.toLowerCase() === state.paintColor)
      : -1;
    selectedPaletteColorIndex = matchingIndex < 0 ? null : matchingIndex;
    $$('.palette-row-card').forEach(entry => entry.classList.toggle('selected', entry === card));
    $$('.swatch-item, .gradient-node-head').forEach(entry => entry.classList.toggle('selected', (entry.dataset.paletteRowId || entry.dataset.gradientRowId) === row?.id && Number(entry.dataset.paletteColorIndex ?? entry.dataset.gradientNode) === selectedPaletteColorIndex));
  }));
  $$('.swatch').forEach(swatch => swatch.addEventListener('click', event => {
    const item = event.currentTarget.closest('.swatch-item');
    selectedPaletteRowId = item.dataset.paletteRowId;
    selectedPaletteColorIndex = Number(item.dataset.paletteColorIndex);
    if (state.mode !== 'paint') snapshot('core.texture.palette');
    applyPaletteColor(swatch.dataset.color);
    renderPalette();
  }));
  $$('.swatch-item').forEach(item => {
    item.addEventListener('dragstart', event => {
      const row = paletteRows.find(entry => entry.id === item.dataset.paletteRowId);
      if (!row || row.gradient) return event.preventDefault();
      draggedPaletteColor = { rowId: row.id, index: Number(item.dataset.paletteColorIndex) };
      event.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragover', event => { if (draggedPaletteColor) event.preventDefault(); });
    item.addEventListener('drop', event => {
      if (!draggedPaletteColor) return;
      event.preventDefault();
      const source = paletteRows.find(entry => entry.id === draggedPaletteColor.rowId);
      const target = paletteRows.find(entry => entry.id === item.dataset.paletteRowId);
      if (!source || !target || target.gradient) return;
      const [color] = source.colors.splice(draggedPaletteColor.index, 1);
      let targetIndex = Number(item.dataset.paletteColorIndex);
      if (source === target && draggedPaletteColor.index < targetIndex) targetIndex--;
      target.colors.splice(targetIndex, 0, color);
      selectedPaletteRowId = target.id;
      selectedPaletteColorIndex = targetIndex;
      draggedPaletteColor = null;
      if (state.mode === 'paint') syncPaletteSelectionToPaintColor();
      renderPalette();
    });
    item.addEventListener('dragend', () => { draggedPaletteColor = null; });
  });
  $$('.palette-row').forEach(rowNode => {
    rowNode.addEventListener('dragover', event => { if (draggedPaletteColor) event.preventDefault(); });
    rowNode.addEventListener('drop', event => {
      if (!draggedPaletteColor || event.target.closest('.swatch-item')) return;
      const source = paletteRows.find(entry => entry.id === draggedPaletteColor.rowId);
      const target = paletteRows.find(entry => entry.id === rowNode.dataset.paletteRow);
      if (!source || !target || target.gradient) return;
      const [color] = source.colors.splice(draggedPaletteColor.index, 1);
      target.colors.push(color);
      selectedPaletteRowId = target.id; selectedPaletteColorIndex = target.colors.length - 1;
      draggedPaletteColor = null;
      if (state.mode === 'paint') syncPaletteSelectionToPaintColor();
      renderPalette();
    });
  });
  $$('[data-gradient-row]').forEach(toggle => toggle.addEventListener('change', () => {
    paletteRows[Number(toggle.dataset.gradientRow)].gradient = toggle.checked;
    renderPalette();
  }));
  $$('[data-color-space-row]').forEach(toggle => toggle.addEventListener('change', () => {
    const row = paletteRows[Number(toggle.dataset.colorSpaceRow)];
    row.colorSpaceGradient = toggle.checked;
    if (row.colorSpaceGradient) ensureColorSpaceCurve(row);
    renderPalette();
  }));
  $$('[data-gradient-segments]').forEach(select => select.addEventListener('change', () => {
    const row = paletteRows[Number(select.dataset.gradientSegments)];
    if (select.value === 'custom') ensurePaletteCustomPositions(row);
    row.gradientSegments = select.value;
    renderPalette();
  }));
  $$('[data-edit-space-curve]').forEach(button => button.addEventListener('click', () => {
    openColorSpaceCurveEditor(paletteRows[Number(button.dataset.editSpaceCurve)]);
  }));
  $$('[data-delete-row]').forEach(button => button.addEventListener('click', () => {
    if (paletteRows.length === 1) return toast('至少保留一行色卡');
    const removed = paletteRows.splice(Number(button.dataset.deleteRow), 1)[0];
    if (removed.id === selectedPaletteRowId) { selectedPaletteRowId = paletteRows[0].id; selectedPaletteColorIndex = null; }
    renderPalette();
  }));
  $$('[data-gradient-picker]', rows).forEach(picker => bindGradientBar(picker, paletteRows[Number(picker.dataset.gradientPicker)], {
    onSelect: index => {
      selectedPaletteColorIndex = index;
      $$('.palette-row-card', rows).forEach(card => card.classList.toggle('selected', card.dataset.paletteId === selectedPaletteRowId));
      $$('[data-gradient-node]', rows).forEach(head => head.classList.toggle('selected', head.dataset.gradientRowId === selectedPaletteRowId && Number(head.dataset.gradientNode) === index));
    },
    onCommit: () => renderPalette()
  }));
  if (paletteCompact) {
    $$('.palette-compact-name', rows).forEach(name => {
      const track = $('.palette-compact-name-track', name);
      const first = track.firstElementChild;
      const distance = first.getBoundingClientRect().width + 12;
      if (distance - 12 > name.clientWidth) {
        name.classList.add('scrolling');
        track.style.setProperty('--marquee-distance', `${distance}px`);
        track.style.setProperty('--marquee-duration', `${Math.max(4, distance / 22)}s`);
      }
    });
  }
  if (restoreFocus) rows.focus({ preventScroll: true });
  if (state.tool === 'gradient' && state.paintGradientPalette) renderPaintGradientPreview();
  savePaletteRows();
}

function addPaletteRow() {
  const number = paletteRows.length + 1;
  paletteRows.push({
    id: crypto.randomUUID(), name: `自定義 ${number}`, gradient: false, marker: .5,
    colors: []
  });
  selectedPaletteRowId = paletteRows.at(-1).id;
  selectedPaletteColorIndex = null;
  renderPalette();
  const rows = $('#paletteRows'); rows.scrollTop = rows.scrollHeight;
}

function sampleGradient(colors, ratio) {
  if (!colors.length) return state.paintColor;
  if (colors.length === 1) return colors[0];
  const scaled = ratio * (colors.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(colors.length - 1, left + 1);
  const amount = scaled - left;
  const a = hexToRgb(colors[left]), b = hexToRgb(colors[right]);
  return `#${a.map((channel, axis) => Math.round(channel + (b[axis] - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function openColorSpaceCurveEditor(row) {
  if (!row) return;
  const curve = ensureColorSpaceCurve(row);
  const dialog = $('#colorSpaceCurveDialog');
  if (dialog.open) return;
  const picker = $('#colorSpacePicker');
  const cards = $('#colorSpaceNodeCards');
  const gradientHost = $('#colorSpaceGradientBarHost');
  const segmentSelect = $('#colorSpaceGradientSegments');
  const savedPaint = {
    paintColor: state.paintColor,
    paintColorPickerHue: state.paintColorPickerHue,
    paintColorPickerSaturation: state.paintColorPickerSaturation,
    paintColorPickerValue: state.paintColorPickerValue
  };
  selectedPaletteRowId = row.id;
  $('#colorSpaceCurveTitle').textContent = `色彩空間漸變 · ${row.name}`;
  $('#colorSpaceMode').value = curve.mode;
  const canvas = $('#colorSpaceCanvas');
  const viewport = new ColorSpaceCurveViewport(canvas, curve, onCurveChanged, selectNode);
  const selectedColor = () => colorAtPosition(curve.nodes[viewport.selected].position, curve.mode);
  const syncPickerToNode = () => {
    const color = selectedColor();
    pickerSession.spaceApply = null;
    setPaintColor(color, false, false, false);
    pickerSession.spaceApply = applyPickerColor;
    if (pickerSession.spaceRoot) updatePaintColorPickerVisual(pickerSession.spaceRoot);
  };
  function selectNode(index) {
    viewport.selected = Math.max(0, Math.min(curve.nodes.length - 1, index));
    selectedPaletteRowId = row.id;
    selectedPaletteColorIndex = viewport.selected;
    syncPickerToNode();
    $$('[data-space-node]', cards).forEach(card => card.classList.toggle('selected', Number(card.dataset.spaceNode) === viewport.selected));
    refreshGradientBar($('.gradient-picker', gradientHost), row);
    viewport.draw();
  }
  function renderCards() {
    cards.innerHTML = curve.nodes.map((node, index) => `<div class="color-space-node-card ${index === viewport.selected ? 'selected' : ''}" data-space-node="${index}" draggable="true">
      <i class="color-space-node-swatch" style="background:${colorAtPosition(node.position, curve.mode)}"></i>
      <strong>${index + 1}</strong>
      <div class="color-space-node-flags">
        <label title="自動切線" aria-label="自動切線"><input type="checkbox" data-space-node-auto="${index}" ${node.autoTangent ? 'checked' : ''}><span aria-hidden="true">⌁</span></label>
        <label title="貝塞爾手柄" aria-label="貝塞爾手柄"><input type="checkbox" data-space-node-handles="${index}" ${node.handlesEnabled ? 'checked' : ''}><span aria-hidden="true">◇</span></label>
        <label title="手柄對稱" aria-label="手柄對稱"><input type="checkbox" data-space-node-symmetric="${index}" ${node.symmetricHandles ? 'checked' : ''}><span aria-hidden="true">↔</span></label>
      </div>
    </div>`).join('');
  }
  function renderEditorGradientBar() {
    segmentSelect.value = row.gradientSegments || 'equal';
    gradientHost.innerHTML = gradientBarHtml(row, 'data-editor-gradient-picker');
    bindGradientBar($('.gradient-picker', gradientHost), row, {
      onSelect: index => selectNode(index),
      onCommit: index => {
        viewport.selected = index;
        renderCards();
        renderPalette();
        renderEditorGradientBar();
        viewport.draw();
      }
    });
  }
  function updateCurveBar() {
    const index = paletteRows.indexOf(row);
    const bar = $(`[data-gradient-picker="${index}"]`);
    if (bar && $$('[data-gradient-node]', bar).length === curve.nodes.length) refreshGradientBar(bar, row);
    const editorBar = $('.gradient-picker', gradientHost);
    if (editorBar && $$('[data-gradient-node]', editorBar).length === curve.nodes.length) refreshGradientBar(editorBar, row);
    else renderEditorGradientBar();
  }
  function onCurveChanged(committed = true) {
    const activeCard = $(`[data-space-node="${viewport.selected}"]`, cards);
    const swatch = activeCard?.querySelector('.color-space-node-swatch');
    if (swatch) swatch.style.background = selectedColor();
    syncPickerToNode();
    updateCurveBar();
    if (state.tool === 'gradient' && state.paintGradientPalette) renderPaintGradientPreview();
    if (committed) { alignPaletteColorsToCurve(row); savePaletteRows(); }
  }
  function applyPickerColor(color) {
    const node = curve.nodes[viewport.selected];
    if (!node) return;
    node.position = positionForColor(color, curve.mode);
    curve.revision++;
    viewport.draw();
    const swatch = $(`[data-space-node="${viewport.selected}"] .color-space-node-swatch`, cards);
    if (swatch) swatch.style.background = color;
    row.colors[viewport.selected] = color;
    updateCurveBar();
    if (state.tool === 'gradient' && state.paintGradientPalette) renderPaintGradientPreview();
    savePaletteRows();
  }
  pickerSession.spaceRoot = picker;
  pickerSession.spaceApply = null;
  syncPickerToNode();
  renderPaintColorPicker(picker);
  pickerSession.spaceApply = applyPickerColor;
  renderCards();
  renderEditorGradientBar();
  segmentSelect.onchange = () => {
    if (segmentSelect.value === 'custom') ensurePaletteCustomPositions(row);
    row.gradientSegments = segmentSelect.value;
    renderPalette();
    renderEditorGradientBar();
    if (state.tool === 'gradient' && state.paintGradientPalette) renderPaintGradientPreview();
    savePaletteRows();
  };
  cards.addEventListener('click', event => {
    const card = event.target.closest('[data-space-node]');
    if (card && !event.target.closest('label')) selectNode(Number(card.dataset.spaceNode));
  });
  cards.addEventListener('change', event => {
    const index = Number(event.target.dataset.spaceNodeAuto ?? event.target.dataset.spaceNodeHandles ?? event.target.dataset.spaceNodeSymmetric);
    const node = curve.nodes[index];
    if (!node) return;
    selectNode(index);
    if (event.target.hasAttribute('data-space-node-auto')) node.autoTangent = event.target.checked;
    if (event.target.hasAttribute('data-space-node-handles')) node.handlesEnabled = event.target.checked;
    if (event.target.hasAttribute('data-space-node-symmetric')) {
      node.symmetricHandles = event.target.checked;
      if (node.symmetricHandles) node.handleIn = node.handleOut.map(value => -value);
    }
    curve.revision++;
    viewport.draw(); updateCurveBar(); savePaletteRows();
  });
  let draggedIndex = null;
  cards.addEventListener('dragstart', event => {
    const card = event.target.closest('[data-space-node]');
    if (!card) return;
    draggedIndex = Number(card.dataset.spaceNode);
    event.dataTransfer.effectAllowed = 'move';
  });
  cards.addEventListener('dragover', event => { if (draggedIndex !== null) event.preventDefault(); });
  cards.addEventListener('drop', event => {
    const card = event.target.closest('[data-space-node]');
    if (!card || draggedIndex === null) return;
    event.preventDefault();
    const target = Number(card.dataset.spaceNode);
    const [node] = curve.nodes.splice(draggedIndex, 1);
    curve.nodes.splice(target, 0, node);
    draggedIndex = null;
    viewport.selected = target;
    curve.revision++; renderCards(); onCurveChanged(); renderPalette(); viewport.draw();
  });
  cards.addEventListener('dragend', () => { draggedIndex = null; });
  $('#colorSpaceMode').onchange = event => {
    changeColorSpaceMode(curve, event.target.value);
    renderCards(); onCurveChanged(); viewport.draw();
  };
  $('#colorSpaceAxis').value = 'all';
  $('#colorSpaceAxis').onchange = event => { viewport.axisMode = event.target.value; viewport.draw(); };
  $('#colorSpacePerspective').checked = false;
  $('#colorSpacePerspective').onchange = event => { viewport.perspective = event.target.checked; viewport.draw(); };
  $('#colorSpaceAddNode').onclick = () => {
    const index = viewport.selected;
    const ratio = Math.min(1, (index + .5) / Math.max(1, curve.nodes.length - 1));
    const position = constrainColorPosition(sampleColorSpacePosition(curve, ratio), curve.mode);
    const next = { id: crypto.randomUUID(), position, handlesEnabled: true, autoTangent: true,
      symmetricHandles: true, handleIn: [-.12, 0, 0], handleOut: [.12, 0, 0] };
    insertPalettePosition(row, index + 1);
    curve.nodes.splice(index + 1, 0, next);
    viewport.selected = index + 1;
    curve.revision++; renderCards(); onCurveChanged(); renderPalette(); viewport.draw();
  };
  $('#colorSpaceDeleteNode').onclick = () => {
    if (curve.nodes.length <= 2) return toast('曲線至少需要兩個節點');
    removePalettePosition(row, viewport.selected);
    curve.nodes.splice(viewport.selected, 1);
    viewport.selected = Math.min(viewport.selected, curve.nodes.length - 1);
    curve.revision++; renderCards(); onCurveChanged(); renderPalette(); viewport.draw();
  };
  $('#closeColorSpaceCurve').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    viewport.dispose();
    canvas.replaceWith(canvas.cloneNode(false));
    cards.replaceWith(cards.cloneNode(false));
    segmentSelect.onchange = null;
    gradientHost.replaceChildren();
    pickerSession.spaceRoot = null;
    pickerSession.spaceApply = null;
    Object.assign(state, savedPaint);
    if (state.mode === 'paint') renderInspector();
    savePaletteRows();
  }, { once: true });
  dialog.showModal();
  viewport.draw();
  updatePaintColorPickerVisual(pickerSession.spaceRoot);
}

function addPaintSwatchToSelection() {
  const row = paletteRows.find(entry => entry.id === selectedPaletteRowId) || paletteRows[0];
  if (!row) return;
  const insertion = selectedPaletteColorIndex === null ? paletteNodeCount(row) : selectedPaletteColorIndex + 1;
  if (row.gradient || row.colorSpaceGradient) {
    const positions = paletteGradientPositions(row);
    const before = positions[Math.max(0, insertion - 1)] ?? 0;
    const after = positions[Math.min(positions.length - 1, insertion)] ?? 1;
    insertPaletteGradientNode(row, (before + after) / 2, state.paintColor, insertion);
    toast(`已加入「${row.name}」 ${state.paintColor}`);
    return;
  }
  row.colors.splice(insertion, 0, state.paintColor);
  selectedPaletteRowId = row.id;
  selectedPaletteColorIndex = insertion;
  renderPalette();
  toast(`已加入「${row.name}」 ${state.paintColor}`);
}

function deleteSelectedPaletteColor(rowId = selectedPaletteRowId, colorIndex = selectedPaletteColorIndex) {
  if (paletteCompact) return;
  const row = paletteRows.find(entry => entry.id === rowId);
  if (!row || colorIndex === null || colorIndex < 0 || colorIndex >= paletteNodeCount(row)) return;
  if (row.colorSpaceGradient && row.colorSpaceCurve.nodes.length <= 2) return toast('曲線至少需要兩個節點');
  alignPaletteColorsToCurve(row);
  removePalettePosition(row, colorIndex);
  if (row.colorSpaceGradient) { row.colorSpaceCurve.nodes.splice(colorIndex, 1); row.colorSpaceCurve.revision++; }
  if (row.colors[colorIndex]) row.colors.splice(colorIndex, 1);
  selectedPaletteRowId = row.id;
  selectedPaletteColorIndex = null;
  if (state.mode === 'paint') syncPaletteSelectionToPaintColor();
  renderPalette();
}

function applyPaletteColor(color, notify = true, recordHistory = true) {
  if (state.mode === 'paint') {
    setPaintColor(color, notify, false, recordHistory);
    return;
  }
  const item = selected();
  if (!item) return toast('先選擇一個物件');
  noteJournalOperation('core.element.color');
  item.color = color;
  markDirty(); renderAll('selection');
  if (notify) toast(`已套用 ${color}`);
}
  return {
    paletteRows, renderPalette, renderPaintColorHistory, recordPaintColorHistory,
    syncPaletteSelectionToPaintColor, samplePaletteGradient, addPaletteRow,
    openColorSpaceCurveEditor, addPaintSwatchToSelection, deleteSelectedPaletteColor, applyPaletteColor,
    get selectedRowId() { return selectedPaletteRowId; },
    set selectedRowId(value) { selectedPaletteRowId = value; },
    get selectedColorIndex() { return selectedPaletteColorIndex; },
    set selectedColorIndex(value) { selectedPaletteColorIndex = value; },
    get draggedColor() { return draggedPaletteColor; },
    set draggedColor(value) { draggedPaletteColor = value; },
    get compact() { return paletteCompact; },
    set compact(value) { paletteCompact = Boolean(value); },
    saveCompactPreference() { localStorage.setItem(PALETTE_COMPACT_KEY, String(paletteCompact)); }
  };
}
