import assert from 'node:assert/strict';
import test from 'node:test';
import { DockManager, DockPanelObject } from '../src/screen/dock-manager.js';
import { DockLayoutStorage } from '../src/screen/docks/layout-storage.js';

const LAYOUT_KEY = 'cubebricks.dock-layout.v1';
const ZONES_KEY = 'cubebricks.dock-zones.v1';
const TIME_KEY = 'cubebricks.dock-layout-updated.v1';
const clone = value => structuredClone(value);
function memoryStorage(values = {}) {
  const entries = new Map(Object.entries(values));
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

// Reparent nodes just as the browser does; restoration must not depend on the
// initial HTML order or on panels that have not yet moved to their saved zone.
class Element {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.children = [];
    this.clientHeight = 900;
    this.hidden = false;
    const classes = new Set(), styles = new Map();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    };
    this.style = { setProperty: (key, value) => styles.set(key, value) };
  }
  append(element) {
    if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1);
    element.parent = this;
    this.children.push(element);
  }
  querySelector() { return null; }
  matches(selector) { return selector === '[data-panel]' && Boolean(this.dataset.panel); }
}

function harness(saved = {}, { definitions, storage, mode = 'edit' } = {}) {
  globalThis.document = { body: new Element(), documentElement: new Element() };
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  definitions ||= ['a', 'b', 'c', 'd'].map((id, index) => ({
    id, index, modes: ['edit', 'paint'], defaultDock: index < 2 ? 'left' : 'right',
    defaultOrder: index % 2, defaultSize: { width: index < 2 ? 240 : 300, height: 200 }
  }));
  const manager = Object.assign(Object.create(DockManager.prototype), {
    root: new Element(), definitions, mode, heightSnapping: false,
    zoneState: { left: false, right: false, bottom: false },
    zones: new Map(['left', 'right', 'bottom'].map(dock => [dock, new Element()])),
    panels: new Map(), layoutRevision: 0, onLayoutChange() {}, onStorageError(error) { throw error; },
    layoutStorage: storage || new DockLayoutStorage({ storage: memoryStorage(), desktop: null })
  });
  for (const definition of definitions) {
    const panel = new DockPanelObject(definition, new Element({ panel: definition.id }), saved[definition.id]);
    manager.panels.set(panel.id, panel);
    manager.zones.get(definition.defaultDock).append(panel.element);
  }
  manager.addDefaultStacks(saved);
  manager.restoreLayout();
  return manager;
}

function permutations(values) {
  return values.length ? values.flatMap((value, i) => permutations(values.filter((_, j) => i !== j)).map(rest => [value, ...rest])) : [[]];
}
const order = (manager, dock) => manager.zonePanels(dock).map(panel => panel.id);

test('every four-panel permutation restores without changing saved order or side widths', () => {
  for (const ids of permutations(['a', 'b', 'c', 'd'])) {
    const saved = Object.fromEntries(ids.map((id, i) => [id, { dock: 'right', order: i, width: 416 }]));
    const manager = harness(saved);
    assert.deepEqual(order(manager, 'right'), ids);
    assert.deepEqual(order(manager, 'left'), []);
    assert.ok([...manager.panels.values()].every(panel => panel.state.width === 416));
    manager.restoreLayout();
    assert.deepEqual(order(manager, 'right'), ids, 'a second restoration is stable');
  }
  const manager = harness({
    a: { dock: 'right', order: 1, width: 430 }, b: { dock: 'left', order: 1, width: 360 },
    c: { dock: 'left', order: 0, width: 360 }, d: { dock: 'right', order: 0, width: 430 }
  });
  assert.deepEqual(order(manager, 'left'), ['c', 'b']);
  assert.deepEqual(order(manager, 'right'), ['d', 'a']);
  assert.deepEqual([...manager.panels.values()].map(panel => panel.state.width), [430, 360, 360, 430]);
});

test('desktop reload preserves stacks, active tabs, dimensions, floating placement and collapsed zones', async () => {
  const browser = memoryStorage();
  let file = null;
  const desktop = { loadDockLayout: async () => clone(file), saveDockLayout: async value => { file = clone(value); } };
  const manager = harness({
    a: { dock: 'right', order: 0, width: 410, height: 312, collapsed: true, stackId: 'dock-stack-test', stackOrder: 1, stackActive: true },
    b: { dock: 'left', order: 9, stackId: 'dock-stack-test', stackOrder: 0 },
    c: { dock: 'floating', x: 600, y: 150, width: 450, height: 380 },
    d: { dock: 'bottom', height: 165 }
  }, { storage: new DockLayoutStorage({ storage: browser, desktop }) });
  manager.zoneState = { left: true, right: false, bottom: true };
  await manager.persist();
  // Simulate an application restart with an empty renderer cache.
  const reopened = harness({}, { storage: new DockLayoutStorage({ storage: memoryStorage(), desktop }) });
  await reopened.restoreStoredLayout();
  assert.deepEqual(order(reopened, 'right'), ['b', 'a']);
  assert.deepEqual(order(reopened, 'bottom'), ['d']);
  assert.deepEqual(reopened.zoneState, manager.zoneState);
  for (const id of ['a', 'b', 'c', 'd']) assert.deepEqual(reopened.get(id).state, manager.get(id).state);
  assert.equal(reopened.get('a').state.stackActive, true);
  assert.equal(reopened.get('b').element.classList.contains('is-stack-inactive'), true);
});

test('legacy layouts migrate and newer browser layouts win over an older desktop backup', async () => {
  let file = null;
  const desktop = { loadDockLayout: async () => clone(file), saveDockLayout: async value => { file = clone(value); } };
  const browser = memoryStorage({ [LAYOUT_KEY]: JSON.stringify({ a: { dock: 'bottom', order: 4, height: 172 } }), [ZONES_KEY]: '{"left":true}' });
  const storage = new DockLayoutStorage({ storage: browser, desktop });
  const manager = harness(storage.initial.layout, { storage });
  await manager.restoreStoredLayout();
  assert.equal(file.layout.a.dock, 'bottom');
  assert.equal(file.zones.left, true);
  assert.ok(file.updatedAt > 0);
  browser.setItem(LAYOUT_KEY, JSON.stringify({ a: { dock: 'floating', x: 234 } }));
  browser.setItem(TIME_KEY, String(file.updatedAt + 100));
  const nextStorage = new DockLayoutStorage({ storage: browser, desktop });
  const next = harness(nextStorage.initial.layout, { storage: nextStorage });
  await next.restoreStoredLayout();
  assert.equal(file.layout.a.x, 234);
  assert.equal(file.layout.a.dock, 'floating');
});

test('storage failure falls back to the desktop file and browser-only failures are reported', async () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  let file;
  const storage = new DockLayoutStorage({ storage: blocked, desktop: { saveDockLayout: async value => { file = clone(value); } } });
  await harness({}, { storage }).persist();
  assert.equal(file.layout.a.dock, 'left');
  await assert.rejects(new DockLayoutStorage({ storage: blocked, desktop: null }).save({}, {}), /blocked/);
  await assert.rejects(new DockLayoutStorage({ storage: null, desktop: null }).save({}, {}), /unavailable/);
});

test('a late startup read cannot overwrite an intervening user layout change', async () => {
  let finishRead;
  const desktop = { loadDockLayout: () => new Promise(resolve => { finishRead = resolve; }), saveDockLayout: async () => {} };
  const manager = harness({}, { storage: new DockLayoutStorage({ storage: memoryStorage(), desktop }) });
  const restore = manager.restoreStoredLayout();
  manager.get('a').state.height = 333;
  await manager.persist();
  finishRead({ version: 1, layout: { a: { dock: 'right', height: 100 } }, zones: {}, updatedAt: 1 });
  await restore;
  assert.equal(manager.get('a').state.height, 333);
  assert.equal(manager.get('a').state.dock, 'left');
});

test('mode fallback keeps the saved active tab and new default-stacked panels follow their host', () => {
  const definitions = [
    { id: 'host', index: 1, modes: ['edit', 'paint'], defaultDock: 'right', defaultOrder: 0 },
    { id: 'other', index: 2, modes: ['edit', 'paint'], defaultDock: 'right', defaultOrder: 1 },
    { id: 'paint', index: 3, modes: ['paint'], defaultDock: 'right', defaultOrder: 0, defaultStackWith: 'host' }
  ];
  const manager = harness({ host: { dock: 'left', order: 5, width: 390 }, other: { dock: 'left', order: 1, width: 390 } }, { definitions });
  assert.deepEqual(order(manager, 'left'), ['other', 'host', 'paint']);
  manager.setMode('paint');
  manager.setStackActive(manager.get('host').state.stackId, 'paint');
  manager.setMode('edit');
  assert.equal(manager.get('paint').state.stackActive, true);
  assert.equal(manager.get('host').element.classList.contains('is-stack-inactive'), false);
  manager.setMode('paint');
  assert.equal(manager.get('paint').element.classList.contains('is-stack-inactive'), false);
});
