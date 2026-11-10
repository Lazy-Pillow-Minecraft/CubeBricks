import { CubeBricksProject } from '../model.js';
import { ConfigKey, resolveUiLanguage } from '../common/config/app-config.js';
import { createModelProjectData, ModelFormatId, modelFormatRegistry } from '../common/config/model-formats.js';

export function createModelFormatPicker({
  $, escapeHtml, escapeAttribute,
  addProjectTab, markDirty, toast, configRegistry, openWorkspaceProject, deleteWorkspaceProject, showContextMenu
}) {
  let homeCoverObserver = null;
  const MODEL_FORMAT_ICONS = Object.freeze({
    generic: 'reference-grid',
    image: 'image-format',
    'java-block': 'java-block',
    'bedrock-entity': 'bedrock-entity',
    'bedrock-block': 'bedrock-block',
    'modded-entity': 'modded-entity'
  });

  function modelFormatIconMarkup(icon) {
    if (icon === 'skin') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.3" r="2.8" stroke="none"/><path d="M9.2 9h5.6l1.2 5-2 1v6h-1.5l-.5-5-.5 5H10v-6l-2-1 1.2-5Z" stroke="none"/></svg>';
    const asset = Object.hasOwn(MODEL_FORMAT_ICONS, icon) ? MODEL_FORMAT_ICONS[icon] : MODEL_FORMAT_ICONS.generic;
    return `<span class="ui-mask-icon" aria-hidden="true" style="--ui-icon:url('assets/ui-icons/${asset}.svg')"></span>`;
  }

  function renderHomeFormats() {
    const container = $('#homeFormatList');
    if (!container) return;
    const categories = new Map();
    for (const format of modelFormatRegistry.list()) {
      if (format.id === ModelFormatId.GECKOLIB) continue;
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
      const deferredCovers = Boolean(window.cubeBricksDesktop.loadProjectCover && window.IntersectionObserver);
      const projects = await window.cubeBricksDesktop.listWorkspaceProjects({ refresh, includeCovers: !deferredCovers });
      homeCoverObserver?.disconnect();
      container.innerHTML = projects.length ? projects.map(project => `<button type="button" class="project-home-card" data-home-project="${escapeAttribute(project.journalId)}"><span class="project-home-cover">${project.cover ? `<img src="${escapeAttribute(project.cover)}" alt="" />` : '<span aria-hidden="true">封面待生成</span>'}</span><strong>${escapeHtml(project.name || '未命名')}</strong><small>${escapeHtml(project.filePath || (project.persistent ? '已保存的工作項目' : '從未保存的工作項目'))}</small><small>${escapeHtml(project.modifiedAt ? new Date(project.modifiedAt).toLocaleString() : '')} · ${project.elementCount || 0} 個元素</small></button>`).join('') : '<p class="project-home-empty">尚無工作項目。從左側選擇模型格式開始吧。</p>';
      if (deferredCovers) {
        const observer = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const card = entry.target;
            observer.unobserve(card);
            const journalId = card.dataset.homeProject;
            void window.cubeBricksDesktop.loadProjectCover({ journalId }).then(cover => {
              if (!cover || !card.isConnected || card.dataset.homeProject !== journalId) return;
              const preview = card.querySelector('.project-home-cover');
              if (preview) preview.innerHTML = `<img src="${escapeAttribute(cover)}" alt="" />`;
            }).catch(error => console.warn('項目封面讀取失敗', error));
          }
        }, { root: container.closest('.project-home-projects'), rootMargin: '160px 0px' });
        homeCoverObserver = observer;
        container.querySelectorAll('[data-home-project]').forEach(card => observer.observe(card));
      }
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
        await openWorkspaceProject(button.dataset.homeProject);
      } catch (error) {
        toast(`打開工作項目失敗：${error.message}`);
        button.disabled = false;
      }
    });
    $('#homeProjectList')?.addEventListener('contextmenu', event => {
      const card = event.target.closest('[data-home-project]');
      if (!card) return;
      showContextMenu(event, {
        title: card.querySelector('strong')?.textContent || '項目', source: card,
        items: [{
          label: '刪除項目', danger: true, action: async () => {
            try { if (await deleteWorkspaceProject(card.dataset.homeProject)) await renderProjectHome(); }
            catch (error) { toast(`刪除項目失敗：${error.message}`); }
          }
        }]
      });
    });
    window.addEventListener('cubebricks:project-home', () => void renderProjectHome());
    window.addEventListener('cubebricks:project-cover-updated', () => {
      if (document.body.classList.contains('project-home-active')) void renderProjectHome();
    });
  }

  function newProject(formatId) {
    const format = modelFormatRegistry.get(formatId);
    if (!format) return toast('未知模型格式');
    if (format.status === 'placeholder') return toast(format.placeholderReason || '這個格式尚未實現');
    const initialData = createModelProjectData(format.id, {
      name: 'untitled',
      language: resolveUiLanguage(configRegistry.get(ConfigKey.LANGUAGE))
    });
    const project = new CubeBricksProject({ name: 'untitled', ...initialData });
    addProjectTab(project, { dirty: true, textureAssets: [] });
    markDirty();
    toast(`已建立 ${format.name}`);
  }

  return {
    renderProjectHome,
    bindProjectHome,
  };
}
