const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const appIcon = path.join(__dirname, '..', 'src', 'assets', process.platform === 'win32' ? 'shortcut-icon.ico' : 'shortcut-icon.png');

app.commandLine.appendSwitch('disable-features', 'WinUseBrowserSpellChecker');

// Keep WebGL available on remote/virtual Windows sessions by using SwiftShader.
if (process.env.CUBEBRICKS_SOFTWARE_RENDERING === '1') {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('in-process-gpu');
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    icon: appIcon,
    backgroundColor: '#11130f',
    titleBarStyle: 'hiddenInset',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#151812', symbolColor: '#dfe9d4', height: 38
    } : false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
};

ipcMain.handle('project:open', async () => {
  const picked = await dialog.showOpenDialog({
    title: '打開模型',
    properties: ['openFile'],
    filters: [
      { name: 'CubeBricks / Blockbench', extensions: ['cbmodel', 'bbmodel'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const filePath = picked.filePaths[0];
  const content = await fs.readFile(filePath, 'utf8');
  return { filePath, content, textureAssets: await readTextureAssets(content, filePath) };
});

async function readTextureAssets(content, modelPath) {
  let model;
  try { model = JSON.parse(content); } catch { return []; }
  const assets = [];
  for (const texture of model.textures || []) {
    let source = null;
    let loadedPath = null;
    const candidates = [];
    if (texture.relative_path) candidates.push(path.resolve(path.dirname(modelPath), texture.relative_path));
    if (texture.path) candidates.push(path.isAbsolute(texture.path) ? texture.path : path.resolve(path.dirname(modelPath), texture.path));
    for (const candidate of candidates) {
      try {
        const bytes = await fs.readFile(candidate);
        const extension = path.extname(candidate).toLowerCase();
        const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
          : extension === '.webp' ? 'image/webp'
            : extension === '.gif' ? 'image/gif' : 'image/png';
        source = `data:${mime};base64,${bytes.toString('base64')}`;
        loadedPath = candidate;
        break;
      } catch { /* Try the next Blockbench-compatible path. */ }
    }
    if (!source && typeof texture.source === 'string' && texture.source.startsWith('data:image/')) source = texture.source;
    if (source) assets.push({
      uuid: texture.uuid,
      id: texture.id,
      name: texture.name || path.basename(loadedPath || 'texture.png'),
      source,
      uvWidth: texture.uv_width,
      uvHeight: texture.uv_height,
      useAsDefault: texture.use_as_default === true
    });
  }
  return assets;
}

ipcMain.handle('project:save', async (_event, payload) => {
  let filePath = payload.filePath;
  if (!filePath) {
    const picked = await dialog.showSaveDialog({
      title: '保存 CubeBricks 模型',
      defaultPath: `${payload.name || 'untitled'}.cbmodel`,
      filters: [{ name: 'CubeBricks Model', extensions: ['cbmodel'] }]
    });
    if (picked.canceled || !picked.filePath) return null;
    filePath = picked.filePath;
  }
  await fs.writeFile(filePath, payload.content, 'utf8');
  return { filePath };
});

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.cubebricks.desktop');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
