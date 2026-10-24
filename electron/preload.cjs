const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('cubeBricksDesktop', {
  openProject: (filePath = null) => ipcRenderer.invoke('project:open', filePath ? { filePath } : {}),
  getPathForFile: file => webUtils.getPathForFile(file),
  onExternalProjectOpen: listener => {
    const handler = (_event, filePath) => listener(filePath);
    ipcRenderer.on('project:external-open', handler);
    void ipcRenderer.invoke('project:external-ready');
    return () => ipcRenderer.removeListener('project:external-open', handler);
  },
  saveProjectCover: payload => ipcRenderer.invoke('project:cover-save', payload),
  onProjectOpenProgress: listener => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('project:open-progress', handler);
    return () => ipcRenderer.removeListener('project:open-progress', handler);
  },
  onPromptRequest: listener => {
    const handler = (_event, request) => listener(request);
    ipcRenderer.on('app:prompt-request', handler);
    return () => ipcRenderer.removeListener('app:prompt-request', handler);
  },
  respondPrompt: response => ipcRenderer.invoke('app:prompt-response', response),
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  exportProject: (payload) => ipcRenderer.invoke('project:export', payload),
  saveCaptureImage: (payload) => ipcRenderer.invoke('image:save-capture', payload),
  copyCaptureImage: (dataUrl) => ipcRenderer.invoke('image:copy-capture', dataUrl),
  initProjectJournal: (payload) => ipcRenderer.invoke('project:journal-init', payload),
  discardProjectJournal: (payload) => ipcRenderer.invoke('project:journal-discard', payload),
  commitProjectJournal: (payload) => ipcRenderer.invoke('project:journal-commit', payload),
  compactProjectJournal: (payload) => ipcRenderer.invoke('project:journal-compact', payload),
  checkoutProjectJournal: (payload) => ipcRenderer.invoke('project:journal-checkout', payload),
  projectJournalState: (payload) => ipcRenderer.invoke('project:journal-state', payload),
  listRecoverableProjects: () => ipcRenderer.invoke('project:journal-list-recoverable'),
  listWorkspaceProjects: (options) => ipcRenderer.invoke('project:list-workspace', options),
  recoverProjectJournal: (payload) => ipcRenderer.invoke('project:journal-recover', payload),
  projectWorkspaceRoot: () => ipcRenderer.invoke('project:workspace-root'),
  listShapePacks: () => ipcRenderer.invoke('shape-packs:list'),
  listResourcePacks: () => ipcRenderer.invoke('packs:list'),
  readFontPack: (id) => ipcRenderer.invoke('packs:font-data', id),
  installResourcePack: (kind) => ipcRenderer.invoke('packs:install', kind),
  removeResourcePack: (id) => ipcRenderer.invoke('packs:remove', id),
  orderResourcePacks: (order) => ipcRenderer.invoke('packs:order', order),
  chooseProjectWorkspaceRoot: () => ipcRenderer.invoke('project:choose-workspace-root'),
  setProjectWorkspaceRoot: (directory) => ipcRenderer.invoke('project:set-workspace-root', directory),
  onCloseRequested: (listener) => ipcRenderer.on('app:request-close', () => listener()),
  retainedProjectTabs: () => ipcRenderer.invoke('app:retained-tabs'),
  confirmProjectClose: (payload) => ipcRenderer.invoke('app:confirm-close', payload),
  platform: process.platform
});
