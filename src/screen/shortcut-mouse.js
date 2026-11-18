import { shortcutEventKey } from './shortcuts.js';

// Side buttons share keyboard dispatch and recording, without reaching viewport
// drag handlers or triggering the browser's Back / Forward navigation.
export function bindShortcutMouseButtons(press, release) {
  for (const type of ['pointerdown', 'pointerup']) {
    window.addEventListener(type, event => {
      if (shortcutEventKey(event)) event.stopImmediatePropagation();
    }, { capture: true });
  }
  window.addEventListener('mousedown', event => {
    if (!shortcutEventKey(event)) return;
    // The settings recorder owns side buttons while its input has focus.
    if (document.activeElement?.closest?.('[data-shortcut-input]')) return;
    press(event);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
  window.addEventListener('mouseup', event => {
    if (!shortcutEventKey(event)) return;
    release(event);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
  window.addEventListener('auxclick', event => {
    if (shortcutEventKey(event)) event.preventDefault();
  }, { capture: true });
}
