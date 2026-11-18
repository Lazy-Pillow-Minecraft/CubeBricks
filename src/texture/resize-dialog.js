import { bindDialogDrag } from '../utils/dom/dialog-drag.js';

export function createTextureResizeDialog({ $, prepare, resize }) {
  const dialog = $('#textureResizeDialog');
  const form = $('#textureResizeForm');
  const width = $('#textureResizeWidth'), height = $('#textureResizeHeight');
  const status = $('#textureResizeStatus'), submit = $('#textureResizeApply');
  let target = null, busy = false, revision = 0;
  bindDialogDrag(dialog, dialog.querySelector('.dialog-heading'));

  async function open(asset) {
    if (busy || !asset) return;
    const request = ++revision;
    const prepared = await prepare(asset);
    if (!prepared || request !== revision) return;
    target = prepared;
    width.value = String(prepared.width);
    height.value = String(prepared.height);
    $('#textureResizeName').textContent = asset.name;
    status.textContent = '';
    form.elements.resizeMode.value = 'crop';
    if (!dialog.open) dialog.showModal();
    width.focus();
    width.select();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !target || !form.reportValidity()) return;
    busy = true;
    submit.disabled = true;
    try {
      await resize(target, Number(width.value), Number(height.value), form.elements.resizeMode.value);
      dialog.close();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
  $('#textureResizeCancel').addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog || busy) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => { target = null; revision++; });
  return { open };
}
