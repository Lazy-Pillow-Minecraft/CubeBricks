import { ConfigKey, configRegistry } from '../common/config/app-config.js';
import { SHORTCUT_GROUPS, shortcutEventKey, resetAllShortcuts, resetShortcut, setShortcut, shortcutFor } from './shortcuts.js';

export function captureShortcutInput(input, event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.key === 'Enter') { input.blur(); return; }
  if (event.key === 'Escape') {
    input.value = '';
    input.dataset.capturing = 'active';
    setShortcut(input.dataset.shortcutInput, '');
    input.blur();
    return;
  }
  if (event.repeat) return;
  const key = shortcutEventKey(event);
  if (!key) return;
  if (input.dataset.capturing === 'ready') {
    input.value = '';
    input.dataset.capturing = 'active';
  }
  const parts = input.value ? input.value.split(' + ') : [];
  // Include modifiers already held before this field gained focus, including
  // Ctrl / Shift + a side button. Ordinary keys remain an ordered sequence.
  for (const [name, held] of [['Ctrl', event.ctrlKey], ['Shift', event.shiftKey], ['Alt', event.altKey], ['Meta', event.metaKey]]) {
    if (held && !parts.includes(name)) parts.push(name);
  }
  if (!['Ctrl', 'Shift', 'Alt', 'Meta'].includes(key) || !parts.includes(key)) parts.push(key);
  input.value = parts.join(' + ');
}

export function commitShortcutInput(input) {
  if (input.dataset.capturing === 'active') setShortcut(input.dataset.shortcutInput, input.value);
  input.dataset.capturing = '';
  input.value = shortcutFor(input.dataset.shortcutInput);
}

export function bindShortcutSettings() {
  const root = document.getElementById('shortcutSettingsList');
  if (!root) return;
  root.replaceChildren();
  for (const [group, actions] of SHORTCUT_GROUPS) {
    const section = document.createElement('section');
    section.className = 'shortcut-group';
    const heading = document.createElement('h3');
    heading.textContent = group;
    section.append(heading);
    for (const [id, label] of actions) {
      const row = document.createElement('div');
      row.className = 'shortcut-row';
      const name = document.createElement('label');
      name.textContent = label;
      name.htmlFor = `shortcut-${id}`;
      const input = document.createElement('input');
      input.id = `shortcut-${id}`;
      input.type = 'text';
      input.readOnly = true;
      input.dataset.shortcutInput = id;
      input.value = shortcutFor(id);
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = '重置';
      reset.title = '重置快捷鍵';
      reset.dataset.resetShortcut = id;
      row.append(name, input, reset);
      section.append(row);
    }
    root.append(section);
  }

  root.addEventListener('focusin', event => {
    const input = event.target.closest?.('[data-shortcut-input]');
    if (input) input.dataset.capturing = 'ready';
  });
  root.addEventListener('keydown', event => {
    const input = event.target.closest?.('[data-shortcut-input]');
    if (!input) return;
    captureShortcutInput(input, event);
  });
  window.addEventListener('mousedown', event => {
    if (!shortcutEventKey(event)) return;
    const input = document.activeElement?.closest?.('[data-shortcut-input]');
    if (input && root.contains(input)) captureShortcutInput(input, event);
  }, { capture: true });
  root.addEventListener('focusout', event => {
    const input = event.target.closest?.('[data-shortcut-input]');
    if (!input) return;
    commitShortcutInput(input);
  });
  root.addEventListener('click', event => {
    const button = event.target.closest?.('[data-reset-shortcut]');
    if (!button) return;
    resetShortcut(button.dataset.resetShortcut);
  });
  document.getElementById('resetAllShortcuts').addEventListener('click', resetAllShortcuts);
  configRegistry.subscribe(ConfigKey.SHORTCUTS, () => {
    for (const input of root.querySelectorAll('[data-shortcut-input]')) {
      if (input === document.activeElement && input.dataset.capturing === 'active') continue;
      input.value = shortcutFor(input.dataset.shortcutInput);
    }
  });
}
