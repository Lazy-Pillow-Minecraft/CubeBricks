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
    state, projectTabs: tabs, activeProjectTabId: 'a', suppressJournalRecording: false,
    subdivisionSession: null, PROJECT_SESSION_KEYS: Object.keys(state), CubeBricksProject: Project,
    isBezierElement: () => false, textureUid: asset => asset.uuid,
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
  install(context, ['restoredProjectSession', 'navigateProjectJournal', 'serializeCbmodel']);
  return { context, tabs, state, finish: result => finish(result) };
}

const turn = () => new Promise(resolve => setImmediate(resolve));
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

test('dragging a texture onto multiple cube faces records one operation before mutations', () => {
  const cubes = [0, 1].map(index => ({ uid: `cube_${index}`, uvMode: 'per_face', autoUv: true,
    faces: { north: { uv: [1, 2, 5, 6], texture: 'old', enabled: false } } }));
  const records = [];
  const context = vm.createContext({
    CUBE_FACE_NAMES: ['north'], CULLED_FACE_TEXTURE_KEY: 'culledTexture', UV_FACE_LABELS: {},
    uvPreviewController: { uvPreviewProjectCache: {} },
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
