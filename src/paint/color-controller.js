import { rgbToHsv } from '../screen/color-picker/math.js';
import { PAINT_ERASE_TOOLS } from '../editor/tool-registry.js';

export function createPaintColorController({
  state, $, pickerSession, syncPaletteSelectionToPaintColor,
  recordPaintColorHistory, hexToRgb, updatePaintColorPickerVisual,
  renderPaintGradientPreview, toast, updateToolOptions, clamp
}) {
function setPaintColor(color, notify = false, preservePickerHue = false, recordHistory = true) {
  if (!/^#[0-9a-f]{6}$/i.test(String(color))) return;
  state.paintColor = String(color).toLowerCase();
  if (!pickerSession.popupRoot && !pickerSession.spaceRoot) {
    syncPaletteSelectionToPaintColor();
    if (recordHistory) recordPaintColorHistory(state.paintColor);
  }
  if (!pickerSession.popupRoot && !pickerSession.spaceRoot && state.tool === 'gradient' && !state.paintGradientPalette) {
    if (state.paintGradientStop === 'end') state.paintGradientEnd = state.paintColor;
    else state.paintGradientStart = state.paintColor;
  }
  const [hue, saturation, value] = rgbToHsv(hexToRgb(state.paintColor));
  if (!preservePickerHue) {
    if (saturation > 1e-4 && value > 1e-4) state.paintColorPickerHue = hue;
    state.paintColorPickerSaturation = saturation;
    state.paintColorPickerValue = value;
  }
  const startButton = $('#paintGradientStartControl'), endButton = $('#paintGradientEndControl');
  startButton?.style.setProperty('--gradient-color', state.paintGradientStart);
  endButton?.style.setProperty('--gradient-color', state.paintGradientEnd);
  updatePaintColorPickerVisual();
  if (pickerSession.spaceRoot) pickerSession.spaceApply?.(state.paintColor);
  renderPaintGradientPreview();
  if (notify) toast(`繪畫顏色 ${state.paintColor}`);
}

function selectPaintGradientStop(stop) {
  state.paintGradientStop = stop === 'end' ? 'end' : 'start';
  setPaintColor(state.paintGradientStop === 'end' ? state.paintGradientEnd : state.paintGradientStart);
  updateToolOptions();
}

function paintSetting(tool = state.tool) {
  return tool === 'brush'
    ? { size: state.paintBrushSize, opacity: state.paintBrushOpacity, erase: state.paintBrushErase }
    : state.paintToolSettings[tool] || { size: 1, opacity: 100, erase: false };
}

function paintToolErasing(tool = state.tool) {
  return PAINT_ERASE_TOOLS.includes(tool) && paintSetting(tool).erase === true;
}

function paintToolOpacity(tool = state.tool) {
  return clamp(Number(paintSetting(tool).opacity) || 100, 1, 100) / 100;
}

return {
  setPaintColor,
  selectPaintGradientStop,
  paintSetting,
  paintToolErasing,
  paintToolOpacity,
};
}
