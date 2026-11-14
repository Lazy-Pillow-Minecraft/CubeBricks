import { ConfigKey, configRegistry } from '../common/config/app-config.js';

export const SHORTCUT_GROUPS = [
  ['通用', [
    ['undo', '撤銷', 'Ctrl + Z'], ['redo', '重做', 'Ctrl + Shift + Z'],
    ['save', '保存項目', 'Ctrl + S'], ['export', '導出項目', 'Ctrl + Shift + S'],
    ['copy', '複製', 'Ctrl + C'], ['cut', '剪切', 'Ctrl + X'],
    ['paste', '貼上', 'Ctrl + V'], ['duplicate', '原地複製', 'Ctrl + D'],
    ['delete', '刪除', 'Delete'], ['selectAll', '全選', 'Ctrl + A'],
    ['dismiss', '關閉臨時操作', 'Escape'], ['performance', '性能記錄', 'Ctrl + Shift + F12']
  ]],
  ['視圖與建立', [
    ['focus', '聚焦選中', 'R'], ['focusReset', '回到預設視圖', 'Shift + R'],
    ['zoomReset', '重置視圖縮放', 'F'], ['previousTool', '上一個工具', 'ArrowLeft'],
    ['nextTool', '下一個工具', 'ArrowRight'], ['addCube', '新建 Cube', 'C'],
    ['addShape', '新建 Shape', 'S'], ['temporaryEyedropper', '暫時取色／選頂點', 'Alt']
  ]],
  ['建模工具', [
    ['toolMove', '移動', '1'], ['toolResize', '縮放', '2'],
    ['toolRotate', '旋轉', '3'], ['toolPivot', '樞軸', '4'],
    ['toolVertexSnap', '頂點捕捉', '5'], ['toolKnife', '刀具', '6'],
    ['toolFaceSelect', '面選擇', '7']
  ]],
  ['繪畫工具', [
    ['paintBrush', '畫筆', 'B'], ['paintLine', '直線', 'L'],
    ['paintRectangle', '矩形', 'M'], ['paintEllipse', '橢圓', 'O'],
    ['paintFill', '油漆桶', 'G'], ['paintGradient', '漸變', 'J'],
    ['paintEyedropper', '取色器', 'I']
  ]]
];

const defaults = Object.fromEntries(SHORTCUT_GROUPS.flatMap(([, entries]) => entries.map(([id, , keys]) => [id, keys])));
export const DEFAULT_SHORTCUTS = Object.freeze(defaults);
let currentShortcuts = configRegistry.get(ConfigKey.SHORTCUTS);
let matchCache = new WeakMap();
configRegistry.subscribe(ConfigKey.SHORTCUTS, change => { currentShortcuts = change.value; matchCache = new WeakMap(); });
const MODIFIERS = new Set(['Ctrl', 'Shift', 'Alt', 'Meta']);
const history = [];
const pressedKeys = new Set();

export function normalizeShortcutKey(key) {
  const names = { Control: 'Ctrl', Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Meta', Esc: 'Escape', ' ': 'Space' };
  return names[key] || (key.length === 1 ? key.toUpperCase() : key);
}

export function shortcutFor(id) {
  return currentShortcuts[id] || defaults[id] || '';
}

export function setShortcut(id, value) {
  if (!(id in defaults)) return;
  configRegistry.set(ConfigKey.SHORTCUTS, { ...configRegistry.get(ConfigKey.SHORTCUTS), [id]: value }, { source: 'shortcut-editor' });
}

export function resetShortcut(id) { setShortcut(id, defaults[id]); }
export function resetAllShortcuts() { configRegistry.reset(ConfigKey.SHORTCUTS, { source: 'shortcut-editor' }); }

// A binding is a list of keys separated by " + ". Modifiers can be held;
// additional ordinary keys are matched in their entered order within one second.
function matchesBinding(event, binding) {
  if (!binding || event.isComposing) return false;
  const parts = binding.split(' + ').filter(Boolean);
  const modifiers = new Set(parts.filter(part => MODIFIERS.has(part)));
  if (Boolean(event.ctrlKey) !== modifiers.has('Ctrl') || Boolean(event.shiftKey) !== modifiers.has('Shift')
    || Boolean(event.altKey) !== modifiers.has('Alt') || Boolean(event.metaKey) !== modifiers.has('Meta')) return false;
  const ordinary = parts.filter(part => !MODIFIERS.has(part));
  const trigger = normalizeShortcutKey(event.key);
  if (!ordinary.length) return parts.at(-1) === trigger;
  if (ordinary.at(-1) !== trigger) return false;
  if (ordinary.length === 1) return true;
  const recent = history.slice(-ordinary.length);
  return recent.length === ordinary.length && recent.every((entry, index) => entry.key === ordinary[index]);
}

export function shortcutMatches(event, id) {
  if (!matchesBinding(event, shortcutFor(id))) return false;
  let matches = matchCache.get(event);
  if (!matches) {
    matches = SHORTCUT_GROUPS.flatMap(([, entries]) => entries)
      .filter(([candidate]) => matchesBinding(event, shortcutFor(candidate)))
      .map(([candidate]) => [candidate, shortcutFor(candidate).split(' + ').filter(key => !MODIFIERS.has(key)).length]);
    const longest = Math.max(...matches.map(([, length]) => length));
    matches = new Set(matches.filter(([, length]) => length === longest).map(([candidate]) => candidate));
    matchCache.set(event, matches);
  }
  return matches.has(id);
}

export function shortcutTriggerReleased(event, id) {
  return shortcutFor(id).split(' + ').at(-1) === normalizeShortcutKey(event.key);
}

export function shortcutHeld(id) {
  const keys = shortcutFor(id).split(' + ').filter(Boolean);
  return keys.length > 0 && keys.every(key => pressedKeys.has(key));
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', event => {
    if (event.repeat || event.isComposing || event.target?.closest?.('[data-shortcut-input]')) return;
    const key = normalizeShortcutKey(event.key);
    pressedKeys.add(key);
    if (MODIFIERS.has(key)) return;
    const now = performance.now();
    while (history.length && now - history[0].at > 1000) history.shift();
    history.push({ key, at: now });
    if (history.length > 8) history.shift();
  }, { capture: true });
  window.addEventListener('keyup', event => pressedKeys.delete(normalizeShortcutKey(event.key)), { capture: true });
  window.addEventListener('blur', () => { history.length = 0; pressedKeys.clear(); });
}
