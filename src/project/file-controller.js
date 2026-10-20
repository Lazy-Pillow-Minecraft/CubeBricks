import { CubeBricksProject, exportBlockbench, importBlockbench } from '../model.js';
import { constrainProject } from '../common/core/format-constraints.js';

export function createProjectFileController({
  state, fileInput, projectTabsController, journalController,
  getShapePacksReady, activateProjectTab, addProjectTab, markDirty,
  discardProjectTabJournal, renderProjectTabs, projectTabById,
  flushProjectJournal, toast
}) {
const blobTextureSourceCache = new Map();
async function openProject() {
  try {
    await getShapePacksReady();
    if (window.cubeBricksDesktop) {
      const result = await window.cubeBricksDesktop.openProject();
      if (!result) return;
      const existing = projectTabsController.tabs.find(tab => tab.journalId && tab.journalId === result.journalId);
      if (existing) { activateProjectTab(existing.id); return; }
      loadProjectContent(result.content, result.filePath, result.textureAssets || [], result.journalId || null,
        result.dirty === undefined ? {} : { dirty: result.dirty });
    } else fileInput.click();
  } catch (error) { toast(`打開失敗：${error.message}`); }
}

async function serializableTextureAssets(assets = state.textureAssets) {
  return Promise.all(assets.map(async texture => {
    if (!String(texture.source || '').startsWith('blob:')) return texture;
    let sourcePromise = blobTextureSourceCache.get(texture.source);
    if (!sourcePromise) {
      sourcePromise = fetch(texture.source).then(response => response.blob()).then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('貼圖轉換失敗'));
        reader.readAsDataURL(blob);
      }));
      blobTextureSourceCache.set(texture.source, sourcePromise);
    }
    const source = await sourcePromise;
    return { ...texture, source };
  }));
}

function serializeCbmodel(textureAssets = [], project = state.project, textureGroups = state.textureGroups) {
  const data = typeof project.serialize === 'function' ? JSON.parse(project.serialize()) : structuredClone(project);
  data.textureGroups = structuredClone(textureGroups || []);
  data.textures = textureAssets.map((texture, index) => ({
    uuid: texture.uuid || texture._uid || `texture_${index + 1}`,
    id: texture.id || String(index),
    name: texture.name || `texture_${index + 1}.png`,
    source: texture.source,
    mode: texture.mode || 'default',
    layers: texture.layers ? structuredClone(texture.layers) : null,
    active_layer_uid: texture.activeLayerUid || null,
    animation: texture.animation ? Object.fromEntries(Object.entries(texture.animation).filter(([key]) => !key.startsWith('_'))) : null,
    uv_width: texture.uvWidth || data.textureSize[0],
    uv_height: texture.uvHeight || data.textureSize[1],
    use_as_default: texture.useAsDefault === true,
    group_id: texture.groupId || null,
    kind: texture.kind || 'IMAGE'
  }));
  return JSON.stringify(data, null, 2);
}

function loadProjectContent(content, filePath = '', resolvedTextures = [], journalId = null, options = {}) {
  const data = JSON.parse(content);
  // A journal already contains native snapshots, regardless of the original
  // imported filename recorded in saved_state.
  const project = !journalId && (filePath.toLowerCase().endsWith('.bbmodel') || data.meta?.model_format)
    ? importBlockbench(data) : new CubeBricksProject(data);
  const savedPath = filePath.toLowerCase().endsWith('.cbmodel') ? filePath : null;
  const embeddedTextures = (data.textures || []).filter(texture => typeof texture.source === 'string' && texture.source.startsWith('data:image/')).map(texture => ({
    uuid: texture.uuid, id: texture.id, name: texture.name || 'embedded_texture.png', source: texture.source,
    uvWidth: texture.uv_width, uvHeight: texture.uv_height, useAsDefault: texture.use_as_default === true,
    groupId: texture.group_id || null, kind: texture.kind || 'IMAGE',
    mode: texture.mode || 'default',
    layers: texture.layers || null, activeLayerUid: texture.active_layer_uid || null, animation: texture.animation || null
  }));
  addProjectTab(project, {
    filePath: savedPath,
    displayName: filePath ? filePath.split(/[\\/]/).pop() : null,
    textureAssets: resolvedTextures.length ? resolvedTextures : embeddedTextures,
    textureGroups: data.textureGroups || [],
    dirty: options.dirty ?? !savedPath,
    journalId,
    imported: true
  });
  if (options.dirty !== undefined) {
    journalController.suppressRecording = true;
    try { markDirty(options.dirty, { constrain: false }); } finally { journalController.suppressRecording = false; }
  } else markDirty(!savedPath, { constrain: false });
  toast(`已打開 ${project.name}`);
}

async function offerProjectRecovery() {
  if (!window.cubeBricksDesktop?.listRecoverableProjects) return;
  try {
    const retained = await window.cubeBricksDesktop.retainedProjectTabs?.() || [];
    const restored = new Set();
    for (const tab of retained) {
      try {
        const result = await window.cubeBricksDesktop.recoverProjectJournal(tab);
        loadProjectContent(result.content, tab.filePath || '', [], result.journalId, { dirty: tab.dirty === true });
        restored.add(tab.journalId);
      } catch (error) { toast(`分頁恢復失敗：${error.message}`); }
    }
    if (restored.size && projectTabsController.tabs.length > 1) {
      const initial = projectTabsController.tabs[0];
      if (!initial.session.project.elements.length && !initial.session.project.groups.length
        && !initial.session.dirty && !initial.session.filePath) {
        projectTabsController.tabs.shift();
        void discardProjectTabJournal(initial).catch(error => toast(`空白工作目錄清理失敗：${error.message}`));
        renderProjectTabs();
      }
      const preferred = retained.find(tab => tab.active && restored.has(tab.journalId));
      if (preferred) {
        const projectTab = projectTabsController.tabs.find(tab => tab.journalId === preferred.journalId);
        if (projectTab) activateProjectTab(projectTab.id);
      }
    }
    const projects = await window.cubeBricksDesktop.listRecoverableProjects();
    const pending = projects.filter(project => !restored.has(project.journalId));
    if (!pending.length) return;
    const prompt = pending.length === 1
      ? `找到未保存的工作項目「${pending[0].name}」。要恢復嗎？`
      : `找到 ${pending.length} 個未保存的工作項目。要全部恢復到分頁嗎？`;
    if (!window.confirm(prompt)) return;
    for (const project of pending) {
      const result = await window.cubeBricksDesktop.recoverProjectJournal(project);
      loadProjectContent(result.content, project.filePath || '', [], result.journalId, { dirty: true });
    }
    if (pending.length > 1) toast(`已恢復 ${pending.length} 個工作項目`);
  } catch (error) { toast(`工作項目恢復失敗：${error.message}`); }
}

async function saveProject(saveAs = false) {
  try {
    const activeTab = projectTabById(projectTabsController.activeId);
    await flushProjectJournal(activeTab);
    await activeTab?.journalWrites;
    const content = serializeCbmodel(await serializableTextureAssets());
    if (window.cubeBricksDesktop) {
      const result = await window.cubeBricksDesktop.saveProject({ filePath: saveAs ? null : state.filePath, name: state.project.name, content, journalId: activeTab?.journalId });
      if (!result) return;
      state.filePath = result.filePath;
      const tab = projectTabById(projectTabsController.activeId);
      if (tab) tab.displayName = null;
    } else download(content, `${state.project.name}.cbmodel`, 'application/json');
    markDirty(false); toast('項目已保存');
  } catch (error) { toast(`保存失敗：${error.message}`); }
}

async function exportProject() {
  try {
    const activeTab = projectTabById(projectTabsController.activeId);
    await flushProjectJournal(activeTab);
    await activeTab?.journalWrites;
    const textureAssets = await serializableTextureAssets();
    const cbmodelContent = serializeCbmodel(textureAssets);
    const exportModel = new CubeBricksProject(JSON.parse(state.project.serialize()));
    constrainProject(exportModel);
    const bbmodelContent = JSON.stringify(exportBlockbench(exportModel, textureAssets), null, 2);
    if (window.cubeBricksDesktop?.exportProject) {
      const result = await window.cubeBricksDesktop.exportProject({
        name: state.project.name, cbmodelContent, bbmodelContent, journalId: activeTab?.journalId
      });
      if (!result) return;
      toast(result.extension === '.cbmodel'
        ? '已導出 .cbmodel'
        : '已導出 .bbmodel（程序化物件已轉為 Cube 組）');
    } else if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${state.project.name}.bbmodel`,
        types: [
          { description: 'Blockbench Model', accept: { 'application/json': ['.bbmodel'] } },
          { description: 'CubeBricks Model', accept: { 'application/json': ['.cbmodel'] } }
        ]
      });
      const extension = handle.name.toLowerCase().endsWith('.cbmodel') ? '.cbmodel' : '.bbmodel';
      const writable = await handle.createWritable();
      await writable.write(extension === '.cbmodel' ? cbmodelContent : bbmodelContent);
      await writable.close();
      toast(`已導出 ${extension}`);
    } else {
      download(bbmodelContent, `${state.project.name}.bbmodel`, 'application/json');
      toast('已導出 .bbmodel（目前瀏覽器不支援格式選擇）');
    }
  } catch (error) {
    toast(`導出失敗：${error.message}`);
  }
}

function download(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

return {
  openProject,
  serializableTextureAssets,
  serializeCbmodel,
  loadProjectContent,
  offerProjectRecovery,
  saveProject,
  exportProject,
};
}
