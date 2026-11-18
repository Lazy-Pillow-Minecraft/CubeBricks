import { ConfigKey, translateUiText } from '../../common/config/app-config.js';
import { DARK_THEME_PRESETS, THEME_PRESETS, THEME_COLOR_KEYS, resolveThemeMode, themeColors } from './presets.js';

const STORAGE_KEY = 'cubebricks.theme.v2';
const LEGACY_KEY = 'cubebricks.theme';
const SHARED_KEYS = ['--radius', '--ui-scale'];
const validColors = value => Object.fromEntries(THEME_COLOR_KEYS
  .filter(key => typeof value?.[key] === 'string').map(key => [key, value[key]]));

export function createThemeController({ $, $$, sceneRenderer, hexToRgb, renderScene, toast, configRegistry }) {
  let preferences = { preset: 'moss', overrides: { light: {}, dark: {} }, shared: {} };
  let activeMode = 'dark', loaded = false;
  let systemScheme = null;
  let editRevision = 0, updatedAt = 0, restoring = false;

  function writeVariable(key, value) {
    document.documentElement.style.setProperty(key, value);
    if (key === '--accent') document.documentElement.style.setProperty('--accent-rgb', hexToRgb(value).join(', '));
    if (key === '--selection-outline') sceneRenderer.setSelectionOutline(value);
    const input = $(`[data-theme-var="${key}"]`);
    if (input) input.value = String(value).replace(input.dataset.unit || '', '');
    if (key === '--radius') $('#radiusOutput').textContent = value;
    if (key === '--ui-scale') {
      const scale = Math.max(1, Number.parseFloat(value) || 100) / 100;
      document.documentElement.style.fontSize = `${21 * scale}px`;
      $('#scaleOutput').textContent = value;
    }
  }

  function applyTheme() {
    activeMode = resolveThemeMode(configRegistry.get(ConfigKey.THEME_MODE), systemScheme?.matches ?? true);
    const root = document.documentElement;
    root.dataset.colorScheme = activeMode;
    root.dataset.themeStyle = THEME_PRESETS[preferences.preset].style;
    root.style.colorScheme = activeMode;
    const colors = {
      ...themeColors(preferences.preset, activeMode), ...preferences.overrides[activeMode], ...preferences.shared
    };
    for (const [key, value] of Object.entries(colors)) writeVariable(key, value);
    $$('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === preferences.preset)));
    renderScene();
  }

  function saveTheme() {
    const saved = { ...preferences, mode: configRegistry.get(ConfigKey.THEME_MODE), updatedAt: Date.now() };
    updatedAt = saved.updatedAt;
    let localError = null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
    catch (error) { localError = error; }
    const desktop = window.cubeBricksDesktop;
    if (desktop?.saveAppearance) return desktop.saveAppearance(saved).catch(error => {
      console.warn('CubeBricks appearance save failed:', error);
      toast(translateUiText('ui.appearance-save-failed'));
    });
    if (localError) {
      console.warn('CubeBricks appearance save failed:', localError);
      toast(translateUiText('ui.appearance-save-failed'));
    }
  }

  function setThemeVar(key, value, persist = true) {
    if (SHARED_KEYS.includes(key)) preferences.shared[key] = value;
    else if (THEME_COLOR_KEYS.includes(key)) preferences.overrides[activeMode][key] = value;
    else return;
    editRevision++;
    if (persist) saveTheme();
    writeVariable(key, value);
    renderScene();
  }

  function loadTheme() {
    let migrateLegacy = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        updatedAt = Number(saved.updatedAt) || 0;
        preferences.preset = Object.hasOwn(THEME_PRESETS, saved.preset) ? saved.preset : 'moss';
        preferences.overrides = { light: validColors(saved.overrides?.light), dark: validColors(saved.overrides?.dark) };
        for (const key of SHARED_KEYS) if (typeof saved.shared?.[key] === 'string') preferences.shared[key] = saved.shared[key];
      } else {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
        if (legacy && typeof legacy === 'object') {
          preferences.preset = Object.keys(DARK_THEME_PRESETS).find(name =>
            DARK_THEME_PRESETS[name]['--accent'] === legacy['--accent']) || 'moss';
          preferences.overrides.dark = validColors(legacy);
          for (const key of SHARED_KEYS) if (typeof legacy[key] === 'string') preferences.shared[key] = legacy[key];
          migrateLegacy = true;
        }
      }
    } catch {
      preferences = { preset: 'moss', overrides: { light: {}, dark: {} }, shared: {} };
    }
    if (!loaded) {
      loaded = true;
      systemScheme = window.matchMedia?.('(prefers-color-scheme: dark)') || null;
      systemScheme?.addEventListener('change', () => {
        if (configRegistry.get(ConfigKey.THEME_MODE) === 'system') applyTheme();
      });
      configRegistry.subscribe(ConfigKey.THEME_MODE, () => {
        if (!restoring) { editRevision++; saveTheme(); }
        applyTheme();
      });
    }
    applyTheme();
    const desktop = window.cubeBricksDesktop;
    if (!desktop?.loadAppearance) {
      if (migrateLegacy) saveTheme();
      return;
    }
    const revision = editRevision;
    return desktop.loadAppearance().then(saved => {
      // An already-interactive window may receive a late read. Never replace a
      // theme the user just chose while that read was in flight.
      if (editRevision !== revision) return;
      if (!saved || !Object.hasOwn(THEME_PRESETS, saved.preset) || (Number(saved.updatedAt) || 0) < updatedAt) return saveTheme();
      preferences = {
        preset: saved.preset,
        overrides: { light: validColors(saved.overrides?.light), dark: validColors(saved.overrides?.dark) },
        shared: Object.fromEntries(SHARED_KEYS.filter(key => typeof saved.shared?.[key] === 'string').map(key => [key, saved.shared[key]]))
      };
      updatedAt = Number(saved.updatedAt) || 0;
      restoring = true;
      try {
        if (['system', 'light', 'dark'].includes(saved.mode)) configRegistry.set(ConfigKey.THEME_MODE, saved.mode, { source: 'appearance-restore' });
      } finally { restoring = false; }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* Desktop file is authoritative. */ }
      applyTheme();
    }).catch(error => console.warn('CubeBricks appearance restore failed:', error));
  }

  function applyPreset(name) {
    if (!Object.hasOwn(THEME_PRESETS, name)) return;
    preferences.preset = name;
    preferences.overrides = { light: {}, dark: {} };
    editRevision++;
    saveTheme();
    applyTheme();
    toast('外觀已套用');
  }

  return { setThemeVar, saveTheme, loadTheme, applyPreset };
}
