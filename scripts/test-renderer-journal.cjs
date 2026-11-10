const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const journalSource = fs.readFileSync(path.join(__dirname, '../src/project/journal-controller.js'), 'utf8');
const fileSource = fs.readFileSync(path.join(__dirname, '../src/project/file-controller.js'), 'utf8');
const faceDropSource = fs.readFileSync(path.join(__dirname, '../src/texture/face-drop-controller.js'), 'utf8');

function install(context, names) {
  context.CustomEvent ||= CustomEvent;
  if(context.window)context.window.dispatchEvent ||= ()=>{};
  for (const name of names) {
    const expression = new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`);
    const match = journalSource.match(expression) || fileSource.match(expression)
      || faceDropSource.match(expression) || source.match(expression);
    assert.ok(match, `missing function ${name}`);
    vm.runInContext(match[0], context);
  }
}

function setup() {
  class Project {
    constructor(data) { Object.assign(this, data); }
    getNode(uid) { return this.elements.find(node => node.uid === uid); }
  }
  const session = number => ({ project: new Project({ elements: [{ uid: 'cube', position: [number, 0, 0] }] }),
    selectedUids: new Set(['cube']), selectedUid: 'cube', textureAssets: [], textureGroups: [], selectedCurveNodeIndex: null });
  const tabs = ['a', 'b'].map((id, index) => ({ id, journalId: id, session: session(index + 10) }));
  const state = { ...tabs[0].session };
  let finish;
  const context = vm.createContext({
    structuredClone, Set, Map, Promise, JSON,
    pendingPaintCommit: () => null,
    finishActivePaintGesture() {},
    performanceMonitor: { enabled: false, record() {} },
    state, projectTabs: tabs, activeProjectTabId: 'a', suppressJournalRecording: false,
    subdivisionSession: null, PROJECT_SESSION_KEYS: Object.keys(state), CubeBricksProject: Project,
    isBezierElement: () => false, textureUid: asset => asset.uuid,
    normalizeTextureLayers: asset => structuredClone(asset.layers || []),
    releaseTextureRasters() {},
    projectTabById: id => tabs.find(tab => tab.id === id),
    flushProjectJournal: async () => {},
    syncActiveProjectTab() { tabs.find(tab => tab.id === context.activeProjectTabId).session = { ...state }; },
    toast() {}, renderProjectTabs() {}, restoreProjectTextureView() {}, renderAll() {}, scheduleProjectJournal() {},
    clearSubdivisionSession() { context.subdivisionSession = null; },
    markDirty(value, options) { assert.equal(options.constrain, false); },
    window: { cubeBricksDesktop: {
      projectJournalState: async () => ({ activeHead: 10 }),
      checkoutProjectJournal: payload => payload.sequence
        ? Promise.resolve(result(payload.sequence))
        : new Promise(resolve => { finish = resolve; })
    } }
  });
  context.projectTabsController = {
    tabs,
    get activeId() { return context.activeProjectTabId; }
  };
  context.RecentModelHistory = class { reset() {} };
  install(context, ['restoredProjectSession', 'applyJournalModel', 'navigateProjectJournal', 'serializeCbmodel']);
  return { context, tabs, state, finish: result => finish(result) };
}

const turn = () => new Promise(resolve => setImmediate(resolve));
test('browser layer undo and redo preserve frame links alongside the layer identity graph', () => {
  const asset = { _uid: 'texture', source: 'new-pixels', layers: [{ uid: 'new-layer', source: 'new-pixels' }],
    activeLayerUid: 'new-layer', animation: { enabled: true, frames: [{ uid: 'frame', layerUids: ['new-layer'], paintLayerUid: 'new-layer' }] } };
  const state = { textureAssets: [asset] };
  const context = vm.createContext({ structuredClone, Object, state, textureCanvas: { width: 4, height: 4 },
    renderTextureList() {}, activateProjectTexture() {}, rebuildTextureAtlas() {}, markDirty() {} });
  install(context, ['restoreTexturePaintHistory']);
  const undo = [{ uid: 'texture', source: 'old-pixels', layers: [{ uid: 'old-layer', source: 'old-pixels' }],
    activeLayerUid: 'old-layer', width: 4, height: 4,
    animation: { enabled: true, frames: [{ uid: 'frame', layerUids: ['old-layer'], paintLayerUid: 'old-layer' }] } }];
  const redo = [];
  assert.equal(context.restoreTexturePaintHistory(undo, redo), true);
  assert.deepEqual(asset.animation.frames[0].layerUids, ['old-layer']);
  assert.equal(asset.animation.frames[0].paintLayerUid, asset.activeLayerUid);
  assert.equal(context.restoreTexturePaintHistory(redo, undo), true);
  assert.deepEqual(asset.animation.frames[0].layerUids, ['new-layer']);
  assert.equal(asset.animation.frames[0].paintLayerUid, asset.activeLayerUid);
});
const result = number => ({ sequence: number, content: JSON.stringify({ elements: [{ uid: 'cube', position: [number, 0, 0] }],
  textures: [], textureGroups: [{ uid: 'folder', name: 'Textures' }] }) });

test('asynchronous undo updates its original tab, never a newly active tab', async () => {
  const { context, tabs, state, finish } = setup();
  const pending = context.navigateProjectJournal('undo');
  await turn();
  context.activeProjectTabId = 'b';
  Object.assign(state, tabs[1].session);
  finish(result(5));
  await pending;
  assert.equal(state.project.elements[0].position[0], 11);
  assert.equal(tabs[0].session.project.elements[0].position[0], 5);
  assert.equal(tabs[0].session.selectedUid, 'cube');
  assert.equal(tabs[0].session.textureGroups[0].uid, 'folder');
});

test('undo keeps the existing atlas visible until replacement textures load', async () => {
  const { context, finish } = setup();
  let options;
  context.restoreProjectTextureView = value => { options = value; };
  const pending = context.navigateProjectJournal('undo');
  await turn();
  finish(result(5));
  await pending;
  assert.equal(options?.preserveAtlas, true);
});

test('geometry-only undo keeps the existing texture assets and atlas', async () => {
  const { context, tabs, finish } = setup();
  const assets = [{ _uid: 'texture_a', source: 'unchanged' }];
  tabs[0].session.textureAssets = assets;
  context.state.textureAssets = assets;
  context.restoreProjectTextureView = () => { throw new Error('unexpected atlas rebuild'); };
  const pending = context.navigateProjectJournal('undo');
  await turn();
  finish({ ...result(5), textureChanged: false });
  await pending;
  assert.equal(context.state.textureAssets, assets);
  assert.equal(context.state.project.elements[0].position[0], 5);
});

test('undo restores model state while preserving the current project history-limit setting',async()=>{
  const {context,state,finish}=setup();
  state.project.historyLimit=300;
  const pending=context.navigateProjectJournal('undo');await turn();
  const previous=result(5),data=JSON.parse(previous.content);data.historyLimit=10;
  finish({...previous,content:JSON.stringify(data)});await pending;
  assert.equal(state.project.historyLimit,300);
  assert.equal(state.project.elements[0].position[0],5);
});

test('rapid undo requests execute in order', async () => {
  const { context, state } = setup();
  let running = 0, maximum = 0, head = 10;
  context.window.cubeBricksDesktop.checkoutProjectJournal = async () => {
    running++; maximum = Math.max(maximum, running);
    await turn();
    running--;
    return result(--head);
  };
  await Promise.all([context.navigateProjectJournal('undo'), context.navigateProjectJournal('undo')]);
  assert.equal(maximum, 1);
  assert.equal(state.project.elements[0].position[0], 8);
});

test('desktop paint mode uses the same ordered undo and redo as model edits', async () => {
  const directions = [];
  const context = vm.createContext({
    state: { mode: 'paint', paintHistory: [{ uid: 'texture_a' }], paintFuture: [{ uid: 'texture_a' }] },
    window: { cubeBricksDesktop: { checkoutProjectJournal() {} } },
    finishActivePaintGesture() {},
    navigateProjectJournal: async direction => { directions.push(direction); return true; },
    restoreTexturePaintHistory: () => { throw new Error('paint-only history must not run on desktop'); }
  });
  install(context, ['undo', 'redo']);
  await context.undo();
  await context.redo();
  assert.deepEqual(directions, ['undo', 'redo']);
});

test('desktop snapshots do not clone a second full model history', () => {
  const tab = { id: 'project_a', journalPending: null };
  const context = vm.createContext({
    state: { project: {}, history: [], future: [] },
    window: { cubeBricksDesktop: { checkoutProjectJournal() {} } },
    projectTabsController: { activeId: tab.id },
    projectTabById: () => tab,
    requireOperation: id => id,
    compactProjectHistorySnapshot: () => { throw new Error('unexpected full model clone'); }
  });
  install(context, ['snapshot']);
  context.snapshot('core.element.move');
  assert.equal(tab.journalPending, 'core.element.move');
  assert.equal(context.state.history.length, 0);
});

test('same-tool paint gestures flush independently while a multi-face gesture stays atomic', () => {
  const tab = { id: 'project_a', journalPending: null };
  const flushed = [];
  const context = vm.createContext({
    state: {}, projectTabsController: { activeId: tab.id }, projectTabById: () => tab,
    requireOperation: id => id, scheduleProjectJournal() {},
    flushProjectJournal(current) { flushed.push(current.journalPendingGroup); current.journalPending = null; }
  });
  install(context, ['noteJournalOperation']);
  context.noteJournalOperation('core.texture.brush', 'first');
  context.noteJournalOperation('core.texture.brush', 'first');
  assert.deepEqual(flushed, []);
  context.noteJournalOperation('core.texture.brush', 'second');
  assert.deepEqual(flushed, ['first']);
  assert.equal(tab.journalPendingGroup, 'second');
});

test('new edit during checkout is not overwritten by its late result', async () => {
  const { context, tabs, state, finish } = setup();
  const pending = context.navigateProjectJournal('undo');
  await turn();
  state.project.elements[0].position[0] = 99;
  tabs[0].journalEditRevision = 1;
  finish(result(5));
  await pending;
  assert.equal(state.project.elements[0].position[0], 99);
  assert.equal(tabs[0].journalPending, 'core.element.property');
  assert.equal(tabs[0].journalHead, 10);
  assert.equal(tabs[0].journalWriteBlocked, false);
});

test('failed compensation blocks writes instead of committing a new edit on the undone branch', async () => {
  const { context, tabs, finish } = setup();
  const checkout = context.window.cubeBricksDesktop.checkoutProjectJournal;
  context.window.cubeBricksDesktop.checkoutProjectJournal = payload => payload.sequence
    ? Promise.reject(new Error('restore failed'))
    : checkout(payload);
  const pending = context.navigateProjectJournal('undo');
  await turn();
  tabs[0].journalEditRevision = 1;
  finish(result(5));
  await pending;
  assert.equal(tabs[0].journalWriteBlocked, true);
});

test('a failed renderer restore cannot silently accept edits on a moved journal head', async () => {
  const { context, tabs, finish } = setup();
  context.renderAll = () => { throw new Error('render failed'); };
  const pending = context.navigateProjectJournal('undo');
  await turn();
  finish(result(5));
  await pending;
  assert.equal(tabs[0].journalWriteBlocked, true);
});

test('recent model undo displays immediately while storage remains queued', async () => {
  const { context, tabs, state, finish } = setup();
  let releaseWrite;
  tabs[0].journalWrites = new Promise(resolve => { releaseWrite = resolve; });
  tabs[0].recentModelHistory = { navigate: () => ({ data: JSON.parse(result(5).content), changedUids: ['cube'], matches: () => true }), reset() {} };
  const pending = context.navigateProjectJournal('undo');
  assert.equal(state.project.elements[0].position[0], 5, 'visible model does not await the storage queue');
  releaseWrite(); await turn(); finish({ ...result(5), textureChanged: false }); await pending;
  assert.equal(tabs[0].journalHead, 5);
  assert.equal(tabs[0].journalPreviewCount, 0);
  assert.notEqual(tabs[0].journalWriteBlocked, true);
});

test('worker-prepared pixel undo displays while storage is blocked and preserves the model instance', async () => {
  const { context, tabs, state, finish } = setup();
  let releaseWrite, releasePixels;
  const project = state.project;
  tabs[0].journalWrites = new Promise(resolve => { releaseWrite = resolve; });
  const data = { ...JSON.parse(result(10).content), textures: [{ uuid: 'texture', source: 'old-pixels',
    layers: [{ uid: 'layer', source: 'old-pixels' }], active_layer_uid: 'layer' }] };
  tabs[0].recentModelHistory = { navigate: () => new Promise(resolve => { releasePixels = resolve; }), reset() {} };
  const pending = context.navigateProjectJournal('undo');
  releasePixels({ data, changedUids: [], textureChanged: true, modelChanged: false, geometryChanged: false, matches: async () => true });
  await turn();
  assert.equal(state.textureAssets[0].source, 'old-pixels', 'texture recovery does not await a queued commit');
  assert.equal(state.project, project, 'painting does not reconstruct geometry');
  releaseWrite(); await turn(); finish({ ...result(10), textureChanged: true }); await pending;
  assert.notEqual(tabs[0].journalWriteBlocked, true);
  assert.equal(tabs[0].journalPreviewCount, 0);
});

test('an edit made during pixel proof cancels the stale local undo before disk checkout', async () => {
  const { context, tabs, state } = setup();
  let releasePixels, calls = 0;
  context.window.cubeBricksDesktop.checkoutProjectJournal = async () => { calls++; return result(5); };
  tabs[0].recentModelHistory = { navigate: () => new Promise(resolve => { releasePixels = resolve; }), reset() {} };
  const pending = context.navigateProjectJournal('undo');
  state.project.elements[0].position[0] = 99; tabs[0].journalEditRevision = 1;
  releasePixels({ data: JSON.parse(result(5).content), changedUids: ['cube'], matches: () => true });
  await pending;
  assert.equal(calls, 0); assert.equal(state.project.elements[0].position[0], 99);
  assert.notEqual(tabs[0].journalWriteBlocked, true);
});

test('pruning an offscreen history branch invalidates cached edges even without replacing the model', async () => {
  const { context, tabs } = setup();
  let resets = 0;
  tabs[0].recentModelHistory = { reset() { resets++; } };
  context.window.cubeBricksDesktop.pruneProjectHistoryBranch = async () => ({ sequence: 10, content: null });
  await context.navigateProjectJournal(null, { prune: true, sequence: 11 });
  assert.equal(resets, 1);
  assert.equal(tabs[0].journalHead, 10);
});

test('edits after a recent undo preview remain on the target branch without compensation', async () => {
  const { context, tabs, state, finish } = setup();
  let restores = 0;
  const checkout = context.window.cubeBricksDesktop.checkoutProjectJournal;
  context.window.cubeBricksDesktop.checkoutProjectJournal = payload => { if (payload.sequence) restores++; return checkout(payload); };
  tabs[0].recentModelHistory = { navigate: () => ({ data: JSON.parse(result(5).content), changedUids: ['cube'], matches: () => true }), reset() {} };
  const pending = context.navigateProjectJournal('undo'); await turn();
  state.project.elements[0].position[0] = 99; tabs[0].journalEditRevision = 1; tabs[0].journalPending = 'core.element.move';
  finish({ ...result(5), textureChanged: false }); await pending;
  assert.equal(state.project.elements[0].position[0], 99);
  assert.equal(tabs[0].journalHead, 5);
  assert.equal(restores, 0, 'new edits were made against the previewed target, not the old head');
});

test('recent undo preserves selection changed since the last saved tab session', async () => {
  const { context, tabs, state, finish } = setup();
  tabs[0].session.selectedUid = null; tabs[0].session.selectedUids = new Set();
  state.selectedUid = 'cube'; state.selectedUids = new Set(['cube']);
  tabs[0].recentModelHistory = { navigate: () => ({ data: JSON.parse(result(5).content), changedUids: ['cube'], matches: () => true }), reset() {} };
  const pending = context.navigateProjectJournal('undo'); await turn();
  assert.equal(state.selectedUid, 'cube');
  assert.equal(state.selectedUids.has('cube'), true);
  finish({ ...result(5), textureChanged: false }); await pending;
});

test('preview mismatch blocks subsequent writes and preserves the visible work', async () => {
  const { context, tabs, state, finish } = setup();
  tabs[0].recentModelHistory = { navigate: () => ({ data: JSON.parse(result(5).content), changedUids: ['cube'], matches: () => false }), reset() {} };
  const pending = context.navigateProjectJournal('undo'); await turn();
  finish({ ...result(4), textureChanged: false }); await pending;
  assert.equal(state.project.elements[0].position[0], 5);
  assert.equal(tabs[0].journalWriteBlocked, true);
});

test('failed pending storage blocks a queued preview navigation', async () => {
  const { context, tabs, finish } = setup();
  let releaseWrite;
  tabs[0].journalWrites = new Promise(resolve => { releaseWrite = resolve; });
  tabs[0].recentModelHistory = { navigate: () => ({ data: JSON.parse(result(5).content), changedUids: ['cube'], matches: () => true }), reset() {} };
  const pending = context.navigateProjectJournal('undo');
  tabs[0].journalWriteBlocked = true; releaseWrite(); await pending;
  assert.equal(tabs[0].journalWriteBlocked, true);
  assert.equal(tabs[0].journalPreviewCount, 0);
});

test('dragging a texture onto multiple cube faces records one operation before mutations', () => {
  const cubes = [0, 1].map(index => ({ uid: `cube_${index}`, uvMode: 'per_face', autoUv: true,
    faces: { north: { uv: [1, 2, 5, 6], texture: 'old', enabled: false } } }));
  const records = [];
  const context = vm.createContext({
    CUBE_FACE_NAMES: ['north'], CULLED_FACE_TEXTURE_KEY: 'culledTexture', UV_FACE_LABELS: {},
    uvPreviewController: { uvPreviewProjectCache: {} },
    uvEditorController: { textureUvEntryCache: {} },
    textureDropCubes: () => cubes, faceTextureReference: () => 'new',
    snapshot(id) { records.push({ id, before: structuredClone(cubes) }); },
    ensureCubeFaceRecord: (cube, name) => cube.faces[name], persistGeneratedPaintCube() {}, markDirty() {},
    invalidateAllRenderGeometry() {}, renderTextureList() {}, renderOutliner() {}, renderInspector() {}, renderScene() {},
    updateTextureStageTransform() {}, toast() {}
  });
  install(context, ['applyTextureAssetToFace']);
  assert.equal(context.applyTextureAssetToFace({ uuid: 'new' }, { faceName: 'north' }), true);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'core.texture.assign');
  for (let index = 0; index < 2; index++) {
    assert.equal(records[0].before[index].faces.north.texture, 'old');
    assert.equal(records[0].before[index].autoUv, true);
    assert.equal(cubes[index].faces.north.texture, 'new');
    assert.equal(cubes[index].autoUv, false);
    assert.deepEqual(cubes[index].faces.north.uv, [1, 2, 5, 6]);
  }
});

test('project serialization records texture folders independently of active tab', () => {
  const { context } = setup();
  const data = JSON.parse(context.serializeCbmodel([], { elements: [], textureSize: [16, 16] }, [{ uid: 'folder_b', name: 'B' }]));
  assert.deepEqual(data.textureGroups, [{ uid: 'folder_b', name: 'B' }]);
});
