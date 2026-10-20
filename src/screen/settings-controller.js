import { ConfigKey, applyLanguage, getLanguageLabel } from '../common/config/app-config.js';

export function createSettingsController({
  state, $, $$, sceneRenderer, hexToRgb, renderScene, toast,
  configRegistry, languageSelect, modelFormatRegistry, getDockManager,
  setMode, updateToolVisibility, applyModePanelVisibility,
  toolSupportsMode, setTool, updateSnapButton, updatePlayerReferenceTexture,
  clearSelection, updateProjectionControls, animateLockedHoverStrength
}) {
const themePresets = {
  moss: { '--accent': '#b9f55a', '--selection-outline': '#d8f59b', '--bg': '#11130f', '--panel': '#1b1f18', '--viewport': '#20251e', '--panel-2': '#22271f', '--panel-3': '#292f25', '--text': '#e9eee3', '--muted': '#8f9b86', '--subtle': '#5f6959', '--line': 'rgba(226, 239, 213, .1)', '--line-strong': 'rgba(226, 239, 213, .18)', '--danger': '#ff7d68', '--accent-contrast': '#17200e', '--surface-tint': '#2b3327', '--dialog-tint': '#38432e', '--viewport-glow': '#53604d' },
  amber: { '--accent': '#e6a20d', '--selection-outline': '#fff0c8', '--bg': '#140904', '--panel': '#1c0d06', '--viewport': '#21120b', '--panel-2': '#241108', '--panel-3': '#2d160b', '--text': '#fff4d8', '--muted': '#c7a77a', '--subtle': '#765738', '--line': 'rgba(255, 224, 171, .11)', '--line-strong': 'rgba(255, 224, 171, .2)', '--danger': '#ff765f', '--accent-contrast': '#261306', '--surface-tint': '#3a1c0b', '--dialog-tint': '#4a260e', '--viewport-glow': '#5a3518' },
  ember: { '--accent': '#ff9d57', '--selection-outline': '#ffd0a6', '--bg': '#160f0e', '--panel': '#241917', '--viewport': '#291d1b', '--panel-2': '#2d201d', '--panel-3': '#362623', '--text': '#f3e7e0', '--muted': '#aa8d82', '--subtle': '#755d55', '--line': 'rgba(255, 220, 202, .1)', '--line-strong': 'rgba(255, 220, 202, .18)', '--danger': '#ff7565', '--accent-contrast': '#27110b', '--surface-tint': '#3c2420', '--dialog-tint': '#4a2d27', '--viewport-glow': '#5a3931' },
  slate: { '--accent': '#65d7e8', '--selection-outline': '#a7f0fa', '--bg': '#0d1115', '--panel': '#171e24', '--viewport': '#1b242b', '--panel-2': '#1d2830', '--panel-3': '#25323b', '--text': '#e4eef2', '--muted': '#8b9da7', '--subtle': '#5c6c75', '--line': 'rgba(211, 237, 245, .1)', '--line-strong': 'rgba(211, 237, 245, .18)', '--danger': '#ff7d68', '--accent-contrast': '#092126', '--surface-tint': '#263640', '--dialog-tint': '#304550', '--viewport-glow': '#405965' }
};

const themeVariableKeys = [...new Set(Object.values(themePresets).flatMap(preset => Object.keys(preset)))];

function setThemeVar(key, value, persist = true) {
  document.documentElement.style.setProperty(key, value);
  if (key === '--accent') document.documentElement.style.setProperty('--accent-rgb', hexToRgb(value).join(', '));
  if (key === '--selection-outline') sceneRenderer.setSelectionOutline(value);
  if (key === '--radius') $('#radiusOutput').textContent = value;
  if (key === '--ui-scale') {
    const scale = Math.max(1, Number.parseFloat(value) || 100) / 100;
    document.documentElement.style.fontSize = `${21 * scale}px`;
    $('#scaleOutput').textContent = value;
  }
  if (persist) saveTheme();
  renderScene();
}

function saveTheme() {
  const computed = getComputedStyle(document.documentElement);
  const theme = Object.fromEntries(themeVariableKeys.map(key => [key, computed.getPropertyValue(key).trim()]));
  $$('[data-theme-var]').forEach(input => theme[input.dataset.themeVar] = input.dataset.unit ? `${input.value}${input.dataset.unit}` : input.value);
  localStorage.setItem('cubebricks.theme', JSON.stringify(theme));
}

function loadTheme() {
  const raw = localStorage.getItem('cubebricks.theme');
  if (!raw) return;
  try {
    const theme = JSON.parse(raw);
    Object.entries(theme).forEach(([key, value]) => {
      setThemeVar(key, value, false);
      const input = $(`[data-theme-var="${key}"]`);
      if (input) input.value = String(value).replace(input.dataset.unit || '', '');
    });
  } catch { localStorage.removeItem('cubebricks.theme'); }
}

function applyPreset(name) {
  Object.entries(themePresets[name]).forEach(([key, value]) => {
    const input = $(`[data-theme-var="${key}"]`); if (input) input.value = value;
    setThemeVar(key, value, false);
  });
  saveTheme(); toast('外觀已套用');
}

function initializeConfigRegistry() {
  configRegistry.list().forEach(definition => applyRegisteredConfig(definition.id, configRegistry.get(definition.id), false));
  configRegistry.subscribe(change => applyRegisteredConfig(change.id, change.value, true));

  window.CubeBricks = Object.freeze({
    config: Object.freeze({
      get: id => configRegistry.get(id),
      set: (id, value) => configRegistry.set(id, value, { source: 'public-api' }),
      reset: id => configRegistry.reset(id, { source: 'public-api' }),
      list: () => configRegistry.list(),
      subscribe: (id, listener) => configRegistry.subscribe(id, listener)
    }),
    docks: Object.freeze({
      list: () => getDockManager()?.getIndex() || [],
      get: id => getDockManager()?.getIndex().find(panel => panel.id === id) || null
    }),
    formats: Object.freeze({
      list: () => modelFormatRegistry.list(),
      get: id => modelFormatRegistry.get(id),
      current: () => modelFormatRegistry.get(state.project.formatId),
      register: definition => modelFormatRegistry.register(definition),
      subscribe: listener => modelFormatRegistry.subscribe(listener)
    })
  });
}

function applyRegisteredConfig(id, value, notify = false) {
  const control = $(`[data-config-key="${id}"]`);
  if (control) control.type === 'checkbox' ? control.checked = Boolean(value) : control.value = String(value);

  if (id === ConfigKey.LANGUAGE) {
    languageSelect.value = value; applyLanguage(value);
    if (notify) toast(`介面語言：${getLanguageLabel(value)}`);
  }
  if (id === ConfigKey.SEPARATE_UV_MODE) {
    state.separateUvMode = value;
    $('#uvModeTab').hidden = !value;
    if (!value && state.mode === 'uv') setMode('edit');
    else {
      updateToolVisibility();
      getDockManager()?.setMode(state.mode);
      applyModePanelVisibility();
      if (!toolSupportsMode(state.tool)) setTool(state.mode === 'uv' ? 'faceSelect' : 'move');
    }
  }
  if (id === ConfigKey.SNAP) {
    state.settingsSnap = value;
    updateSnapButton();
  }
  if (id === ConfigKey.ALLOW_NEGATIVE_SIZE) state.allowNegativeSize = value;
  if (id === ConfigKey.SHIFT_SNAP_MODE) state.modifierSnap.shift.mode = value;
  if (id === ConfigKey.SHIFT_SNAP_VALUE) state.modifierSnap.shift.value = value;
  if (id === ConfigKey.CTRL_SNAP_MODE) state.modifierSnap.ctrl.mode = value;
  if (id === ConfigKey.CTRL_SNAP_VALUE) state.modifierSnap.ctrl.value = value;
  if (id === ConfigKey.SHIFT_CTRL_SNAP_MODE) state.modifierSnap.shiftCtrl.mode = value;
  if (id === ConfigKey.SHIFT_CTRL_SNAP_VALUE) state.modifierSnap.shiftCtrl.value = value;
  if (id === ConfigKey.ALPHA_LOCK) { state.alphaLock = value; $('#alphaLockToggle').checked = value; }
  if (id === ConfigKey.PREVIEW_SHADE) { state.previewShade = value; $('#previewShadeToggle').checked = value; }
  if (id === ConfigKey.SHOW_PLAYER_REFERENCE) { state.playerReference = value; $('#playerReferenceToggle').checked = value; }
  if (id === ConfigKey.PLAYER_REFERENCE_TEXTURE) updatePlayerReferenceTexture(value);
  if (id === ConfigKey.SHOW_GEOMETRY_ONLY) { state.geometryOnly = value; $('#geometryOnlyToggle').checked = value; }
  if (id === ConfigKey.MODIFIER_RESULT_GHOST) {
    state.modifierResultGhost = value;
    $('#modifierResultGhostToggle').checked = value;
    if (value && state.selectedGenerated) clearSelection();
  }
  if (id === ConfigKey.PROJECTION) {
    if (state.projection && state.projection !== value) {
      if (state.axisView && state.generalCamera) {
        state.generalCamera.zoom = mapProjectionZoom(state.generalCamera.zoom, state.projection, value);
      } else state.zoom = mapProjectionZoom(state.zoom, state.projection, value);
    }
    state.projection = value;
    updateProjectionControls();
  }
  if (id === ConfigKey.SHOW_GRID) state.grid = value;
  if (id === ConfigKey.SHOW_WIREFRAME) state.wire = value;
  if (id === ConfigKey.LOCKED_DEFAULT_ALPHA) state.lockedDefaultAlpha = value;
  if (id === ConfigKey.LOCKED_HOVER_FADE) {
    state.lockedHoverFade = value;
    if (!value) animateLockedHoverStrength(false);
  }
  if (id === ConfigKey.LOCKED_HOVER_ALPHA) state.lockedHoverAlpha = value;
  if (id === ConfigKey.LOCKED_HOVER_RADIUS) state.lockedHoverRadius = value;
  if (notify && id !== ConfigKey.LANGUAGE) renderScene();
}

function mapProjectionZoom(zoom, fromProjection, toProjection) {
  if (fromProjection === toProjection) return zoom;
  const perspectiveHalfHeightAtUnitZoom = 42 * Math.tan(45 * Math.PI / 360);
  const orthographicHalfHeightAtUnitZoom = 18;
  const mapped = fromProjection === 'perspective' && toProjection === 'orthographic'
    ? zoom * orthographicHalfHeightAtUnitZoom / perspectiveHalfHeightAtUnitZoom
    : zoom * perspectiveHalfHeightAtUnitZoom / orthographicHalfHeightAtUnitZoom;
  return Math.max(.002, Math.min(100, mapped));
}

function setConfigFromControl(control) {
  const definition = configRegistry.getDefinition(control.dataset.configKey);
  let value = control.type === 'checkbox' ? control.checked : control.value;
  if (definition.type === 'number') value = Number(value);
  if (definition.type === 'enum') value = definition.options.find(option => String(option.value) === String(value))?.value;
  try {
    configRegistry.set(definition.id, value, { source: 'settings-panel' });
  } catch {
    control.type === 'checkbox' ? control.checked = Boolean(configRegistry.get(definition.id)) : control.value = String(configRegistry.get(definition.id));
    toast('這個配置值無效');
  }
}

return {
  setThemeVar,
  saveTheme,
  loadTheme,
  applyPreset,
  initializeConfigRegistry,
  applyRegisteredConfig,
  mapProjectionZoom,
  setConfigFromControl,
};
}
