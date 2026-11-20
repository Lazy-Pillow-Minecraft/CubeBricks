const LAYOUT_KEY = 'cubebricks.dock-layout.v1';
const ZONES_KEY = 'cubebricks.dock-zones.v1';
const TIME_KEY = 'cubebricks.dock-layout-updated.v1';
const CORNERS_KEY = 'cubebricks.dock-corners.v1';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function readJson(storage, key) {
  try { const value = JSON.parse(storage?.getItem(key) || 'null'); return object(value) ? value : {}; }
  catch { return {}; }
}

export class DockLayoutStorage {
  constructor({ storage = browserStorage(), desktop = globalThis.window?.cubeBricksDesktop } = {}) {
    this.storage = storage;
    this.desktop = desktop;
    let updatedAt = 0;
    try { updatedAt = timestamp(storage?.getItem(TIME_KEY)); } catch { /* Try the desktop copy. */ }
    this.initial = {
      version: 1, layout: readJson(storage, LAYOUT_KEY), zones: readJson(storage, ZONES_KEY),
      corners: readJson(storage, CORNERS_KEY), updatedAt
    };
    this.updatedAt = updatedAt;
  }

  get hasDesktop() { return typeof this.desktop?.loadDockLayout === 'function'; }

  async load() {
    const saved = await this.desktop.loadDockLayout();
    const valid = saved?.version === 1 && object(saved.layout) && object(saved.zones);
    const localNewer = Object.keys(this.initial.layout).length > 0
      && this.initial.updatedAt > timestamp(saved?.updatedAt);
    const snapshot = valid && !localNewer ? saved : this.initial;
    this.updatedAt = Math.max(this.updatedAt, timestamp(snapshot.updatedAt));
    return { snapshot, needsBackup: !valid || localNewer };
  }

  cache(snapshot) {
    if (!this.storage) throw new Error('Dock layout storage is unavailable');
    this.storage.setItem(LAYOUT_KEY, JSON.stringify(snapshot.layout));
    this.storage.setItem(ZONES_KEY, JSON.stringify(snapshot.zones));
    this.storage.setItem(CORNERS_KEY, JSON.stringify(snapshot.corners || {}));
    this.storage.setItem(TIME_KEY, String(snapshot.updatedAt));
  }

  save(layout, zones, corners = {}) {
    this.updatedAt = Math.max(Date.now(), this.updatedAt + 1);
    const snapshot = { version: 1, layout, zones, corners, updatedAt: this.updatedAt };
    let localError = null;
    try { this.cache(snapshot); } catch (error) { localError = error; }
    if (this.desktop?.saveDockLayout) return this.desktop.saveDockLayout(snapshot);
    return localError ? Promise.reject(localError) : Promise.resolve();
  }
}
