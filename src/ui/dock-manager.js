const DOCKS = new Set(['left', 'right', 'bottom', 'floating']);
const STORAGE_KEY = 'cubebricks.dock-layout.v1';
const MIN_WIDTH = 180;
const MIN_HEIGHT = 90;

export class DockPanelObject {
  constructor(definition, element, savedState = {}) {
    this.id = definition.id;
    this.index = definition.index;
    this.modes = Object.freeze([...(definition.modes || [])]);
    this.defaultState = Object.freeze({
      dock: definition.defaultDock,
      order: definition.defaultOrder || 0,
      x: definition.defaultPosition?.x || 80,
      y: definition.defaultPosition?.y || 110,
      width: definition.defaultSize?.width || 280,
      height: definition.defaultSize?.height || 320,
      collapsed: Boolean(definition.defaultCollapsed)
    });
    this.state = normalizeState({ ...this.defaultState, ...savedState }, this.defaultState);
    this.element = element;
    this.handle = element.querySelector('.panel-drag-handle');
    element.dataset.panelIndex = String(this.index);
    element.dataset.panelModes = this.modes.join(' ');
  }

  serialize() {
    return { ...this.state };
  }
}

export class DockManager {
  constructor({ root, definitions, onLayoutChange = () => {}, onInteraction = () => {} }) {
    this.root = root;
    this.onLayoutChange = onLayoutChange;
    this.onInteraction = onInteraction;
    this.zones = new Map([...root.querySelectorAll('[data-dock-zone]')].map(zone => [zone.dataset.dockZone, zone]));
    this.panels = new Map();
    this.mode = 'edit';
    this.previewZone = null;
    this.previewIndex = -1;
    this.placeholder = document.createElement('div');
    this.placeholder.className = 'dock-drop-placeholder';
    const saved = readSavedLayout();

    definitions.forEach(definition => {
      const element = root.querySelector(`[data-panel="${definition.id}"]`);
      if (!element) return;
      const panel = new DockPanelObject(definition, element, saved[definition.id]);
      this.panels.set(panel.id, panel);
      this.installPanelControls(panel);
    });

    this.restoreLayout();
    window.addEventListener('resize', () => {
      this.clampFloatingPanels();
      this.refreshZones();
      this.onLayoutChange();
    });
  }

  getIndex() {
    return [...this.panels.values()].sort((a, b) => a.index - b.index).map(panel => ({
      id: panel.id,
      index: panel.index,
      modes: [...panel.modes],
      defaults: { ...panel.defaultState },
      state: panel.serialize()
    }));
  }

  get(id) {
    return this.panels.get(id) || null;
  }

  setMode(mode) {
    this.mode = mode;
    for (const panel of this.panels.values()) panel.element.hidden = !panel.modes.includes(mode);
    this.refreshZones();
    this.onLayoutChange();
  }

  expand(id) {
    const panel = this.get(id);
    if (panel?.state.collapsed) this.setCollapsed(panel, false);
  }

  restoreLayout() {
    const docked = [...this.panels.values()].filter(panel => panel.state.dock !== 'floating')
      .sort((a, b) => a.state.dock.localeCompare(b.state.dock) || a.state.order - b.state.order || a.index - b.index);
    docked.forEach(panel => this.placeInZone(panel, panel.state.dock));
    [...this.panels.values()].filter(panel => panel.state.dock === 'floating').forEach(panel => this.placeFloating(panel));
    this.setMode(this.mode);
  }

  installPanelControls(panel) {
    panel.element.querySelectorAll('.panel-resizer').forEach(node => node.remove());
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      const handle = document.createElement('div');
      handle.className = `dock-resizer dock-resizer-${edge}`;
      handle.dataset.resizeEdge = edge;
      handle.addEventListener('pointerdown', event => this.startResize(event, panel, edge));
      panel.element.append(handle);
    }

    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'dock-collapse';
    collapse.title = '折疊／展開';
    collapse.setAttribute('aria-label', '折疊或展開面板');
    collapse.addEventListener('click', event => {
      event.stopPropagation();
      this.setCollapsed(panel, !panel.state.collapsed);
    });
    const actionHost = panel.handle?.querySelector('.panel-heading-actions')
      || (panel.handle?.classList.contains('dock-tabs') ? panel.handle : panel.handle?.lastElementChild);
    actionHost?.append(collapse);

    panel.handle?.addEventListener('pointerdown', event => this.startDrag(event, panel));
    this.applyPanelState(panel);
  }

  setCollapsed(panel, collapsed) {
    panel.state.collapsed = collapsed;
    this.applyPanelState(panel);
    this.refreshZones();
    this.persist();
    this.onLayoutChange();
  }

  applyPanelState(panel) {
    const { element, state } = panel;
    element.classList.toggle('detached', state.dock === 'floating');
    element.classList.toggle('is-collapsed', state.collapsed);
    const collapse = element.querySelector('.dock-collapse');
    if (collapse) collapse.textContent = state.collapsed ? '⌄' : '⌃';
    element.style.setProperty('--dock-panel-height', `${state.collapsed ? 34 : state.height}px`);
    element.style.setProperty('--dock-panel-width', `${state.width}px`);
    if (state.dock === 'floating') {
      element.style.left = `${state.x}px`;
      element.style.top = `${state.y}px`;
      element.style.width = `${state.width}px`;
      element.style.height = `${state.collapsed ? this.headerHeight(panel) : state.height}px`;
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    } else {
      element.style.left = '';
      element.style.top = '';
      element.style.right = '';
      element.style.bottom = '';
      element.style.width = '';
      element.style.height = '';
    }
  }

  headerHeight(panel) {
    return panel.handle?.classList.contains('dock-tabs') ? 34 : 52;
  }

  placeInZone(panel, dock, index = null) {
    const zone = this.zones.get(dock);
    if (!zone) return;
    const siblings = this.zonePanels(dock, panel);
    const inheritedWidth = this.isSideDock(dock) && siblings.length
      ? siblings[0].state.width
      : panel.state.width;
    panel.state.dock = dock;
    if (this.isSideDock(dock)) panel.state.width = inheritedWidth;
    const targetIndex = index === null ? Math.min(panel.state.order, siblings.length) : clamp(index, 0, siblings.length);
    zone.insertBefore(panel.element, siblings[targetIndex]?.element || null);
    if (this.isSideDock(dock)) this.setZoneWidth(dock, inheritedWidth);
    else this.applyPanelState(panel);
    this.renumberZone(dock);
  }

  placeFloating(panel, rect = null) {
    if (rect) {
      panel.state.x = rect.left;
      panel.state.y = rect.top;
      panel.state.width = rect.width;
      panel.state.height = Math.max(MIN_HEIGHT, rect.height);
    }
    panel.state.dock = 'floating';
    document.body.append(panel.element);
    this.applyPanelState(panel);
    this.refreshZones();
  }

  zonePanels(dock, except = null) {
    const zone = this.zones.get(dock);
    if (!zone) return [];
    return [...zone.children]
      .filter(element => element.matches?.('[data-panel]') && element !== except?.element)
      .map(element => this.get(element.dataset.panel))
      .filter(Boolean);
  }

  renumberZone(dock) {
    this.zonePanels(dock).forEach((panel, order) => { panel.state.order = order; });
  }

  isSideDock(dock) {
    return dock === 'left' || dock === 'right';
  }

  setZoneWidth(dock, width) {
    const sharedWidth = clamp(width, MIN_WIDTH, 560);
    for (const zonePanel of this.zonePanels(dock)) {
      zonePanel.state.width = sharedWidth;
      this.applyPanelState(zonePanel);
    }
    return sharedWidth;
  }

  startDrag(event, panel) {
    if (event.button !== 0 || event.target.closest('button,input,select')) return;
    event.preventDefault();
    const rect = panel.element.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, rect, dock: panel.state.dock };
    let active = false;

    const move = moveEvent => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (!active && Math.hypot(dx, dy) < 5) return;
      if (!active) {
        active = true;
        this.onInteraction(true);
        panel.element.classList.add('is-dragging');
        if (panel.state.dock !== 'floating') {
          this.placeFloating(panel, rect);
          this.onLayoutChange();
        }
      }
      panel.state.x = clamp(start.rect.left + dx, 0, Math.max(0, innerWidth - panel.state.width));
      panel.state.y = clamp(start.rect.top + dy, 38, Math.max(38, innerHeight - this.headerHeight(panel)));
      panel.element.style.left = `${panel.state.x}px`;
      panel.element.style.top = `${panel.state.y}px`;
      const candidate = this.findDockCandidate(moveEvent.clientX, moveEvent.clientY, panel);
      candidate ? this.showDockPreview(panel, candidate.dock, candidate.index) : this.clearDockPreview();
    };

    const end = endEvent => {
      if (endEvent.pointerId !== event.pointerId) return;
      if (active && this.previewZone) this.placeInZone(panel, this.previewZone.dataset.dockZone, this.previewIndex);
      this.clearDockPreview();
      panel.element.classList.remove('is-dragging');
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      if (active) {
        this.onInteraction(false);
        this.refreshZones();
        this.persist();
        this.onLayoutChange();
      }
    };
    // A docked panel is reparented into <body> when it detaches. Reparenting
    // releases element-level pointer capture in Chromium, so keep the gesture
    // alive at the window boundary until the original pointer is released.
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
  }

  findDockCandidate(x, y, panel) {
    const workspace = this.root.getBoundingClientRect();
    const candidates = [];
    const thresholds = { left: 92, right: 92, bottom: 110 };
    for (const dock of ['left', 'right', 'bottom']) {
      const zone = this.zones.get(dock);
      const rect = zone.getBoundingClientRect();
      if (dock === 'bottom') {
        const leftEdge = this.zones.get('left')?.getBoundingClientRect().right || workspace.left;
        const rightEdge = this.zones.get('right')?.getBoundingClientRect().left || workspace.right;
        if (x < leftEdge || x > rightEdge) continue;
      }
      let distance;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) distance = 0;
      else if (dock === 'left') distance = Math.max(0, x - workspace.left);
      else if (dock === 'right') distance = Math.max(0, workspace.right - x);
      else distance = Math.max(0, workspace.bottom - y);
      if (distance <= thresholds[dock]) candidates.push({ dock, distance, index: this.dropIndex(zone, y, panel) });
    }
    return candidates.sort((a, b) => a.distance / thresholds[a.dock] - b.distance / thresholds[b.dock])[0] || null;
  }

  dropIndex(zone, pointerY, panel) {
    const siblings = [...zone.children].filter(element => element.matches?.('[data-panel]') && element !== panel.element && !element.hidden);
    const index = siblings.findIndex(element => pointerY < element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2);
    return index < 0 ? siblings.length : index;
  }

  showDockPreview(panel, dock, index) {
    const zone = this.zones.get(dock);
    if (!zone) return;
    if (this.previewZone === zone && this.previewIndex === index && this.placeholder.isConnected) return;
    this.clearDockPreview(false);
    this.previewZone = zone;
    this.previewIndex = index;
    zone.classList.add('is-dock-target');
    this.placeholder.style.height = `${panel.state.collapsed ? this.headerHeight(panel) : Math.min(panel.state.height, 150)}px`;
    const siblings = [...zone.children].filter(element => element.matches?.('[data-panel]') && element !== panel.element);
    zone.insertBefore(this.placeholder, siblings[index] || null);
  }

  clearDockPreview(reset = true) {
    this.previewZone?.classList.remove('is-dock-target');
    this.placeholder.remove();
    if (reset) {
      this.previewZone = null;
      this.previewIndex = -1;
    }
  }

  startResize(event, panel, edge) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const rect = panel.element.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, rect, state: { ...panel.state } };
    this.onInteraction(true);
    handle.classList.add('active');

    const move = moveEvent => {
      const dx = moveEvent.clientX - start.x, dy = moveEvent.clientY - start.y;
      if (panel.state.dock === 'floating') {
        if (edge === 'left') {
          panel.state.width = Math.max(MIN_WIDTH, start.rect.width - dx);
          panel.state.x = start.rect.right - panel.state.width;
        } else if (edge === 'right') panel.state.width = Math.max(MIN_WIDTH, start.rect.width + dx);
        if (edge === 'top') {
          panel.state.height = Math.max(MIN_HEIGHT, start.rect.height - dy);
          panel.state.y = start.rect.bottom - panel.state.height;
        } else if (edge === 'bottom') panel.state.height = Math.max(MIN_HEIGHT, start.rect.height + dy);
      } else if (panel.state.dock === 'left' && edge === 'right') {
        this.setZoneWidth('left', start.state.width + dx);
      } else if (panel.state.dock === 'right' && edge === 'left') {
        this.setZoneWidth('right', start.state.width - dx);
      } else if (panel.state.dock === 'bottom' && edge === 'top') {
        panel.state.height = clamp(start.state.height - dy, MIN_HEIGHT, 480);
      } else if ((panel.state.dock === 'left' || panel.state.dock === 'right') && edge === 'bottom') {
        panel.state.height = clamp(start.state.height + dy, MIN_HEIGHT, Math.max(MIN_HEIGHT, innerHeight - 120));
      }
      this.applyPanelState(panel);
      this.refreshZones();
      this.onLayoutChange();
    };
    const end = () => {
      handle.classList.remove('active');
      handle.releasePointerCapture?.(event.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      this.onInteraction(false);
      this.persist();
      this.onLayoutChange();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  refreshZones() {
    const visible = dock => this.zonePanels(dock).filter(panel => !panel.element.hidden);
    const left = visible('left'), right = visible('right'), bottom = visible('bottom');
    this.zones.get('left')?.classList.toggle('is-empty', !left.length);
    this.zones.get('right')?.classList.toggle('is-empty', !right.length);
    this.zones.get('bottom')?.classList.toggle('is-empty', !bottom.length);
    const sharedWidth = panels => panels[0]?.state.width || 0;
    const bottomHeight = bottom.length
      ? Math.min(480, bottom.reduce((sum, panel) => sum + (panel.state.collapsed ? this.headerHeight(panel) : panel.state.height), 0))
      : 0;
    document.documentElement.style.setProperty('--left-panel-width', `${sharedWidth(left)}px`);
    document.documentElement.style.setProperty('--right-panel-width', `${sharedWidth(right)}px`);
    document.documentElement.style.setProperty('--bottom-panel-height', `${bottomHeight}px`);
  }

  clampFloatingPanels() {
    for (const panel of this.panels.values()) {
      if (panel.state.dock !== 'floating') continue;
      panel.state.x = clamp(panel.state.x, 0, Math.max(0, innerWidth - panel.state.width));
      panel.state.y = clamp(panel.state.y, 38, Math.max(38, innerHeight - this.headerHeight(panel)));
      this.applyPanelState(panel);
    }
  }

  persist() {
    const layout = Object.fromEntries([...this.panels].map(([id, panel]) => [id, panel.serialize()]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }
}

function readSavedLayout() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { localStorage.removeItem(STORAGE_KEY); return {}; }
}

function normalizeState(state, defaults) {
  return {
    dock: DOCKS.has(state.dock) ? state.dock : defaults.dock,
    order: finite(state.order, defaults.order),
    x: finite(state.x, defaults.x),
    y: finite(state.y, defaults.y),
    width: Math.max(MIN_WIDTH, finite(state.width, defaults.width)),
    height: Math.max(MIN_HEIGHT, finite(state.height, defaults.height)),
    collapsed: Boolean(state.collapsed)
  };
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
