import { createThemeController } from './theme/controller.js';
import { ConfigKey, applyLanguage, getLanguageLabel, translateUiText, TOOL_TRANSFORM_SPACE } from '../common/config/app-config.js';

export function createSettingsController({
  state, $, $$, sceneRenderer, hexToRgb, renderScene, toast,
  configRegistry, languageSelect, modelFormatRegistry, getDockManager,
  setMode, updateToolVisibility, applyModePanelVisibility,
  toolSupportsMode, setTool, updateSnapButton, updatePlayerReferenceTexture,
  clearSelection, updateProjectionControls, animateLockedHoverStrength, updateToolOptions
}) {
  const { setThemeVar, saveTheme, loadTheme, applyPreset } = createThemeController({
    $, $$, sceneRenderer, hexToRgb, renderScene, toast, configRegistry
  });

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
      languageSelect.value = value;
      applyLanguage(value);
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
        if (!toolSupportsMode(state.tool)) setTool(state.mode === 'uv' ? 'faceSelect' : 'move', { remember: false });
      }
    }
    if (id === ConfigKey.BLOCKBENCH_CONTROLS) {
      state.blockbenchControls = value;
      renderScene();
    }
    if (id === TOOL_TRANSFORM_SPACE[state.tool]) {
      state.transformSpace = value;
      updateToolOptions();
    }
    if (id === ConfigKey.TOOLBOX_FLIP_NAMES) {
      state.toolboxRenameDirections = value;
      updateToolOptions();
    }
    if (id === ConfigKey.SNAP) {
      state.settingsSnap = value;
      updateSnapButton();
    }
    if (id === ConfigKey.ALLOW_NEGATIVE_SIZE) {
      state.allowNegativeSize = value;
      $('#negativeShapeToggle').checked = value;
    }
    if (id === ConfigKey.PAINT_EXPLODE_GAP) state.paintExplodeGap = value;
    if (id === ConfigKey.PAINT_SCREEN_HEIGHT) state.paintScreenHeight = value;
    if (id === ConfigKey.SHIFT_SNAP_MODE) state.modifierSnap.shift.mode = value;
    if (id === ConfigKey.SHIFT_SNAP_VALUE) state.modifierSnap.shift.value = value;
    if (id === ConfigKey.CTRL_SNAP_MODE) state.modifierSnap.ctrl.mode = value;
    if (id === ConfigKey.CTRL_SNAP_VALUE) state.modifierSnap.ctrl.value = value;
    if (id === ConfigKey.SHIFT_CTRL_SNAP_MODE) state.modifierSnap.shiftCtrl.mode = value;
    if (id === ConfigKey.SHIFT_CTRL_SNAP_VALUE) state.modifierSnap.shiftCtrl.value = value;
    if (id === ConfigKey.ALPHA_LOCK) {
      state.alphaLock = value;
      $('#alphaLockToggle').checked = value;
    }
    if (id === ConfigKey.PREVIEW_SHADE) {
      state.previewShade = value;
      $('#previewShadeToggle').checked = value;
    }
    if (id === ConfigKey.SHOW_PLAYER_REFERENCE) {
      state.playerReference = value;
      $('#playerReferenceToggle').checked = value;
    }
    if (id === ConfigKey.PLAYER_REFERENCE_TEXTURE) updatePlayerReferenceTexture(value);
    if (id === ConfigKey.SHOW_GEOMETRY_ONLY) {
      state.geometryOnly = value;
      $('#geometryOnlyToggle').checked = value;
    }
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
    if (id === ConfigKey.SHOW_GRID) {
      state.grid = value;
      const button = $('[data-action="grid"]');
      if (button) button.setAttribute('aria-pressed', String(value));
    }
    if (id === ConfigKey.BACKGROUND_MODE) {
      state.backgroundMode = value;
      $('#viewport').dataset.backgroundMode = value;
      const button = $('[data-action="background"]');
      if (button) {
        button.title = translateUiText(`背景：${({ black: '純黑', current: '目前背景', grid: '棋盤格' })[value]}`);
        button.textContent = ({ black: '●', current: '◐', grid: '▦' })[value];
      }
    }
    if (id === ConfigKey.SHOW_WIREFRAME) state.wire = value;
    if (id === ConfigKey.CUBE_BIRTH_MS) state.cubeBirthMs = value;
    if (id === ConfigKey.CUBE_DEATH_MS) state.cubeDeathMs = value;
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
