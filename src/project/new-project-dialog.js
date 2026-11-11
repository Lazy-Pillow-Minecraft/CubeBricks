import { ModelFormatId } from '../common/config/model-formats.js';
import { bindDialogDrag } from '../utils/dom/dialog-drag.js';
import { availableUvModes, JAVA_BLOCK_VERSIONS, newProjectDefaults,
  prepareNewProjectData } from './new-project-options.js';

export function createNewProjectDialog({ $, language, createProject, toast }) {
  const dialog = $('#newModelProjectDialog');
  const form = $('#newModelProjectForm');
  let format = null;
  let uvMode = 'box';
  let javaVersion = JAVA_BLOCK_VERSIONS[0].value;

  function picker(button, menu, options, value, onChange) {
    button.textContent = options.find(option => option.value === value)?.label || '';
    menu.replaceChildren(...options.map(option => {
      const item = document.createElement('button');
      item.type = 'button';
      item.role = 'option';
      item.dataset.value = option.value;
      item.textContent = option.label;
      item.setAttribute('aria-selected', String(option.value === value));
      item.addEventListener('click', () => {
        onChange(option.value);
        button.textContent = option.label;
        menu.querySelectorAll('[role="option"]').forEach(entry =>
          entry.setAttribute('aria-selected', String(entry.dataset.value === option.value)));
        closeMenus();
        button.focus();
      });
      return item;
    }));
  }

  function closeMenus() {
    for (const id of ['newModelJavaVersion', 'newModelUv']) {
      $(`#${id}Menu`).hidden = true;
      $(`#${id}Button`).setAttribute('aria-expanded', 'false');
    }
  }

  for (const id of ['newModelJavaVersion', 'newModelUv']) {
    const button = $(`#${id}Button`), menu = $(`#${id}Menu`);
    button.addEventListener('click', () => {
      const show = menu.hidden;
      closeMenus();
      menu.hidden = !show;
      button.setAttribute('aria-expanded', String(show));
    });
  }

  dialog.addEventListener('pointerdown', event => {
    if (!event.target.closest('.project-info-version-picker')) closeMenus();
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', closeMenus);
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenus(); });
  dialog.querySelectorAll('[data-action="cancelNewModelProject"]').forEach(button =>
    button.addEventListener('click', () => dialog.close()));
  bindDialogDrag(dialog, dialog.querySelector('.dialog-heading'));

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!format) return;
    try {
      const data = prepareNewProjectData(format, language(), {
        name: $('#newModelProjectName').value,
        textureWidth: $('#newModelTextureWidth').value,
        textureHeight: $('#newModelTextureHeight').value,
        snap: $('#newModelSnap').value,
        historyLimit: $('#newModelHistoryLimit').value,
        description: $('#newModelDescription').value,
        uvMode, javaBlockVersion: javaVersion
      });
      createProject(format, data);
      dialog.close();
    } catch (error) { toast(error.message); }
  });

  function open(nextFormat) {
    format = nextFormat;
    const defaults = newProjectDefaults(format, language());
    uvMode = defaults.uvMode;
    javaVersion = defaults.javaBlockVersion;
    $('#newModelProjectTitle').textContent = format.name;
    $('#newModelProjectDescription').textContent = format.description || '';
    $('#newModelProjectName').value = defaults.name;
    $('#newModelTextureWidth').value = defaults.textureWidth;
    $('#newModelTextureHeight').value = defaults.textureHeight;
    $('#newModelSnap').value = defaults.snap;
    $('#newModelHistoryLimit').value = defaults.historyLimit ?? '';
    $('#newModelDescription').value = defaults.description || '';
    const javaBlock = format.id === ModelFormatId.JAVA_BLOCK_ITEM;
    $('#newModelJavaVersionRow').hidden = !javaBlock;
    if (javaBlock) picker($('#newModelJavaVersionButton'), $('#newModelJavaVersionMenu'),
      JAVA_BLOCK_VERSIONS, javaVersion, value => { javaVersion = value; });
    const modes = availableUvModes(format);
    $('#newModelUvFixedRow').hidden = modes.length !== 1;
    $('#newModelUvPickerRow').hidden = modes.length === 1;
    if (modes.length === 1) $('#newModelUvFixedRow').querySelector('output').textContent = modes[0].label;
    else picker($('#newModelUvButton'), $('#newModelUvMenu'), modes, uvMode,
      value => { uvMode = value; });
    closeMenus();
    for (const property of ['left', 'top', 'position', 'margin']) dialog.style.removeProperty(property);
    dialog.showModal();
    requestAnimationFrame(() => $('#newModelProjectName').focus());
  }

  return { open };
}
