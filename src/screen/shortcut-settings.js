import { ConfigKey, configRegistry } from '../common/config/app-config.js';
import { SHORTCUT_GROUPS, normalizeShortcutKey, resetAllShortcuts, resetShortcut, setShortcut, shortcutFor } from './shortcuts.js';

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
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Enter') { input.blur(); return; }
    if (event.repeat) return;
    if (input.dataset.capturing === 'ready') {
      input.value = '';
      input.dataset.capturing = 'active';
    }
    const key = normalizeShortcutKey(event.key);
    const parts = input.value ? input.value.split(' + ') : [];
    if (!['Ctrl', 'Shift', 'Alt', 'Meta'].includes(key) || !parts.includes(key)) parts.push(key);
    input.value = parts.join(' + ');
  });
  root.addEventListener('focusout', event => {
    const input = event.target.closest?.('[data-shortcut-input]');
    if (!input) return;
    if (input.dataset.capturing === 'active' && input.value) setShortcut(input.dataset.shortcutInput, input.value);
    input.dataset.capturing = '';
    input.value = shortcutFor(input.dataset.shortcutInput);
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
