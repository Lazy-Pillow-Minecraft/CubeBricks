const DOCKS = new Set(['left', 'right', 'bottom', 'floating']);
const STORAGE_KEY = 'cubebricks.dock-layout.v1';
const ZONE_STORAGE_KEY = 'cubebricks.dock-zones.v1';
const MIN_WIDTH = 180;
const MIN_HEIGHT = 90;
const OPEN_ICON_MARKUP = '<svg class="open-icon" aria-hidden="true"><use href="#icon-open"></use></svg>';

export class DockPanelObject {
  constructor(definition, element, savedState = {}) {
    this.id = definition.id;
    this.index = definition.index;
    this.modes = Object.freeze([...(definition.modes || [])]);
    this.hotspotFocus = Boolean(definition.hotspotFocus);
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
    if (this.hotspotFocus) element.dataset.hotspotFocus = 'true';
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
    this.zoneState = { left: false, right: false, bottom: false, ...readSavedZones() };
    this.panels = new Map();
    this.mode = 'edit';
    this.previewZone = null;
    this.previewIndex = -1;
    this.previewStackTarget = null;
    this.placeholder = document.createElement('div');
    this.placeholder.className = 'dock-drop-placeholder';
    this.placeholder.hidden = true;
    document.body.append(this.placeholder);
    const saved = readSavedLayout();

    for (const [dock, zone] of this.zones) this.installZoneControl(dock, zone);

    definitions.forEach(definition => {
      const element = root.querySelector(`[data-panel="${definition.id}"]`);
      if (!element) return;
      const panel = new DockPanelObject(definition, element, saved[definition.id]);
      this.panels.set(panel.id, panel);
      this.installPanelControls(panel);
    });

    // New panels join the receiving panel's saved position and tab group.
    for (const definition of definitions) {
      if (!definition.defaultStackWith || saved[definition.id]) continue;
      const panel = this.get(definition.id), target = this.get(definition.defaultStackWith);
      if (!panel || !target) continue;
      const stackId = target.state.stackId || `dock-stack-${target.id}-default`;
      if (!target.state.stackId) {
        target.state.stackId = stackId;
        target.state.stackOrder = 0;
        target.state.stackActive = true;
      }
      panel.state.stackId = stackId;
      panel.state.stackOrder = Math.max(...this.stackMembers(stackId).map(member => member.state.stackOrder)) + 1;
      panel.state.stackActive = false;
      for (const key of ['dock', 'x', 'y', 'width', 'height', 'collapsed']) panel.state[key] = target.state[key];
    }

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
      hotspotFocus: panel.hotspotFocus,
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
    this.syncStacks();
    this.refreshZones();
    this.onLayoutChange();
  }

  expand(id) {
    const panel = this.get(id);
    if (!panel) return;
    if (panel.state.stackId) this.setStackActive(panel.state.stackId, panel.id);
    if (panel.state.dock !== 'floating' && this.zoneState[panel.state.dock]) this.setZoneCollapsed(panel.state.dock, false);
    if (panel.state.collapsed) this.setCollapsed(panel, false);
  }

  installZoneControl(dock, zone) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dock-zone-toggle open-icon-button';
    toggle.innerHTML = OPEN_ICON_MARKUP;
    toggle.dataset.dockZoneToggle = dock;
    toggle.setAttribute('aria-label', `折疊${dock === 'left' ? '左側' : dock === 'right' ? '右側' : '底部'}停靠區`);
    toggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.setZoneCollapsed(dock, !this.zoneState[dock]);
    });
    this.root.append(toggle);
    this.updateZoneControl(dock);
  }

  updateZoneControl(dock) {
    const zone = this.zones.get(dock);
    const toggle = this.root.querySelector(`[data-dock-zone-toggle="${dock}"]`);
    if (!zone || !toggle) return;
    const collapsed = Boolean(this.zoneState[dock]);
    zone.classList.toggle('is-zone-collapsed', collapsed);
    toggle.dataset.iconDirection = dock === 'left' ? (collapsed ? 'right' : 'left')
      : dock === 'right' ? (collapsed ? 'left' : 'right')
        : collapsed ? 'up' : 'down';
    toggle.title = collapsed ? '展開停靠區' : '折疊停靠區';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }

  setZoneCollapsed(dock, collapsed) {
    if (!this.zones.has(dock)) return;
    this.zoneState[dock] = Boolean(collapsed);
    this.updateZoneControl(dock);
    this.refreshZones();
    this.persist();
    this.onLayoutChange();
  }

  restoreLayout() {
    const docked = [...this.panels.values()].filter(panel => panel.state.dock !== 'floating')
      .sort((a, b) => a.state.dock.localeCompare(b.state.dock) || a.state.order - b.state.order
        || a.state.stackOrder - b.state.stackOrder || a.index - b.index);
    docked.forEach(panel => this.placeInZone(panel, panel.state.dock));
    [...this.panels.values()].filter(panel => panel.state.dock === 'floating').forEach(panel => this.placeFloating(panel));
    this.setMode(this.mode);
  }

  installPanelControls(panel) {
    panel.element.querySelectorAll('.panel-resizer').forEach(node => node.remove());
    for (const edge of ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      const handle = document.createElement('div');
      handle.className = `dock-resizer dock-resizer-${edge}`;
      handle.dataset.resizeEdge = edge;
      handle.addEventListener('pointerdown', event => this.startResize(event, panel, edge));
      panel.element.append(handle);
    }

    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'dock-collapse open-icon-button';
    collapse.innerHTML = OPEN_ICON_MARKUP;
    collapse.title = '折疊／展開';
    collapse.setAttribute('aria-label', '折疊或展開面板');
    collapse.addEventListener('click', event => {
      event.stopPropagation();
      this.setCollapsed(panel, !panel.state.collapsed);
    });
    const actionHost = panel.handle?.querySelector('.panel-heading-actions')
      || (panel.handle?.classList.contains('dock-tabs') ? panel.handle : panel.handle?.lastElementChild);
    actionHost?.append(collapse);

    const heading = panel.handle?.querySelector(':scope > strong');
    if (heading) new MutationObserver(() => {
      const title = heading.textContent.trim();
      for (const tab of document.querySelectorAll('.dock-stack-tab')) {
        if (tab.dataset.stackPanel === panel.id) tab.textContent = title;
      }
    }).observe(heading, { childList: true, characterData: true, subtree: true });

    panel.handle?.addEventListener('pointerdown', event => this.startDrag(event, panel));
    this.applyPanelState(panel);
  }

  setCollapsed(panel, collapsed) {
    panel.state.collapsed = collapsed;
    for (const member of this.stackMembers(panel.state.stackId, panel)) {
      member.state.collapsed = collapsed;
      this.applyPanelState(member);
    }
    this.refreshZones();
    this.persist();
    this.onLayoutChange();
  }

  applyPanelState(panel) {
    const { element, state } = panel;
    element.classList.toggle('detached', state.dock === 'floating');
    element.classList.toggle('is-collapsed', state.collapsed);
    const collapse = element.querySelector('.dock-collapse');
    if (collapse) {
      collapse.dataset.iconDirection = state.collapsed ? 'down' : 'up';
    }
    element.style.setProperty('--dock-panel-height', `${state.collapsed ? this.headerHeight(panel) : state.height}px`);
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
    const measured = panel.handle?.getBoundingClientRect().height || panel.handle?.scrollHeight || 0;
    const fallback = panel.handle?.classList.contains('dock-tabs') ? 34 : 52;
    return Math.max(fallback, Math.ceil(measured));
  }

  stackMembers(id, fallback = null) {
    if (!id) return fallback ? [fallback] : [];
    return [...this.panels.values()].filter(panel => panel.state.stackId === id)
      .sort((a, b) => a.state.stackOrder - b.state.stackOrder || a.index - b.index);
  }

  copyStackGeometry(source, members) {
    for (const member of members) {
      if (member === source) continue;
      for (const key of ['dock', 'x', 'y', 'width', 'height', 'collapsed']) member.state[key] = source.state[key];
      this.applyPanelState(member);
    }
  }

  syncStacks() {
    const groups = new Map();
    for (const panel of this.panels.values()) {
      if (!panel.state.stackId) continue;
      if (!groups.has(panel.state.stackId)) groups.set(panel.state.stackId, []);
      groups.get(panel.state.stackId).push(panel);
    }
    for (const [id, members] of groups) {
      if (members.length > 1) continue;
      members[0].state.stackId = null;
      members[0].state.stackActive = false;
      groups.delete(id);
    }
    for (const [id] of groups) {
      const members = this.stackMembers(id);
      const available = members.filter(panel => panel.modes.includes(this.mode));
      const active = available.find(panel => panel.state.stackActive) || available[0];
      for (const panel of members) {
        panel.state.stackActive = panel === active;
        panel.element.classList.toggle('is-stack-inactive', panel !== active);
        panel.element.classList.add('is-stacked');
        let tabs = panel.handle?.querySelector('.dock-stack-tabs');
        if (!tabs && panel.handle) {
          tabs = document.createElement('div');
          tabs.className = 'dock-stack-tabs';
          tabs.setAttribute('role', 'tablist');
          panel.handle.insertBefore(tabs, panel.handle.querySelector('.panel-heading-actions'));
        }
        if (!tabs) continue;
        tabs.replaceChildren();
        for (const [index, member] of available.entries()) {
          if (index) {
            const divider = document.createElement('span');
            divider.className = 'dock-stack-divider';
            divider.textContent = '|';
            divider.setAttribute('aria-hidden', 'true');
            tabs.append(divider);
          }
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'dock-stack-tab';
          button.textContent = member.handle?.querySelector('strong')?.textContent?.trim() || member.id;
          button.title = '拖動可拆開';
          button.dataset.stackPanel = member.id;
          button.setAttribute('role', 'tab');
          button.setAttribute('aria-selected', String(member === active));
          button.addEventListener('click', event => {
            event.stopPropagation();
            if (member.state.stackId === id) this.setStackActive(id, member.id);
          });
          button.addEventListener('pointerdown', event => {
            event.stopPropagation();
            this.startDrag(event, member, panel.element.getBoundingClientRect(), true);
          });
          tabs.append(button);
        }
      }
    }
    for (const panel of this.panels.values()) {
      if (panel.state.stackId) continue;
      panel.element.classList.remove('is-stacked', 'is-stack-inactive');
      panel.handle?.querySelector('.dock-stack-tabs')?.remove();
    }
  }

  setStackActive(id, panelId) {
    const members = this.stackMembers(id);
    const next = members.find(panel => panel.id === panelId && panel.modes.includes(this.mode));
    if (!next) return;
    const current = members.find(panel => panel.state.stackActive);
    if (current) this.copyStackGeometry(current, members);
    for (const panel of members) panel.state.stackActive = panel === next;
    this.syncStacks();
    this.refreshZones();
    this.persist();
    this.onLayoutChange();
  }

  leaveStack(panel) {
    const id = panel.state.stackId;
    if (!id) return;
    const members = this.stackMembers(id);
    if (panel.state.stackActive) this.copyStackGeometry(panel, members);
    panel.state.stackId = null;
    panel.state.stackOrder = 0;
    panel.state.stackActive = false;
    const remaining = members.filter(member => member !== panel);
    remaining.forEach((member, index) => { member.state.stackOrder = index; });
    if (remaining.length) remaining[0].state.stackActive = true;
    this.syncStacks();
  }

  joinStack(panel, target, moving = [panel]) {
    if (moving.includes(target)) return;
    const id = target.state.stackId || `dock-stack-${crypto.randomUUID()}`;
    if (!target.state.stackId) {
      target.state.stackId = id;
      target.state.stackOrder = 0;
    }
    const members = this.stackMembers(id);
    let insertion = members.at(-1).element;
    moving.forEach((member, index) => {
      member.state.stackId = id;
      member.state.stackOrder = members.length + index;
      for (const key of ['dock', 'x', 'y', 'width', 'height', 'collapsed']) member.state[key] = target.state[key];
      insertion.after(member.element);
      insertion = member.element;
      this.applyPanelState(member);
    });
    for (const member of [...members, ...moving]) member.state.stackActive = member === panel;
    if (target.state.dock !== 'floating') this.renumberZone(target.state.dock);
    this.syncStacks();
    this.refreshZones();
  }

  placeInZone(panel, dock, index = null, { expandZone = false } = {}) {
    const zone = this.zones.get(dock);
    if (!zone) return;
    if (expandZone) {
      this.zoneState[dock] = false;
      this.updateZoneControl(dock);
    }
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
      if (!panel.state.collapsed) panel.state.height = Math.max(MIN_HEIGHT, rect.height);
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

  startDrag(event, panel, rectOverride = null, fromTab = false) {
    if (event.button !== 0 || (!fromTab && event.target.closest('button,input,select'))) return;
    event.preventDefault();
    const rect = rectOverride || panel.element.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, rect, dock: panel.state.dock };
    const moving = !fromTab && panel.state.stackId ? this.stackMembers(panel.state.stackId) : [panel];
    let active = false;

    const move = moveEvent => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (!active && Math.hypot(dx, dy) < 5) return;
      if (!active) {
        active = true;
        this.onInteraction(true);
        if (fromTab) this.leaveStack(panel);
        else if (moving.length > 1) this.copyStackGeometry(panel, moving);
        for (const member of moving) {
          member.element.classList.add('is-dragging');
          this.placeFloating(member, rect);
        }
        this.onLayoutChange();
      }
      for (const member of moving) {
        member.state.x = clamp(start.rect.left + dx, 0, Math.max(0, innerWidth - member.state.width));
        member.state.y = clamp(start.rect.top + dy, 38, Math.max(38, innerHeight - this.headerHeight(member)));
        member.element.style.left = `${member.state.x}px`;
        member.element.style.top = `${member.state.y}px`;
      }
      const candidate = this.findDockCandidate(moveEvent.clientX, moveEvent.clientY, moving);
      candidate ? this.showDockPreview(candidate) : this.clearDockPreview();
    };

    const end = endEvent => {
      if (endEvent.pointerId !== event.pointerId) return;
      if (active && endEvent.type === 'pointerup') {
        if (this.previewStackTarget) this.joinStack(panel, this.previewStackTarget, moving);
        else if (this.previewZone) moving.forEach((member, index) =>
          this.placeInZone(member, this.previewZone.dataset.dockZone, this.previewIndex + index, { expandZone: true }));
      }
      this.clearDockPreview();
      for (const member of moving) member.element.classList.remove('is-dragging');
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

  findDockCandidate(x, y, moving) {
    for (const element of document.elementsFromPoint(x, y)) {
      const targetElement = element.closest?.('.panel-drag-handle')?.closest('[data-panel]');
      if (!targetElement || moving.some(panel => panel.element === targetElement) || targetElement.hidden
        || targetElement.classList.contains('is-stack-inactive')) continue;
      const target = this.get(targetElement.dataset.panel);
      if (target) return { kind: 'stack', target };
    }
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
      if (distance <= thresholds[dock]) {
        const { index, lineY } = this.dropIndex(zone, y, moving);
        candidates.push({ kind: 'zone', dock, distance, index, lineY });
      }
    }
    return candidates.sort((a, b) => a.distance / thresholds[a.dock] - b.distance / thresholds[b.dock])[0] || null;
  }

  dropIndex(zone, pointerY, moving) {
    const siblings = [...zone.children].filter(element => element.matches?.('[data-panel]')
      && !moving.some(panel => panel.element === element));
    const visible = siblings.filter(element => !element.hidden && !element.classList.contains('is-stack-inactive'));
    const before = visible.find(element => pointerY < element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2);
    if (before) {
      const groupId = this.get(before.dataset.panel)?.state.stackId;
      const first = groupId ? siblings.find(element => this.get(element.dataset.panel)?.state.stackId === groupId) : before;
      return { index: siblings.indexOf(first), lineY: before.getBoundingClientRect().top };
    }
    return { index: siblings.length, lineY: visible.at(-1)?.getBoundingClientRect().bottom || zone.getBoundingClientRect().top + 12 };
  }

  showDockPreview(candidate) {
    this.clearDockPreview();
    let left, top, width, height = 3;
    if (candidate.kind === 'stack') {
      this.previewStackTarget = candidate.target;
      const handle = candidate.target.handle;
      const rect = handle.getBoundingClientRect();
      const tabs = [...handle.querySelectorAll('.dock-stack-tab')];
      const title = tabs.at(-1) || handle.querySelector(':scope > strong');
      const titleRight = title?.getBoundingClientRect().right || rect.left + 12;
      const actionsLeft = handle.querySelector('.panel-heading-actions')?.getBoundingClientRect().left || rect.right;
      left = Math.max(rect.left + 12, Math.min(titleRight + 6, actionsLeft - 10));
      height = Math.min(24, Math.max(16, rect.height - 16));
      top = rect.top + (rect.height - height) / 2;
      width = 3;
      this.placeholder.classList.add('is-stack-preview');
    } else {
      const zone = this.zones.get(candidate.dock);
      if (!zone) return;
      this.previewZone = zone;
      this.previewIndex = candidate.index;
      const rect = zone.getBoundingClientRect();
      const workspace = this.root.getBoundingClientRect();
      const empty = rect.width < 24;
      left = empty ? candidate.dock === 'right' ? workspace.right - 84 : workspace.left + 8 : rect.left + 8;
      width = empty ? 76 : Math.max(48, rect.width - 16);
      top = Math.min(candidate.lineY, workspace.bottom - 12);
    }
    this.placeholder.style.left = `${left}px`;
    this.placeholder.style.top = `${top}px`;
    this.placeholder.style.width = `${width}px`;
    this.placeholder.style.height = `${height}px`;
    this.placeholder.hidden = false;
  }

  clearDockPreview() {
    this.placeholder.hidden = true;
    this.placeholder.classList.remove('is-stack-preview');
    this.previewZone = null;
    this.previewIndex = -1;
    this.previewStackTarget = null;
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
        if (edge.includes('left')) {
          panel.state.width = clamp(start.rect.width - dx, MIN_WIDTH, start.rect.right);
          panel.state.x = start.rect.right - panel.state.width;
        } else if (edge.includes('right')) {
          panel.state.width = clamp(start.rect.width + dx, MIN_WIDTH, innerWidth - start.rect.left);
        }
        if (edge.includes('top')) {
          panel.state.height = clamp(start.rect.height - dy, MIN_HEIGHT, start.rect.bottom - 38);
          panel.state.y = start.rect.bottom - panel.state.height;
        } else if (edge.includes('bottom')) {
          panel.state.height = clamp(start.rect.height + dy, MIN_HEIGHT, innerHeight - start.rect.top);
        }
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
      if (panel.state.stackId) this.copyStackGeometry(panel, this.stackMembers(panel.state.stackId));
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
    const visible = dock => this.zonePanels(dock)
      .filter(panel => !panel.element.hidden && !panel.element.classList.contains('is-stack-inactive'));
    const left = visible('left'), right = visible('right'), bottom = visible('bottom');
    this.zones.get('left')?.classList.toggle('is-empty', !left.length);
    this.zones.get('right')?.classList.toggle('is-empty', !right.length);
    this.zones.get('bottom')?.classList.toggle('is-empty', !bottom.length);
    for (const dock of ['left', 'right', 'bottom']) {
      const panels = dock === 'left' ? left : dock === 'right' ? right : bottom;
      const toggle = this.root.querySelector(`[data-dock-zone-toggle="${dock}"]`);
      if (toggle) toggle.hidden = !panels.length;
      this.updateZoneControl(dock);
    }
    const sharedWidth = panels => panels[0]?.state.width || 0;
    const bottomHeight = bottom.length
      ? Math.min(480, bottom.reduce((sum, panel) => sum + (panel.state.collapsed ? this.headerHeight(panel) : panel.state.height), 0))
      : 0;
    document.documentElement.style.setProperty('--left-panel-width', `${left.length ? (this.zoneState.left ? 18 : sharedWidth(left)) : 0}px`);
    document.documentElement.style.setProperty('--right-panel-width', `${right.length ? (this.zoneState.right ? 18 : sharedWidth(right)) : 0}px`);
    document.documentElement.style.setProperty('--bottom-panel-height', `${bottom.length ? (this.zoneState.bottom ? 18 : bottomHeight) : 0}px`);
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
    localStorage.setItem(ZONE_STORAGE_KEY, JSON.stringify(this.zoneState));
  }
}

function readSavedLayout() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { localStorage.removeItem(STORAGE_KEY); return {}; }
}

function readSavedZones() {
  try {
    const saved = JSON.parse(localStorage.getItem(ZONE_STORAGE_KEY) || '{}');
    return Object.fromEntries(['left', 'right', 'bottom'].map(dock => [dock, Boolean(saved[dock])]));
  } catch {
    localStorage.removeItem(ZONE_STORAGE_KEY);
    return {};
  }
}

function normalizeState(state, defaults) {
  return {
    dock: DOCKS.has(state.dock) ? state.dock : defaults.dock,
    order: finite(state.order, defaults.order),
    x: finite(state.x, defaults.x),
    y: finite(state.y, defaults.y),
    width: Math.max(MIN_WIDTH, finite(state.width, defaults.width)),
    height: Math.max(MIN_HEIGHT, finite(state.height, defaults.height)),
    collapsed: Boolean(state.collapsed),
    stackId: typeof state.stackId === 'string' && state.stackId.startsWith('dock-stack-') ? state.stackId : null,
    stackOrder: finite(state.stackOrder, 0),
    stackActive: Boolean(state.stackActive)
  };
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
