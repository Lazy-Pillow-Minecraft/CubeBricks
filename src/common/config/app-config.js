import { ConfigRegistry, ConfigScope, ConfigType } from '../core/config-registry.js';
import { translateEnglishUiText } from '../i18n/english.js';
import { UI_MESSAGES } from '../i18n/messages.js';
import { toSimplified } from '../i18n/simplified.js';
import { performanceMonitor } from '../../utils/performance-monitor.js';

export const AppLanguage = Object.freeze({
  SYSTEM: 'system',
  TRADITIONAL_CHINESE: 'zh-Hant',
  SIMPLIFIED_CHINESE: 'zh-Hans',
  ENGLISH: 'en'
});

export const ConfigKey = Object.freeze({
  LANGUAGE: 'application.language',
  FONT: 'application.font',
  HISTORY_LIMIT: 'application.history-limit',
  SEPARATE_UV_MODE: 'editor.separate-uv-mode',
  BLOCKBENCH_CONTROLS: 'editor.blockbench-controls',
  SNAP: 'editor.snap-subdivisions',
  ALLOW_NEGATIVE_SIZE: 'editor.allow-negative-size',
  MOVE_SPACE: 'editor.move-space',
  ROTATE_SPACE: 'editor.rotate-space',
  PIVOT_SPACE: 'editor.pivot-space',
  PAINT_EXPLODE_GAP: 'paint.explode-gap',
  PAINT_SCREEN_HEIGHT: 'paint.screen-height',
  PAINT_SELECTION_SAMPLING: 'paint.selection-sampling',
  SHIFT_SNAP_MODE: 'editor.snap-shift-mode',
  SHIFT_SNAP_VALUE: 'editor.snap-shift-value',
  CTRL_SNAP_MODE: 'editor.snap-ctrl-mode',
  CTRL_SNAP_VALUE: 'editor.snap-ctrl-value',
  SHIFT_CTRL_SNAP_MODE: 'editor.snap-shift-ctrl-mode',
  SHIFT_CTRL_SNAP_VALUE: 'editor.snap-shift-ctrl-value',
  ALPHA_LOCK: 'paint.alpha-lock',
  PROJECTION: 'viewport.projection',
  PREVIEW_SHADE: 'viewport.preview-shade',
  SHOW_PLAYER_REFERENCE: 'viewport.show-player-reference',
  PLAYER_REFERENCE_TEXTURE: 'viewport.player-reference-texture',
  SHOW_GEOMETRY_ONLY: 'viewport.show-geometry-only',
  MODIFIER_RESULT_GHOST: 'viewport.modifier-result-ghost',
  SHOW_GRID: 'viewport.show-grid',
  BACKGROUND_MODE: 'viewport.background-mode',
  SHOW_WIREFRAME: 'viewport.show-wireframe',
  CUBE_BIRTH_MS: 'viewport.cube-birth-ms',
  CUBE_DEATH_MS: 'viewport.cube-death-ms',
  LOCKED_DEFAULT_ALPHA: 'viewport.locked-default-alpha',
  LOCKED_HOVER_FADE: 'viewport.locked-hover-fade',
  LOCKED_HOVER_ALPHA: 'viewport.locked-hover-alpha',
  LOCKED_HOVER_RADIUS: 'viewport.locked-hover-radius'
});

export const LANGUAGE_OPTIONS = [
  { value: AppLanguage.SYSTEM, label: '系統語言' },
  { value: AppLanguage.TRADITIONAL_CHINESE, label: '繁體中文' },
  { value: AppLanguage.SIMPLIFIED_CHINESE, label: '简体中文' },
  { value: AppLanguage.ENGLISH, label: 'English' }
];
const builtinLanguageCount = LANGUAGE_OPTIONS.length;
export const TOOL_TRANSFORM_SPACE = Object.freeze({
  move: ConfigKey.MOVE_SPACE, rotate: ConfigKey.ROTATE_SPACE, pivot: ConfigKey.PIVOT_SPACE
});
const externalLanguages = new Map();
const uiSourceKeys = new Map(Object.entries(UI_MESSAGES).map(([key, message]) => [message.zhHant, key]));
let languagePacksInitialized = false;
let resolvedSystemLanguage;

export function resolveUiLanguage(language = configRegistry.get(ConfigKey.LANGUAGE)) {
  if (language !== AppLanguage.SYSTEM) return language;
  return resolvedSystemLanguage ??= systemUiLanguage();
}

function systemUiLanguage() {
  const desktop = globalThis.window?.cubeBricksDesktop?.systemLanguages;
  const preferred = desktop?.length ? desktop : globalThis.navigator?.languages || [];
  for (const tag of preferred) {
    let locale;
    try { locale = new Intl.Locale(tag); } catch { continue; }
    const pack = [...externalLanguages.keys()].find(code => code.toLowerCase() === locale.baseName.toLowerCase());
    if (pack) return pack;
    if (locale.language === 'zh') return locale.maximize().script === 'Hant'
      ? AppLanguage.TRADITIONAL_CHINESE : AppLanguage.SIMPLIFIED_CHINESE;
    if (locale.language === 'en') return AppLanguage.ENGLISH;
    const basePack = [...externalLanguages.keys()].find(code => code.toLowerCase() === locale.language);
    if (basePack) return basePack;
  }
  return AppLanguage.ENGLISH;
}

export function translateUiKey(key, language = configRegistry.get(ConfigKey.LANGUAGE), values = []) {
  language = resolveUiLanguage(language);
  const message = UI_MESSAGES[key];
  if (!message) return key;
  const external = externalLanguages.get(language);
  const template = external
    ? external.messages[key] ?? message.zhHant
    : language === AppLanguage.ENGLISH ? message.en
      : language === AppLanguage.SIMPLIFIED_CHINESE ? message.zhHans : message.zhHant;
  return String(template).replace(/\{(\d+)\}/g, (match, index) => values[index] ?? match);
}

function compileTranslationPattern(source, translation) {
  if (!/\{\d+\}/.test(source)) return null;
  const captures = [];
  const expression = source.split(/(\{\d+\})/).map(part => {
    const index = part.match(/^\{(\d+)\}$/);
    if (index) {
      captures.push(index[1]);
      return '(.+?)';
    }
    return part.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
  }).join('');
  return { expression: new RegExp(`^${expression}$`), captures, translation, specificity: source.length };
}

function compileRuntimeTemplatePattern(source, translation) {
  if (!source?.includes('${')) return null;
  const parts = source.split(/\$\{[^{}]*\}/);
  if (parts.length < 2) return null;
  const escaped = parts.map(part => part.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&'));
  return { expression: new RegExp(`^${escaped.join('(.*?)')}$`), translation, specificity: parts.join('').length };
}

const storage = typeof window !== 'undefined' ? window.localStorage : null;

export function migrateConfigDefaults(targetStorage) {
  if (!targetStorage) return;
  try {
    const key = 'cubebricks.config';
    const persisted = JSON.parse(targetStorage.getItem(key) || '{}');
    const version = Number(persisted.version || 0);
    if (version >= 3) return;
    const values = persisted.values && typeof persisted.values === 'object' ? persisted.values : {};
    if (version < 2) {
      values[ConfigKey.SHIFT_SNAP_MODE] = 'multiplier';
      values[ConfigKey.CTRL_SNAP_MODE] = 'multiplier';
      values[ConfigKey.SHIFT_CTRL_SNAP_MODE] = 'multiplier';
    }
    // Version 2 shipped 25 as the hover-fade default. Only migrate that exact
    // former default so an explicitly chosen percentage is otherwise retained.
    if (version < 3 && values[ConfigKey.LOCKED_HOVER_ALPHA] === 25) {
      values[ConfigKey.LOCKED_HOVER_ALPHA] = 50;
    }
    targetStorage.setItem(key, JSON.stringify({ ...persisted, version: 3, values }));
  } catch {
    // Invalid persisted data is ignored by the registry and replaced on the
    // next successful settings change.
  }
}

migrateConfigDefaults(storage);

export const configRegistry = new ConfigRegistry({ storage });

configRegistry.register({
  id: ConfigKey.LANGUAGE,
  type: ConfigType.ENUM,
  scope: ConfigScope.APPLICATION,
  defaultValue: AppLanguage.SYSTEM,
  options: LANGUAGE_OPTIONS,
  description: 'CubeBricks user-interface language.'
});

configRegistry.registerMany([
  {
    id: ConfigKey.FONT,
    type: ConfigType.STRING,
    scope: ConfigScope.APPLICATION,
    defaultValue: 'system',
    validate: value => typeof value === 'string' && value.length < 256,
    description: 'Interface font pack.'
  },
  ...Object.values(TOOL_TRANSFORM_SPACE).map(id => ({
    id, type: ConfigType.ENUM, scope: ConfigScope.APPLICATION, defaultValue: 'self',
    options: [{ value: 'global', label: '全局' }, { value: 'parent', label: '父級' }, { value: 'self', label: '自身' }],
    description: 'Coordinate system for this transform tool.'
  })),
  {
    id: ConfigKey.PAINT_SELECTION_SAMPLING, type: ConfigType.ENUM, scope: ConfigScope.APPLICATION, defaultValue: 'nearest',
    options: [{ value: 'nearest', label: '最近鄰' }, { value: 'smooth', label: '平滑' }],
    description: 'Sampling for non-right-angle pixel selection rotations.'
  },
  {
    id: ConfigKey.HISTORY_LIMIT, type: ConfigType.NUMBER, scope: ConfigScope.APPLICATION, defaultValue: 200,
    validate: value => Number.isInteger(value) && value >= 0 && value <= 10000,
    description: 'Default maximum number of persisted undo operations per project.'
  },
  {
    id: ConfigKey.SEPARATE_UV_MODE,
    type: ConfigType.BOOLEAN,
    scope: ConfigScope.APPLICATION,
    defaultValue: false,
    description: 'Separate UV editing from model editing into its own workspace mode.'
  },
  {
    id: ConfigKey.BLOCKBENCH_CONTROLS,
    type: ConfigType.BOOLEAN,
    scope: ConfigScope.APPLICATION,
    defaultValue: false,
    description: 'Use left drag to orbit, right drag to pan, and Shift+left drag to box-select in the modeling viewport.'
  },
  {
    id: ConfigKey.SNAP,
    type: ConfigType.NUMBER,
    scope: ConfigScope.APPLICATION,
    defaultValue: 16,
    validate: value => value > 0,
    description: 'Transform snap subdivisions; the step is 16 divided by this value.'
  },
  {
    id: ConfigKey.ALLOW_NEGATIVE_SIZE,
    type: ConfigType.BOOLEAN,
    scope: ConfigScope.APPLICATION,
    defaultValue: false,
    description: 'Allow cube dimensions to cross zero into negative values.'
  },
  {
    id: ConfigKey.PAINT_EXPLODE_GAP, type: ConfigType.NUMBER, scope: ConfigScope.APPLICATION, defaultValue: 2,
    validate: value => Number.isFinite(value) && value >= 0 && value <= 1000,
    description: 'Minimum world-space clearance between exploded paint groups.'
  },
  {
    id: ConfigKey.PAINT_SCREEN_HEIGHT, type: ConfigType.NUMBER, scope: ConfigScope.APPLICATION, defaultValue: 512,
    validate: value => Number.isInteger(value) && value >= 32 && value <= 4096,
    description: 'Virtual pixel height of the Ctrl screen-space painting plane.'
  },
  {
    id: ConfigKey.SHIFT_SNAP_MODE,
    type: ConfigType.ENUM,
    scope: ConfigScope.APPLICATION,
    defaultValue: 'multiplier',
    options: [{ value: 'value', label: '數值' }, { value: 'multiplier', label: '乘數' }],
    description: 'How Shift modifies snap subdivisions.'
  },
  {
    id: ConfigKey.SHIFT_SNAP_VALUE,
    type: ConfigType.NUMBER,
    scope: ConfigScope.APPLICATION,
    defaultValue: 4,
    validate: value => value > 0,
    description: 'Shift snap value or multiplier.'
  },
  {
    id: ConfigKey.CTRL_SNAP_MODE,
    type: ConfigType.ENUM,
    scope: ConfigScope.APPLICATION,
    defaultValue: 'multiplier',
    options: [{ value: 'value', label: '數值' }, { value: 'multiplier', label: '乘數' }],
    description: 'How Ctrl modifies snap subdivisions.'
  },
  {
    id: ConfigKey.CTRL_SNAP_VALUE,
    type: ConfigType.NUMBER,
    scope: ConfigScope.APPLICATION,
    defaultValue: 8,
    validate: value => value > 0,
    description: 'Ctrl snap value or multiplier.'
  },
  {
    id: ConfigKey.SHIFT_CTRL_SNAP_MODE,
    type: ConfigType.ENUM,
    scope: ConfigScope.APPLICATION,
    defaultValue: 'multiplier',
    options: [{ value: 'value', label: '數值' }, { value: 'multiplier', label: '乘數' }],
    description: 'How Shift+Ctrl modifies snap subdivisions.'
  },
  {
    id: ConfigKey.SHIFT_CTRL_SNAP_VALUE,
    type: ConfigType.NUMBER,
    scope: ConfigScope.APPLICATION,
    defaultValue: 64,
    validate: value => value > 0,
    description: 'Shift+Ctrl snap value or multiplier.'
  },
  {
    id: ConfigKey.ALPHA_LOCK,
    type: ConfigType.BOOLEAN,
    scope: ConfigScope.APPLICATION,
    defaultValue: false,
    description: 'Preserve texture alpha while painting.'
  },
  {
    id: ConfigKey.PROJECTION,
    type: ConfigType.ENUM,
    scope: ConfigScope.APPLICATION,
    defaultValue: 'perspective',
    options: [{ value: 'perspective', label: '透視' }, { value: 'orthographic', label: '正交' }],
    description: 'Viewport camera projection.'
  },
  {
    id: ConfigKey.PREVIEW_SHADE,
    type: ConfigType.BOOLEAN,
    scope: ConfigScope.APPLICATION,
    defaultValue: true,
    description: 'Enable face shading in the viewport when the element also allows shading.'
  },
  {
    id: ConfigKey.SHOW_PLAYER_REFERENCE,
    type: ConfigType.BOOLEAN,
    scope: ConfigScope.APPLICATION,
    defaultValue: false,
    description: 'Show the non-editable player scale reference in the viewport.'
  },
  {
    id: ConfigKey.PLAYER_REFERENCE_TEXTURE,
    type: ConfigType.OBJECT,
    scope: ConfigScope.APPLICATION,
    defaultValue: { name: '內置玩家紋理', source: '' },
    validate: value => typeof value.name === 'string' && typeof value.source === 'string',
    description: 'Custom skin used by the non-editable player reference.'
  },
  {
    id: ConfigKey.SHOW_GEOMETRY_ONLY,
    type: ConfigType.BOOLEAN,
    scope: ConfigScope.APPLICATION,
    defaultValue: false,
    description: 'Hide helper objects such as locators without changing their individual visibility.'
  },
  {
    id: ConfigKey.MODIFIER_RESULT_GHOST,
    type: ConfigType.BOOLEAN,
    scope: ConfigScope.APPLICATION,
    defaultValue: false,
    description: 'Display generated modifier results at 75% opacity and disable their selection.'
  },
  {
    id: ConfigKey.SHOW_GRID,
    type: ConfigType.BOOLEAN,
    scope: ConfigScope.APPLICATION,
    defaultValue: true,
    description: 'Show the viewport floor grid.'
  },
  {
    id: ConfigKey.BACKGROUND_MODE, type: ConfigType.ENUM, scope: ConfigScope.APPLICATION, defaultValue: 'grid',
    options: [{ value: 'black', label: '純黑' }, { value: 'current', label: '目前背景' }, { value: 'grid', label: '棋盤格' }],
    description: 'Viewport background fill; independent of the floor reference grid.'
  },
  {
    id: ConfigKey.SHOW_WIREFRAME,
    type: ConfigType.BOOLEAN,
    scope: ConfigScope.APPLICATION,
    defaultValue: false,
    description: 'Show model wireframe bounds.'
  },
  {
    id: ConfigKey.CUBE_BIRTH_MS,
    type: ConfigType.NUMBER,
    scope: ConfigScope.APPLICATION,
    defaultValue: 60,
    validate: value => value >= 0 && value <= 500,
    description: 'Cube appearance animation in milliseconds; zero disables it.'
  },
  {
    id: ConfigKey.CUBE_DEATH_MS,
    type: ConfigType.NUMBER,
    scope: ConfigScope.APPLICATION,
    defaultValue: 60,
    validate: value => value >= 0 && value <= 500,
    description: 'Cube disappearance animation in milliseconds; zero disables it.'
  },
  {
    id: ConfigKey.LOCKED_DEFAULT_ALPHA,
    type: ConfigType.NUMBER,
    scope: ConfigScope.APPLICATION,
    defaultValue: 100,
    validate: value => value >= 0 && value <= 100,
    description: 'Opacity percentage used for locked viewport objects.'
  },
  {
    id: ConfigKey.LOCKED_HOVER_FADE,
    type: ConfigType.BOOLEAN,
    scope: ConfigScope.APPLICATION,
    defaultValue: true,
    description: 'Fade a locked object while the pointer is over it.'
  },
  {
    id: ConfigKey.LOCKED_HOVER_ALPHA,
    type: ConfigType.NUMBER,
    scope: ConfigScope.APPLICATION,
    defaultValue: 50,
    validate: value => value >= 0 && value <= 100,
    description: 'Opacity percentage at the center of the pointer fade region.'
  },
  {
    id: ConfigKey.LOCKED_HOVER_RADIUS,
    type: ConfigType.NUMBER,
    scope: ConfigScope.APPLICATION,
    defaultValue: 120,
    validate: value => value >= 8 && value <= 2048,
    description: 'Screen-space radius in pixels for the locked-object pointer fade region.'
  }
]);

export function getLanguageLabel(language = configRegistry.get(ConfigKey.LANGUAGE)) {
  return LANGUAGE_OPTIONS.find(option => option.value === language)?.label || language;
}

export function replaceLanguagePacks(packs) {
  const current = configRegistry.get(ConfigKey.LANGUAGE);
  applyLanguage(AppLanguage.TRADITIONAL_CHINESE);
  externalLanguages.clear();
  LANGUAGE_OPTIONS.splice(builtinLanguageCount);
  for (const pack of packs) {
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/i.test(pack.code) || LANGUAGE_OPTIONS.some(option => option.value === pack.code)) continue;
    const messages = Object.fromEntries(Object.entries(pack.translations).map(([source, translated]) =>
      [uiSourceKeys.get(source) || source, translated]));
    externalLanguages.set(pack.code, {
      messages,
      patterns: [
        ...Object.entries(pack.translations).map(([source, translated]) =>
          compileTranslationPattern(source, translated)).filter(Boolean),
        ...Object.entries(messages).map(([key, translated]) =>
          compileRuntimeTemplatePattern(UI_MESSAGES[key]?.zhHant, translated)).filter(Boolean)
      ].sort((a, b) => b.specificity - a.specificity)
    });
    LANGUAGE_OPTIONS.push({ value: pack.code, label: pack.label });
  }
  resolvedSystemLanguage = undefined;
  configRegistry.setEnumOptions(ConfigKey.LANGUAGE, LANGUAGE_OPTIONS);
  const saved = !languagePacksInitialized ? configRegistry.persistedValues[ConfigKey.LANGUAGE] : null;
  const selected = !languagePacksInitialized && LANGUAGE_OPTIONS.some(option => option.value === saved)
    ? saved : current;
  languagePacksInitialized = true;
  if (LANGUAGE_OPTIONS.some(option => option.value === selected) && configRegistry.get(ConfigKey.LANGUAGE) !== selected) {
    configRegistry.set(ConfigKey.LANGUAGE, selected, { source: 'language-pack' });
  }
  const select = typeof document === 'undefined' ? null : document.querySelector('#languageSelect');
  if (select) {
    select.replaceChildren(...LANGUAGE_OPTIONS.map(option => new Option(option.label, option.value)));
    select.value = configRegistry.get(ConfigKey.LANGUAGE);
  }
  applyLanguage(configRegistry.get(ConfigKey.LANGUAGE));
}

export function translateUiText(source, language = configRegistry.get(ConfigKey.LANGUAGE)) {
  language = resolveUiLanguage(language);
  const text = String(source ?? '');
  // Existing DOM labels are still authored in Traditional Chinese. Resolve
  // them to the stable ID first; new code and language packs use that ID.
  const key = UI_MESSAGES[text] ? text : uiSourceKeys.get(text);
  if (key) return translateUiKey(key, language);
  if (externalLanguages.has(language)) {
    const { messages, patterns } = externalLanguages.get(language);
    if (Object.hasOwn(messages, text)) return messages[text];
    for (const pattern of patterns) {
      const match = text.match(pattern.expression);
      if (!match) continue;
      const replacements = new Map((pattern.captures || match.slice(1).map((_, index) => String(index)))
        .map((index, position) => [index, match[position + 1]]));
      return pattern.translation.replace(/\{(\d+)\}/g, (_, index) => replacements.get(index) ?? '');
    }
    return text;
  }
  if (language === AppLanguage.TRADITIONAL_CHINESE) return text;
  if (language === AppLanguage.SIMPLIFIED_CHINESE) return toSimplified(text);
  if (language !== AppLanguage.ENGLISH) return text;
  return translateEnglishUiText(text, language, translateUiText);
}

let activeLanguage = AppLanguage.TRADITIONAL_CHINESE;
let languageObserver = null;
const textSources = new WeakMap();
const attributeSources = new WeakMap();
const TRANSLATED_ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'data-tooltip'];

function translateTextNode(node) {
  if (node.parentElement?.closest('[translate="no"]')) return;
  const current = node.nodeValue || '';
  const trimmed = current.trim();
  if (!trimmed) return;
  const previous = textSources.get(node);
  const source = previous && (previous.translated === trimmed
    || LANGUAGE_OPTIONS.some(option => translateUiText(previous.source, option.value) === trimmed))
    ? previous.source : trimmed;
  const translated = translateUiText(source, activeLanguage);
  textSources.set(node, { source, translated });
  const next = current.replace(trimmed, translated);
  if (next !== current) node.nodeValue = next;
}

function translateElementAttributes(element) {
  if (!TRANSLATED_ATTRIBUTES.some(attribute => element.hasAttribute(attribute))) return;
  let sources = attributeSources.get(element);
  if (!sources) {
    sources = {};
    attributeSources.set(element, sources);
  }
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    if (!element.hasAttribute(attribute)) continue;
    const current = element.getAttribute(attribute);
    const previous = sources[attribute];
    const source = previous && (previous.translated === current
      || LANGUAGE_OPTIONS.some(option => translateUiText(previous.source, option.value) === current))
      ? previous.source : current;
    const translated = translateUiText(source, activeLanguage);
    sources[attribute] = { source, translated };
    if (translated !== current) element.setAttribute(attribute, translated);
  }
}

function translateSubtree(root) {
  if (!root) return;
  if (root.nodeType === 3) {
    translateTextNode(root);
    return;
  }
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  if (root.nodeType === 1 && root.namespaceURI === 'http://www.w3.org/2000/svg'
    && root.closest('#transformGizmo,#mirrorGuideOverlay,#locatorOverlay')) {
    // The viewport recreates visual SVG paths as the camera moves. Most of
    // those nodes contain no language content; avoid walking each path in JS.
    translateElementAttributes(root);
    for (const element of root.querySelectorAll('text,tspan,title,[title],[aria-label],[data-tooltip]')) {
      translateElementAttributes(element);
      if (element.localName === 'text' || element.localName === 'tspan' || element.localName === 'title')
        for (const child of element.childNodes) if (child.nodeType === 3) translateTextNode(child);
    }
    return;
  }
  if (root.nodeType === 1) translateElementAttributes(root);
  const walker = document.createTreeWalker(root, 5);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) translateTextNode(node);
    else translateElementAttributes(node);
  }
}

export function applyLanguage(language = configRegistry.get(ConfigKey.LANGUAGE)) {
  if (typeof document === 'undefined') return;
  activeLanguage = resolveUiLanguage(language);
  void globalThis.window?.cubeBricksDesktop?.setUiLanguage?.(activeLanguage).catch(() => {});
  document.documentElement.lang = activeLanguage;
  document.documentElement.dir = 'ltr';
  translateSubtree(document);
  if (!languageObserver && typeof MutationObserver !== 'undefined') {
    languageObserver = new MutationObserver(mutations => {
      const start = performanceMonitor.enabled ? performance.now() : 0;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateTextNode(mutation.target);
        else if (mutation.type === 'attributes') translateElementAttributes(mutation.target);
        else mutation.addedNodes.forEach(translateSubtree);
      }
      if (performanceMonitor.enabled)
        performanceMonitor.record('ui.translationObserver', performance.now() - start);
    });
    languageObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATED_ATTRIBUTES
    });
  }
}
