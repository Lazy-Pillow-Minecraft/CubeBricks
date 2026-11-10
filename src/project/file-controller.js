import { CubeBricksProject, importBlockbench } from '../model.js';
import { createBakedBlockbenchExport } from '../texture/export-bake.js';
import { beginTextureExportProgress } from '../texture/export-progress.js';
import { ConfigKey, configRegistry } from '../common/config/app-config.js';
import { showAppConfirm, showAppChoice } from '../screen/prompt-dialog.js';
import { beginProjectOpenProgress } from './open-progress.js';
import { chooseProjectExport } from './export-dialog.js';
import { createNativeExportController } from './native-export-controller.js';
import { decodeNativeJson } from '../model/formats/native-json.js';
import { importModdedJava } from '../model/formats/modded-java.js';
import { loadRaster } from '../common/core/texture-features.js';
import { splitTextureAnimation } from '../texture/animation-import.js';
import { textureSnapshot } from './texture-snapshot.js';

export function createProjectFileController({
  state, fileInput, projectTabsController, journalController,
  getShapePacksReady, activateProjectTab, addProjectTab, markDirty,
  discardProjectTabJournal, renderProjectTabs, projectTabById,
  flushProjectJournal, toast, textureFileController
}) {
  const blobTextureSourceCache = new Map();
  const exportNative = createNativeExportController({
    serializableTextureAssets, textureFileController, download,
    async onSaved(project, committed) {
      if (state.project !== project) return;
      if (!committed) journalController.noteJournalOperation('core.texture.save');
      else markDirty();
    }
  });
  async function openProject(filePath = null) {
    const home = projectTabById(projectTabsController.activeId);
    const replaceTabId = home?.kind === 'home' ? home.id : null;
    const progress = beginProjectOpenProgress({ waitForProgress: !filePath });
    try {
      await getShapePacksReady();
      if (window.cubeBricksDesktop) {
        const result = await window.cubeBricksDesktop.openProject(filePath);
        if (!result) return;
        const existing = projectTabsController.tabs.find(tab => tab.journalId && tab.journalId === result.journalId);
        if (existing) {
          if (replaceTabId && projectTabsController.tabs.includes(home)) projectTabsController.removeProjectTab(home);
          activateProjectTab(existing.id);
          return;
        }
        const textureAssets = result.textureAssets || [];
        for (const asset of textureAssets) if (asset.animationMetadata && !asset.animation) {
          const image = await loadRaster(asset.source);
          const animation = splitTextureAnimation(image, asset.animationMetadata);
          if (animation) Object.assign(asset, animation);
          delete asset.animationMetadata;
        }
        loadProjectContent(result.content, result.filePath, textureAssets, result.journalId || null,
          { dirty: result.dirty, persistent: result.persistent, replaceTabId });
      } else fileInput.click();
    } catch (error) { toast(`打開失敗：${error.message}`); }
    finally {
      progress.finish();
    }
  }

  async function openWorkspaceProject(journalId) {
    const home = projectTabById(projectTabsController.activeId);
    const replaceTabId = home?.kind === 'home' ? home.id : null;
    const existing = projectTabsController.tabs.find(tab => tab.journalId === journalId);
    if (existing) {
      if (replaceTabId) projectTabsController.removeProjectTab(home);
      activateProjectTab(existing.id);
      return existing;
    }
    const progress = beginProjectOpenProgress();
    try {
      await getShapePacksReady();
      const result = await window.cubeBricksDesktop.recoverProjectJournal({ journalId });
      return loadProjectContent(result.content, result.filePath || '', [], result.journalId,
        { dirty: result.dirty ?? !result.filePath, persistent: result.persistent, replaceTabId });
    } finally { progress.finish(); }
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

  async function serializeBbmodel(textureAssets, project = state.project) {
    const progress = beginTextureExportProgress();
    try {
      return JSON.stringify(await createBakedBlockbenchExport(project, textureAssets, { progress: progress.progress }), null, 2);
    } finally { progress.finish(); }
  }

  function serializeCbmodel(textureAssets = [], project = state.project, textureGroups = state.textureGroups,
    { snapshotOwned = false, compact = false } = {}) {
    const data = typeof project.serialize === 'function' ? JSON.parse(project.serialize())
      : snapshotOwned ? project : structuredClone(project);
    data.textureGroups = snapshotOwned ? textureGroups || [] : structuredClone(textureGroups || []);
    data.textures = textureAssets.map((texture, index) => textureSnapshot(texture, index, data.textureSize, snapshotOwned));
    return JSON.stringify(data, null, compact ? 0 : 2);
  }

  function loadProjectContent(content, filePath = '', resolvedTextures = [], journalId = null, options = {}) {
    const data = decodeNativeJson(JSON.parse(content.replace(/^\uFEFF/, '')), filePath);
    // A journal already contains native snapshots, regardless of the original
    // imported filename recorded in saved_state.
    const project = !journalId && (filePath.toLowerCase().endsWith('.bbmodel') || data.meta?.model_format)
      ? importBlockbench(data) : new CubeBricksProject(data);
    if (data._cubebricksFormatData) project.formatData = { ...project.formatData, ...data._cubebricksFormatData };
    const savedPath = filePath.toLowerCase().endsWith('.cbmodel') ? filePath : null;
    const embeddedTextures = (data.textures || []).filter(texture => typeof texture.source === 'string' && texture.source.startsWith('data:image/')).map(texture => ({
      uuid: texture.uuid, id: texture.id, name: texture.name || 'embedded_texture.png', source: texture.source,
      uvWidth: texture.uv_width, uvHeight: texture.uv_height, useAsDefault: texture.use_as_default === true,
      groupId: texture.group_id || null, kind: texture.kind || 'IMAGE',
      templateUvIndependent: texture.template_uv_independent ?? null,
      mode: texture.mode || 'default',
      layers: texture.layers || null, activeLayerUid: texture.active_layer_uid || null, animation: texture.animation || null,
      namespace: texture.namespace, externalFile: texture.external_file || (data.meta?.model_format ? { imported: true, path: null } : null)
    }));
    const tab = addProjectTab(project, {
      filePath: savedPath,
      displayName: filePath ? filePath.split(/[\\/]/).pop() : null,
      textureAssets: resolvedTextures.length ? resolvedTextures : embeddedTextures,
      textureGroups: data.textureGroups || [],
      dirty: options.dirty ?? !savedPath,
      journalId,
      imported: true, persistent: options.persistent, replaceTabId: options.replaceTabId
    });
    if (options.dirty !== undefined) {
      journalController.suppressRecording = true;
      try { markDirty(options.dirty, { constrain: false }); } finally { journalController.suppressRecording = false; }
    } else markDirty(!savedPath, { constrain: false });
    toast(`已打開 ${project.name}`);
    return tab;
  }

  async function offerProjectRecovery() {
    if (!window.cubeBricksDesktop?.listRecoverableProjects) return;
    try {
      const retained = await window.cubeBricksDesktop.retainedProjectTabs?.() || [];
      const restored = new Set();
      for (const tab of retained) {
        try {
          const result = await window.cubeBricksDesktop.recoverProjectJournal(tab);
          loadProjectContent(result.content, tab.filePath || '', [], result.journalId, { dirty: tab.dirty === true, persistent: result.persistent });
          restored.add(tab.journalId);
        } catch (error) { toast(`分頁恢復失敗：${error.message}`); }
      }
      if (restored.size && projectTabsController.tabs.length > 1) {
        const initial = projectTabsController.tabs[0];
        if (initial.kind === 'home') projectTabsController.removeProjectTab(initial);
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
      if (!await showAppConfirm(prompt, {
        title: '恢復工作項目',
        detail: '恢復後會以分頁打開；現有工作項目不會被覆蓋。', buttons: ['恢復', '略過']
      })) return;
      for (const project of pending) {
        const result = await window.cubeBricksDesktop.recoverProjectJournal(project);
        loadProjectContent(result.content, project.filePath || '', [], result.journalId, { dirty: true, persistent: result.persistent });
      }
      if (pending.length > 1) toast(`已恢復 ${pending.length} 個工作項目`);
    } catch (error) { toast(`工作項目恢復失敗：${error.message}`); }
  }

  async function saveProject() {
    try {
      const activeTab = projectTabById(projectTabsController.activeId);
      if (!activeTab || activeTab.kind === 'home') return;
      if (!window.cubeBricksDesktop?.commitProjectJournal) {
        toast('瀏覽器預覽無法保留工作目錄，請使用導出');
        return;
      }
      await activeTab.journalReady;
      await flushProjectJournal(activeTab);
      await activeTab?.journalWrites;
      if (activeTab.journalPending) throw new Error('工作記錄尚未寫入，請稍後重試');
      const savedRevision = activeTab.journalEditRevision || 0;
      await window.cubeBricksDesktop.retainProjectJournal({ journalId: activeTab.journalId });
      activeTab.persistedWorkingCopy = true;
      activeTab.createdThisLaunch = false;
      if ((activeTab.journalEditRevision || 0) === savedRevision) {
        activeTab.session.dirty = false;
        if (projectTabsController.activeId === activeTab.id) markDirty(false);
        else renderProjectTabs();
      }
    } catch (error) { toast(`保存失敗：${error.message}`); }
  }

  async function exportProject() {
    if (state.projectHomeActive) return;
    try {
      const project = state.project, sourceAssets = state.textureAssets;
      const extension = await chooseProjectExport(project.formatId);
      if (!extension) return;
      if (extension === 'json' || extension === 'java') {
        if (await exportNative(extension, project, sourceAssets)) toast(`已导出 .${extension}`);
        return;
      }
      const activeTab = projectTabById(projectTabsController.activeId);
      if (window.cubeBricksDesktop?.exportProject) {
        const payload = {
          name: project.name, journalId: activeTab?.journalId, extension,
          historyLimit: project.historyLimit ?? configRegistry.get(ConfigKey.HISTORY_LIMIT)
        };
        let result = await window.cubeBricksDesktop.exportProject(payload);
        if (!result) return;
        let includeHistory = null;
        if (result?.requiresHistoryChoice) {
          const choice = await showAppChoice({
            title: 'CubeBricks 導出選項', message: '導出 .cbmodel',
            detail: '不保留歷史時只保存目前完整模型；工作目錄中的撤回記錄不受影響。',
            checkboxLabel: '保留操作歷史', checkboxChecked: true,
            buttons: ['導出', '取消']
          });
          if (choice.index !== 0) return;
          includeHistory = choice.checked;
        }
        await flushProjectJournal(activeTab);
        await activeTab?.journalWrites;
        const textureAssets = await serializableTextureAssets(sourceAssets);
        const content = result.extension === '.cbmodel'
          ? { cbmodelContent: serializeCbmodel(textureAssets, project) }
          : { bbmodelContent: await serializeBbmodel(textureAssets, project) };
        result = await window.cubeBricksDesktop.exportProject({
          ...payload, ...content,
          filePath: result.filePath, ...(includeHistory === null ? {} : { includeHistory })
        });
        if (!result) return;
        toast(result.extension === '.cbmodel'
          ? '已導出 .cbmodel'
          : '已導出 .bbmodel（程序化物件已轉為 Cube 組）');
      } else if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: `${project.name}.${extension}`,
          types: [
            { description: 'Blockbench Model', accept: { 'application/json': ['.bbmodel'] } },
            { description: 'CubeBricks Model', accept: { 'application/json': ['.cbmodel'] } }
          ].sort((a, b) => Number(Object.values(b.accept)[0].includes(`.${extension}`)) - Number(Object.values(a.accept)[0].includes(`.${extension}`)))
        });
        const fileExtension = handle.name.toLowerCase().endsWith('.cbmodel') ? '.cbmodel' : '.bbmodel';
        const textureAssets = await serializableTextureAssets(sourceAssets);
        const content = fileExtension === '.cbmodel' ? serializeCbmodel(textureAssets, project) : await serializeBbmodel(textureAssets, project);
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        toast(`已導出 ${fileExtension}`);
      } else {
        const textureAssets = await serializableTextureAssets(sourceAssets);
        const content = extension === 'cbmodel' ? serializeCbmodel(textureAssets, project) : await serializeBbmodel(textureAssets, project);
        download(content, `${project.name}.${extension}`, 'application/json');
        toast(`已導出 .${extension}`);
      }
    } catch (error) {
      toast(`導出失敗：${error.message}`);
    }
  }

  function download(content, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }

  return {
    openProject,
    serializableTextureAssets,
    serializeCbmodel,
    loadProjectContent,
    async loadProjectFile(file) {
      const content = await file.text();
      if (/\.java$/i.test(file.name)) return loadProjectContent(JSON.stringify(await importModdedJava(content)), file.name);
      let data = JSON.parse(content.replace(/^\uFEFF/, ''));
      if (data['minecraft:geometry']?.length > 1) {
        const choices = data['minecraft:geometry'].map((geometry, index) => geometry.description?.identifier || String(index + 1));
        const selected = await showAppChoice({ title: '选择几何模型', message: '文件包含多个几何模型，请选择要导入的一个', buttons: [...choices, '取消'], cancelIndex: choices.length });
        if (selected.index === choices.length) return null;
        data = { ...data, 'minecraft:geometry': [data['minecraft:geometry'][selected.index]] };
      }
      if (data['minecraft:geometry'] || Object.keys(data).some(key => key.startsWith('geometry.') && data[key]?.bones)) {
        const selected = await showAppChoice({ title: '选择基岩模型类型', message: '几何 JSON 本身不区分实体与方块', buttons: ['基岩版实体', '基岩版方块', '取消'], cancelIndex: 2 });
        if (selected.index === 2) return null;
        data = decodeNativeJson(data, file.name, [], ['bedrock_entity', 'bedrock_block'][selected.index]);
      }
      return loadProjectContent(JSON.stringify(data), file.name);
    },
    offerProjectRecovery,
    saveProject, openWorkspaceProject,
    exportProject,
  };
}
