import { CubeBricksProject, exportBlockbench, importBlockbench } from '../model.js';
import { constrainProject } from '../common/core/format-constraints.js';
import { ConfigKey, configRegistry } from '../common/config/app-config.js';
import { showAppConfirm, showAppChoice } from '../screen/prompt-dialog.js';

export function createProjectFileController({
  state, fileInput, projectTabsController, journalController,
  getShapePacksReady, activateProjectTab, addProjectTab, markDirty,
  discardProjectTabJournal, renderProjectTabs, projectTabById,
  flushProjectJournal, toast
}) {
const blobTextureSourceCache = new Map();
async function openProject(filePath = null) {
  const progressDialog = document.getElementById('projectOpenProgressDialog');
  const progressBar = document.getElementById('projectOpenProgressBar');
  const progressStatus = document.getElementById('projectOpenProgressStatus');
  const progressPercent = document.getElementById('projectOpenProgressPercent');
  let progressTimer = null;
  let unsubscribeProgress = null;
  let progressStarted = false;
  try {
    await getShapePacksReady();
    if (window.cubeBricksDesktop) {
      unsubscribeProgress = window.cubeBricksDesktop.onProjectOpenProgress?.(({ value, label }) => {
        if (!progressStarted) {
          progressStarted = true;
          progressTimer = setTimeout(() => {
            if (progressDialog && !progressDialog.open) progressDialog.showModal();
          }, 250);
        }
        const fraction = Math.max(0, Math.min(1, Number(value) || 0));
        if (progressBar) progressBar.value = fraction;
        if (progressStatus) progressStatus.textContent = label || '正在載入項目…';
        if (progressPercent) progressPercent.textContent = `${Math.round(fraction * 100)}%`;
      });
      if (progressDialog) progressDialog.oncancel = event => event.preventDefault();
      const result = await window.cubeBricksDesktop.openProject(filePath);
      if (!result) return;
      const existing = projectTabsController.tabs.find(tab => tab.journalId && tab.journalId === result.journalId);
      if (existing) { activateProjectTab(existing.id); return; }
      loadProjectContent(result.content, result.filePath, result.textureAssets || [], result.journalId || null,
        result.dirty === undefined ? {} : { dirty: result.dirty });
    } else fileInput.click();
  } catch (error) { toast(`打開失敗：${error.message}`); }
  finally {
    if (progressTimer) clearTimeout(progressTimer);
    unsubscribeProgress?.();
    if (progressDialog?.open) progressDialog.close();
  }
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
    if (!await showAppConfirm(prompt, { title: '恢復工作項目',
      detail: '恢復後會以分頁打開；現有工作項目不會被覆蓋。', buttons: ['恢復', '略過'] })) return;
    for (const project of pending) {
      const result = await window.cubeBricksDesktop.recoverProjectJournal(project);
      loadProjectContent(result.content, project.filePath || '', [], result.journalId, { dirty: true });
    }
    if (pending.length > 1) toast(`已恢復 ${pending.length} 個工作項目`);
  } catch (error) { toast(`工作項目恢復失敗：${error.message}`); }
}

async function saveProject() {
  try {
    const activeTab = projectTabById(projectTabsController.activeId);
    if (!activeTab) return;
    if (!window.cubeBricksDesktop?.commitProjectJournal) {
      toast('瀏覽器預覽無法保留工作目錄，請使用導出');
      return;
    }
    await activeTab.journalReady;
    await flushProjectJournal(activeTab);
    await activeTab?.journalWrites;
    if (activeTab.journalPending) throw new Error('工作記錄尚未寫入，請稍後重試');
    activeTab.persistedWorkingCopy = true;
    activeTab.createdThisLaunch = false;
    markDirty(false);
    toast('工作項目已保留在項目資料夾');
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
      const payload = {
        name: state.project.name, cbmodelContent, bbmodelContent, journalId: activeTab?.journalId,
        historyLimit: state.project.historyLimit ?? configRegistry.get(ConfigKey.HISTORY_LIMIT)
      };
      let result = await window.cubeBricksDesktop.exportProject(payload);
      if (result?.requiresHistoryChoice) {
        const choice = await showAppChoice({ title: 'CubeBricks 導出選項', message: '導出 .cbmodel',
          detail: '不保留歷史時只保存目前完整模型；工作目錄中的撤回記錄不受影響。',
          checkboxLabel: '保留操作歷史', checkboxChecked: true,
          buttons: ['導出', '取消'] });
        if (choice.index !== 0) return;
        result = await window.cubeBricksDesktop.exportProject({ ...payload,
          filePath: result.filePath, includeHistory: choice.checked });
      }
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
