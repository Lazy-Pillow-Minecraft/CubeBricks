import { CubeBricksProject } from '../model.js';
import { ConfigKey } from '../common/config/app-config.js';
import { createModelProjectData, modelFormatRegistry } from '../common/config/model-formats.js';

export function createModelFormatPicker({
  $, newProjectDialog, escapeHtml, escapeAttribute, formatNumber,
  addProjectTab, markDirty, toast, configRegistry, loadProjectContent
}) {
const MODEL_FORMAT_ICONS = Object.freeze({
  generic: '<path d="M4 12 12 8l8 4-8 4-8-4Z" stroke="none"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" fill="none" stroke-width="1.8"/><circle cx="8.3" cy="9" r="1.7" stroke="none"/><path d="m5.5 17 4.4-4.4 3.1 3 2.5-2.4 3 3.8" fill="none" stroke-width="1.8"/>',
  'java-block': '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9" fill="none" stroke-width="1.8"/>',
  'bedrock-entity': '<path d="m12 3 5 2.8v5.7L12 14l-5-2.5V5.8L12 3Z" stroke="none"/><path d="M5 18.5h14M8 14.5v4m8-4v4" fill="none" stroke-width="1.8"/>',
  'bedrock-block': '<path d="M5 7.5 12 4l7 3.5v9L12 20l-7-3.5v-9Zm7 1v7m-7-8 7 3.5 7-3.5" fill="none" stroke-width="1.8"/><path d="M8 9v5l4 2" fill="none" stroke-width="1.8"/>',
  'modded-entity': '<path d="M7 8h10v9a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V8Zm10 2h2a2 2 0 0 1 0 4h-2M9 5h6" fill="none" stroke-width="1.8"/>',
  skin: '<circle cx="12" cy="5.3" r="2.8" stroke="none"/><path d="M9.2 9h5.6l1.2 5-2 1v6h-1.5l-.5-5-.5 5H10v-6l-2-1 1.2-5Z" stroke="none"/>',
  geckolib: '<path d="m12 3.5 7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7L12 3.5Z" fill="none" stroke-width="1.7" stroke-dasharray="3 2"/><path d="M8 8.5h8v7H8z" fill="none" stroke-width="1.7"/>'
});

function modelFormatIconMarkup(icon) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${MODEL_FORMAT_ICONS[icon] || MODEL_FORMAT_ICONS.generic}</svg>`;
}

function renderModelFormatPicker() {
  const container = $('#modelFormatList');
  if (!container) return;
  const categories = new Map();
  for (const format of modelFormatRegistry.list()) {
    if (!categories.has(format.category)) categories.set(format.category, []);
    categories.get(format.category).push(format);
  }
  const categoryLabels = { general: '通用', minecraft: 'Minecraft' };
  container.innerHTML = [...categories].map(([category, formats]) => `<section class="model-format-category">
    <h3>${escapeHtml(categoryLabels[category] || category)}</h3>
    <div class="model-format-grid">${formats.map(format => {
      const placeholder = format.status === 'placeholder';
      const snap = Number(format.snap?.subdivisions);
      const details = [format.description, Number.isFinite(snap) ? `標準吸附 ${formatNumber(snap)} · ${formatNumber(16 / snap)}px` : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="model-format-card ${placeholder ? 'is-placeholder' : ''}" data-model-format="${escapeAttribute(format.id)}" aria-disabled="${placeholder}">
        <span class="model-format-card-icon">${modelFormatIconMarkup(format.icon)}</span>
        <span class="model-format-card-copy"><strong>${escapeHtml(format.name)}</strong><small>${escapeHtml(details)}</small></span>
        ${placeholder ? `<span class="model-format-placeholder">佔位</span>` : ''}
      </button>`;
    }).join('')}</div>
  </section>`).join('');
}

function openNewProjectDialog() {
  renderModelFormatPicker();
  newProjectDialog.showModal();
}

function renderHomeFormats() {
  const container = $('#homeFormatList');
  if (!container) return;
  const categories = new Map();
  for (const format of modelFormatRegistry.list()) {
    if (!categories.has(format.category)) categories.set(format.category, []);
    categories.get(format.category).push(format);
  }
  container.innerHTML = [...categories].map(([category, formats]) => `<section><h3>${escapeHtml(category === 'general' ? '通用' : category === 'minecraft' ? 'Minecraft' : category)}</h3>${formats.map(format => `<button type="button" data-home-format="${escapeAttribute(format.id)}" ${format.status === 'placeholder' ? 'disabled' : ''} title="${escapeAttribute(format.description || format.name)}">${modelFormatIconMarkup(format.icon)}<span>${escapeHtml(format.name)}</span></button>`).join('')}</section>`).join('');
}

async function renderProjectHome(refresh = false) {
  renderHomeFormats();
  const container = $('#homeProjectList');
  if (!container) return;
  if (!window.cubeBricksDesktop?.listWorkspaceProjects) {
    container.innerHTML = '<p class="project-home-empty">本機工作項目只在桌面版顯示。</p>';
    return;
  }
  try {
    const projects = await window.cubeBricksDesktop.listWorkspaceProjects({ refresh });
    container.innerHTML = projects.length ? projects.map(project => `<button type="button" class="project-home-card" data-home-project="${escapeAttribute(project.journalId)}"><strong>${escapeHtml(project.name || '未命名')}</strong><small>${escapeHtml(project.filePath || '未保存的工作項目')}</small><small>${escapeHtml(project.modifiedAt ? new Date(project.modifiedAt).toLocaleString() : '')} · ${project.elementCount || 0} 個元素</small></button>`).join('') : '<p class="project-home-empty">尚無工作項目。從左側選擇模型格式開始吧。</p>';
  } catch (error) { container.textContent = `項目列表讀取失敗：${error.message}`; }
}

function bindProjectHome() {
  $('#homeFormatList')?.addEventListener('click', event => {
    const button = event.target.closest('[data-home-format]');
    if (button && !button.disabled) newProject(button.dataset.homeFormat);
  });
  $('#homeRefreshProjects')?.addEventListener('click', () => void renderProjectHome(true));
  $('#homeProjectList')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-home-project]');
    if (!button) return;
    button.disabled = true;
    try {
      const result = await window.cubeBricksDesktop.recoverProjectJournal({ journalId: button.dataset.homeProject });
      loadProjectContent(result.content, result.filePath || '', [], result.journalId,
        { dirty: result.dirty ?? !result.filePath });
    } catch (error) { toast(`打開工作項目失敗：${error.message}`); button.disabled = false; }
  });
  window.addEventListener('cubebricks:project-home', () => void renderProjectHome());
}

function newProject(formatId) {
  const format = modelFormatRegistry.get(formatId);
  if (!format) return toast('未知模型格式');
  if (format.status === 'placeholder') return toast(format.placeholderReason || '這個格式尚未實現');
  const initialData = createModelProjectData(format.id, {
    name: 'untitled',
    language: configRegistry.get(ConfigKey.LANGUAGE)
  });
  const project = new CubeBricksProject({ name: 'untitled', ...initialData });
  addProjectTab(project, { dirty: true, textureAssets: [] });
  if (newProjectDialog.open) newProjectDialog.close();
  markDirty(); toast(`已建立 ${format.name}`);
}

return {
  modelFormatIconMarkup,
  renderModelFormatPicker,
  openNewProjectDialog,
  newProject,
  renderProjectHome,
  bindProjectHome,
};
}
