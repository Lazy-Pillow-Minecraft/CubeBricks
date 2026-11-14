import { ConfigKey, resolveUiLanguage } from '../common/config/app-config.js';
import { createSkinProject } from './skin-project.js';
import { projectSizeBounds } from '../common/core/format-constraints.js';
import { bindDialogDrag } from '../utils/dom/dialog-drag.js';
import { isSharedHumanoidArmor } from './skin-catalog.js';
import { modelFormatRegistry, ModelFormatId } from '../common/config/model-formats.js';
import { createSkinLivePreview } from './skin-live-preview.js';

const libraryBase = 'assets/skin-library/';

async function readLibraryAsset(relativePath) {
  if (window.cubeBricksDesktop?.readSkinLibraryAsset)
    return window.cubeBricksDesktop.readSkinLibraryAsset(relativePath);
  const response = await fetch(new URL(`${libraryBase}${relativePath}`, document.baseURI));
  if (!response.ok) throw new Error(`無法讀取皮膚模型：${relativePath}`);
  if (relativePath.endsWith('.png')) {
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  return response.text();
}

export function createSkinPicker({ $, escapeHtml, escapeAttribute, configRegistry,
  addProjectTab, markDirty, setMode, toast, state, renderScene, createPreviewRenderer }) {
  const dialog = $('#skinPickerDialog');
  const list = $('#skinPickerList');
  const search = $('#skinPickerSearch');
  const textureSelect = $('#skinPickerTexture');
  const createButton = $('#skinPickerCreate');
  const preview = $('#skinPickerSelectedPreview');
  const fields = $('#skinPickerFields');
  const livePreview = createSkinLivePreview({ canvas: preview, list,
    readAsset: readLibraryAsset, createRenderer: createPreviewRenderer,
    onError: error => console.warn('皮膚預覽渲染失敗', error),
    onStatus: status => {
      const node = $('#skinPickerPreviewStatus');
      node.hidden = status === 'ready' || status === 'empty';
      node.textContent = status === 'loading' ? '正在渲染模型…' : '預覽無法顯示';
    } });
  let catalogPromise = null;
  let edition = 'java';
  let selected = null;
  let busy = false;

  const languageKey = () => ({ 'zh-Hans': 'zhHans', 'zh-Hant': 'zhHant' })[
    resolveUiLanguage(configRegistry.get(ConfigKey.LANGUAGE))] || 'en';
  const label = record => record.names?.[languageKey()] || record.names?.en || record.variant;
  const catalog = () => catalogPromise ||= readLibraryAsset('catalog.json').then(JSON.parse)
    .catch(error => { catalogPromise = null; throw error; });

  function renderPreview() {
    const template = $('#skinPickerTemplateTexture').checked;
    const texture = selected?.textures.find(item => item.id === textureSelect.value);
    void livePreview.select(selected, texture?.id || selected?.defaultTextureId, template);
  }

  function renderDetail() {
    fields.hidden = !selected;
    createButton.disabled = !selected || busy;
    if (!selected) { renderPreview(); return; }
    $('#skinPickerSelectedName').textContent = label(selected);
    $('#skinPickerSelectedVariant').textContent = `${selected.variant} · ${selected.version}`;
    textureSelect.innerHTML = selected.textures.map(texture => `<option value="${escapeAttribute(texture.id)}">${escapeHtml(texture.name)}${texture.size ? ` · ${texture.size.join(' × ')}` : ''}</option>`).join('');
    textureSelect.value = selected.textures.some(texture => texture.id === selected.defaultTextureId)
      ? selected.defaultTextureId : selected.textures[0]?.id || '';
    $('#skinPickerGameTexture').disabled = !selected.textures.length;
    if (!selected.textures.length) $('#skinPickerTemplateTexture').checked = true;
    textureSelect.disabled = $('#skinPickerTemplateTexture').checked;
    renderPreview();
  }

  async function renderList() {
    const { entries } = await catalog();
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = entries.filter(record => record.edition === edition && !isSharedHumanoidArmor(record) && (!query ||
      `${label(record)} ${record.names?.en || ''} ${record.variant} ${record.entityIds.join(' ')}`.toLocaleLowerCase().includes(query)))
      .sort((a, b) => label(a).localeCompare(label(b)) || a.variant.localeCompare(b.variant));
    $('#skinPickerCount').textContent = `${filtered.length} 個模型`;
    list.innerHTML = filtered.map(record => `<button type="button" class="skin-picker-card ${selected?.id === record.id ? 'active' : ''}"
      data-skin-id="${escapeAttribute(record.id)}" title="${escapeAttribute(record.entityIds.join('、') || record.variant)}">
      <canvas aria-hidden="true"></canvas>
      <strong>${escapeHtml(label(record))}</strong><small>${escapeHtml(record.variant)}</small></button>`).join('');
    livePreview.observeCards(filtered);
  }

  async function open() {
    selected = null;
    search.value = '';
    edition = 'java';
    $('#skinPickerGameTexture').checked = true;
    $('#skinPickerTemplateTexture').checked = false;
    livePreview.reset();
    $('#skinPickerSnap').value = modelFormatRegistry.get(ModelFormatId.MINECRAFT_SKIN)?.snap?.subdivisions || 16;
    $$Tabs();
    renderDetail();
    list.textContent = '正在讀取模型列表…';
    dialog.style.removeProperty('left');
    dialog.style.removeProperty('top');
    dialog.style.removeProperty('position');
    dialog.style.removeProperty('margin');
    dialog.showModal();
    try { await renderList(); }
    catch (error) { list.textContent = `模型列表讀取失敗：${error.message}`; toast(error.message); }
  }

  function $$Tabs() {
    dialog.querySelectorAll('[data-skin-edition]').forEach(button =>
      button.classList.toggle('active', button.dataset.skinEdition === edition));
  }

  async function create() {
    if (!selected || busy) return;
    const snap = Number($('#skinPickerSnap').value);
    if (!Number.isFinite(snap) || snap < .0001) return void toast('請輸入有效的標準吸附精度');
    const record = selected;
    const template = $('#skinPickerTemplateTexture').checked;
    const texture = record.textures.find(item => item.id === textureSelect.value);
    busy = true;
    createButton.disabled = true;
    createButton.textContent = '正在建立…';
    try {
      const raw = JSON.parse(await readLibraryAsset(record.model));
      const gameTexture = !template && texture
        ? { ...texture, source: await readLibraryAsset(texture.file) } : null;
      const { project, textureAssets } = createSkinProject(record, raw, {
        name: label(record), textureMode: template ? 'template' : 'game', gameTexture
      });
      project.snap = { subdivisions: snap };
      const tab = addProjectTab(project, { dirty: true, textureAssets });
      const bounds = projectSizeBounds(project, { includeModifiers: false });
      if (bounds?.min?.every(Number.isFinite) && bounds?.max?.every(Number.isFinite)) {
        tab.session.target = state.target = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
        const span = Math.max(...bounds.max.map((value, axis) => value - bounds.min[axis]));
        tab.session.zoom = state.zoom = Math.max(.15, Math.min(2, 30 / Math.max(1, span)));
      }
      setMode('paint');
      renderScene();
      markDirty();
      dialog.close();
      toast(`已建立 ${label(record)} 皮膚項目`);
    } catch (error) { toast(`建立皮膚項目失敗：${error.message}`); }
    finally { busy = false; createButton.textContent = '開始繪畫'; createButton.disabled = !selected; }
  }

  dialog.querySelector('.dialog-heading') && bindDialogDrag(dialog, dialog.querySelector('.dialog-heading'));
  $('#skinPickerClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => livePreview.reset());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.querySelectorAll('[data-skin-edition]').forEach(button => button.addEventListener('click', () => {
    edition = button.dataset.skinEdition;
    selected = null;
    $$Tabs();
    renderDetail();
    void renderList();
  }));
  search.addEventListener('input', () => void renderList());
  list.addEventListener('click', async event => {
    const card = event.target.closest('[data-skin-id]');
    if (!card) return;
    selected = (await catalog()).entries.find(record => record.id === card.dataset.skinId) || null;
    list.querySelectorAll('.skin-picker-card').forEach(button =>
      button.classList.toggle('active', button.dataset.skinId === selected?.id));
    renderDetail();
  });
  list.addEventListener('dblclick', () => void create());
  dialog.querySelectorAll('[name="skinTextureMode"]').forEach(input =>
    input.addEventListener('change', () => {
      textureSelect.disabled = $('#skinPickerTemplateTexture').checked;
      renderPreview();
    }));
  textureSelect.addEventListener('change', renderPreview);
  createButton.addEventListener('click', () => void create());
  return { open };
}
