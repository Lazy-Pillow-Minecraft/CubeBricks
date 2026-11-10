import { bindDialogDrag } from '../utils/dom/dialog-drag.js';
import { HISTORY_MARK_SHAPES, historyMarkPath } from './history-mark-shapes.js';

export function editHistoryNodeMark({ mark, defaultColor, openColorPickerPopup }) {
  return new Promise(resolve => {
    let shape = mark?.shape || 'diamond', color = mark?.color || defaultColor, result;
    const copy = {
      title: '標記節點',
      name: '名稱',
      shapes: '標記形狀',
      color: '顏色',
      chooseColor: '選擇顏色',
      close: '關閉',
      remove: '移除標記',
      cancel: '取消',
      apply: '套用'
    };
    const dialog = document.createElement('dialog');
    dialog.className = 'theme-dialog history-mark-dialog';
    dialog.innerHTML = '<form><div class="dialog-heading"><h2></h2><button type="button" class="close-button" data-mark-cancel>×</button></div><label><span data-mark-label="name"></span><input data-mark-name type="text" maxlength="120" autocomplete="off" /></label><div class="history-mark-shapes" role="group"></div><label><span data-mark-label="color"></span><span class="history-mark-color"><button type="button" data-mark-color></button><input data-mark-hex type="text" pattern="#[a-fA-F0-9]{6}" maxlength="7" required /></span></label><div class="dialog-actions"><button type="button" class="danger" data-mark-remove></button><button type="button" data-mark-cancel></button><button type="submit" class="primary-button"></button></div></form>';
    const $ = selector => dialog.querySelector(selector), name = $('[data-mark-name]'), hex = $('[data-mark-hex]'), swatch = $('[data-mark-color]');
    $('h2').textContent = copy.title;
    $('.close-button').setAttribute('aria-label', copy.close);
    for (const label of dialog.querySelectorAll('[data-mark-label]')) label.textContent = copy[label.dataset.markLabel];
    $('.history-mark-shapes').setAttribute('aria-label', copy.shapes);
    hex.setAttribute('aria-label', copy.color);
    swatch.title = copy.chooseColor;
    $('[data-mark-remove]').textContent = copy.remove;
    $('.dialog-actions [data-mark-cancel]').textContent = copy.cancel;
    $('[type="submit"]').textContent = copy.apply;
    name.value = mark?.name || '';
    const updateColor = value => {
      color = value;
      hex.value = value;
      swatch.style.background = value;
      dialog.style.setProperty('--history-mark-color', value);
    };
    updateColor(color);
    const choices = [];
    for (const definition of HISTORY_MARK_SHAPES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.markShape = definition.id;
      button.title = definition.label;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '-10 -10 20 20');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', historyMarkPath(definition.id, 8));
      svg.append(path);
      button.append(svg);
      button.addEventListener('click', () => {
        shape = definition.id;
        updateShape();
      });
      choices.push(button);
      $('.history-mark-shapes').append(button);
    }
    const updateShape = () => {
      for (const button of choices) button.setAttribute('aria-pressed', String(button.dataset.markShape === shape));
    };
    updateShape();
    swatch.addEventListener('click', () => openColorPickerPopup(color, updateColor));
    hex.addEventListener('input', () => { if (hex.checkValidity()) updateColor(hex.value.toLowerCase()); });
    $('[data-mark-remove]').hidden = !mark;
    $('[data-mark-remove]').addEventListener('click', () => {
      result = null;
      dialog.close();
    });
    for (const button of dialog.querySelectorAll('[data-mark-cancel]')) button.addEventListener('click', () => dialog.close());
    $('form').addEventListener('submit', event => {
      event.preventDefault();
      if (!hex.reportValidity()) return;
      result = { shape, color: hex.value.toLowerCase(), name: name.value.trim() };
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    }, { once: true });
    document.body.append(dialog);
    bindDialogDrag(dialog, $('.dialog-heading'));
    dialog.showModal();
    name.focus();
  });
}
