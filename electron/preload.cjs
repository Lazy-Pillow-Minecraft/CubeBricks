const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cubeBricksDesktop', {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  exportProject: (payload) => ipcRenderer.invoke('project:export', payload),
  saveCaptureImage: (payload) => ipcRenderer.invoke('image:save-capture', payload),
  copyCaptureImage: (dataUrl) => ipcRenderer.invoke('image:copy-capture', dataUrl),
  initProjectJournal: (payload) => ipcRenderer.invoke('project:journal-init', payload),
  discardProjectJournal: (payload) => ipcRenderer.invoke('project:journal-discard', payload),
  commitProjectJournal: (payload) => ipcRenderer.invoke('project:journal-commit', payload),
  checkoutProjectJournal: (payload) => ipcRenderer.invoke('project:journal-checkout', payload),
  projectJournalState: (payload) => ipcRenderer.invoke('project:journal-state', payload),
  listRecoverableProjects: () => ipcRenderer.invoke('project:journal-list-recoverable'),
  listWorkspaceProjects: (options) => ipcRenderer.invoke('project:list-workspace', options),
  recoverProjectJournal: (payload) => ipcRenderer.invoke('project:journal-recover', payload),
  projectWorkspaceRoot: () => ipcRenderer.invoke('project:workspace-root'),
  listShapePacks: () => ipcRenderer.invoke('shape-packs:list'),
  chooseProjectWorkspaceRoot: () => ipcRenderer.invoke('project:choose-workspace-root'),
  setProjectWorkspaceRoot: (directory) => ipcRenderer.invoke('project:set-workspace-root', directory),
  onCloseRequested: (listener) => ipcRenderer.on('app:request-close', () => listener()),
  retainedProjectTabs: () => ipcRenderer.invoke('app:retained-tabs'),
  confirmProjectClose: (payload) => ipcRenderer.invoke('app:confirm-close', payload),
  platform: process.platform
});
