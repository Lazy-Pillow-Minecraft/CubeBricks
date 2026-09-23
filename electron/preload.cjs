const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cubeBricksDesktop', {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  platform: process.platform
});
