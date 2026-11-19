// Isolated DOM checks; this never opens or controls the user's application.
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const directory = process.env.CUBEBRICKS_STACK_TEST_DIRECTORY
  || require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'cubebricks-stack-drag-'));
const root = path.resolve(directory);
if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('cubebricks-stack-drag-'))
  throw new Error('Invalid temporary stack-drag directory');

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env, CUBEBRICKS_STACK_TEST_DIRECTORY: root };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['--no-sandbox', __filename], { env, stdio: 'inherit', windowsHide: true });
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', async code => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    process.exitCode = code ?? 1;
  });
} else {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', root); app.setPath('sessionData', root); app.disableHardwareAcceleration();
  const timeout = setTimeout(() => { console.error('Stack drag checks timed out'); app.exit(1); }, 20000);
  app.whenReady().then(async () => {
    const fixture = path.join(root, 'fixture.html');
    const css = pathToFileURL(path.resolve('src/styles.css')).href;
    await fs.writeFile(fixture, `<html><head><link rel="stylesheet" href="${css}"><style>
      #inspector{position:absolute;left:30px;top:30px;width:380px;height:240px}
    </style></head><body><div class="inspector" id="inspector"></div></body></html>`);
    const window = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { backgroundThrottling: false } });
    await window.loadFile(fixture);
    const urls = Object.fromEntries(['screen/inspector/stack-panels.js', 'screen/number-input/controller.js', 'model.js', 'paint/symmetry-relations.js', 'common/core/operation-registry.js']
      .map(file => [file, pathToFileURL(path.resolve('src', file)).href]));
    const result = await window.webContents.executeJavaScript(`(${checkStacks.toString()})(${JSON.stringify(urls)})`);
    console.log(JSON.stringify(result)); clearTimeout(timeout); app.exit(0);
  }).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
}

async function checkStacks(urls) {
  const { createInspectorStackPanels } = await import(urls['screen/inspector/stack-panels.js']);
  const { CubeBricksProject, Cube, addModifier, addOperator } = await import(urls['model.js']);
  const { paintSymmetryRelationCache } = await import(urls['paint/symmetry-relations.js']);
  const { requireOperation } = await import(urls['common/core/operation-registry.js']);
  const { bindNumberInputs } = await import(urls['screen/number-input/controller.js']);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), message);
  const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [new Cube({ uid: 'owner' })], outliner: ['owner'] });
  const owner = project.getNode('owner');
  addModifier(owner, 'symmetry', { uid: 'm1' });
  addModifier(owner, 'element_copy', { uid: 'm2' });
  addModifier(owner, 'symmetry', { uid: 'm3', mode: 'radial' });
  for (const uid of ['o1', 'o2', 'o3']) addOperator(owner, 'paint_symmetry', { uid, enabled: false });
  const state = { project, mode: 'edit', collapsedModifiers: new Set(['m2']), collapsedOperators: new Set(['o2']) };
  const inspector = document.querySelector('#inspector'), snapshots = [];
  const cleanupNumbers = bindNumberInputs({ getProject: () => project, getSnapStep: () => 1, getAngleSnapStep: () => 15 });
  const counters = { dirty: 0, geometry: 0, scene: 0, outliner: 0, renders: 0 };
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  let kind = 'modifier', panels;
  function render() {
    if (!panels.prepareStackRender(owner)) return;
    counters.renders++;
    inspector.innerHTML = kind === 'modifier' ? panels.modifierPanelMarkup(owner) : panels.operatorPanelMarkup(owner);
    panels.bindStackPanels(inspector, owner);
    // Synthetic DOM pointers have no native capture ID. Preserve the capture
    // lifecycle locally while exercising the actual document event handlers.
    for (const handle of inspector.querySelectorAll('[data-stack-drag]')) {
      let captured = null;
      handle.setPointerCapture = id => { captured = id; };
      handle.hasPointerCapture = id => captured === id;
      handle.releasePointerCapture = () => { captured = null; };
    }
  }
  panels = createInspectorStackPanels({ state, $, $$, round: value => value, escapeHtml: String,
    openIconMarkup: direction => `<svg class="open-icon" data-icon-direction="${direction}"></svg>`,
    sceneRenderer: { invalidateMirrorGeometry: () => counters.geometry++ },
    snapshot: id => snapshots.push({ id: requireOperation(id), data: project.serialize() }),
    markDirty: () => counters.dirty++, renderInspector: render,
    renderScene: () => counters.scene++, renderOutliner: () => counters.outliner++,
    schedulePaintSymmetryBuild() {}, updateSelectionLabels() {}, toast() {}, setTool() {}, syncInspectorValues() {}, setMode() {} });

  const pointer = (target, type, x, y, pointerId = 1) => target.dispatchEvent(new PointerEvent(type,
    { bubbles: true, cancelable: true, button: 0, pointerId, clientX: x, clientY: y }));
  function start(uid) {
    const handle = inspector.querySelector(`[data-stack-uid="${uid}"]`), rect = handle.getBoundingClientRect();
    pointer(handle, 'pointerdown', rect.left + 4, rect.top + 4);
    return { handle, x: rect.left + 4, y: rect.top + 4 };
  }
  const ghost = () => document.querySelector('.modifier-stack-drag-ghost');
  const ids = collection => collection.map(entry => entry.uid);
  render();
  assert(!inspector.querySelector('[data-modifier-move],[data-operator-move]'), 'old arrow controls were removed');
  assert(inspector.querySelectorAll('[data-stack-drag="modifier"]').length === 3, 'each modifier has a six-dot handle');
  const collapsed = [...state.collapsedModifiers];
  let press = start('m1');
  pointer(document, 'pointerup', press.x, press.y);
  assert(snapshots.length === 0 && !ghost(), 'clicking a grip creates no history or collapse changes');

  press = start('m1'); pointer(document, 'pointermove', press.x + 8, press.y);
  assert(ghost()?.children.length === 1 && !ghost().querySelector('.modifier-settings'), 'expanded card ghost contains only its heading');
  assert(ghost().querySelector('.open-icon').dataset.iconDirection === 'right', 'ghost shows the collapsed disclosure');
  assert(getComputedStyle(ghost()).opacity === '1', 'the carried heading is opaque');
  assert(inspector.querySelector('[data-modifier-card="m1"] .modifier-settings'), 'real source card remains expanded');
  equal([...state.collapsedModifiers], collapsed, 'dragging does not change collapse state');
  equal(ids(owner.modifiers), ['m1', 'm2', 'm3'], 'preview does not change evaluation order');
  assert(counters.geometry === 0 && counters.scene === 0 && snapshots.length === 0, 'preview performs no model work');
  const rendersBefore = counters.renders; render();
  assert(ghost() && counters.renders === rendersBefore, 'background inspector refresh cannot interrupt an active card drag');
  const scrollBefore = inspector.scrollTop;
  const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40, clientX: press.x, clientY: press.y });
  inspector.dispatchEvent(wheel);
  assert(wheel.defaultPrevented && inspector.scrollTop > scrollBefore, 'wheel scrolling works while holding a card');
  const input = inspector.querySelector('input[type="number"]'), value = input.value;
  const inputWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40, clientX: press.x, clientY: press.y });
  input.dispatchEvent(inputWheel);
  assert(inputWheel.defaultPrevented && input.value === value, 'wheel over a numeric property scrolls the stack instead of editing it during a drag');
  pointer(document, 'pointermove', -1000, 5000);
  pointer(document, 'pointerup', -1000, 5000, 2);
  assert(ghost(), 'unrelated pointer release cannot finish the drag');
  pointer(document, 'pointerup', -1000, 5000);
  equal(ids(owner.modifiers), ['m2', 'm3', 'm1'], 'drop clamps to the final position using only Y');
  assert(snapshots.length === 1 && snapshots[0].id === 'modifier.symmetry.move', 'one modifier reorder creates one indexed undo step');
  equal(JSON.parse(snapshots[0].data).elements[0].modifiers.map(entry => entry.uid), ['m1', 'm2', 'm3'], 'undo captures the original order');
  assert(counters.geometry === 1 && counters.outliner === 1 && !ghost(), 'commit refreshes geometry and copy-node hierarchy once');
  equal([...state.collapsedModifiers], collapsed, 'collapse state survives the commit');

  inspector.scrollTop = 0;
  press = start('m2'); pointer(document, 'pointermove', press.x + 8, press.y);
  assert(ghost()?.children.length === 1, 'already-collapsed cards use the same heading-only ghost');
  pointer(document, 'pointercancel', press.x, -5000);
  assert(!ghost() && snapshots.length === 1, 'pointer cancellation removes all preview state without reordering');
  press = start('m3'); pointer(document, 'pointermove', press.x + 8, press.y);
  panels.cancelStackDrag();
  assert(!ghost() && !inspector.querySelector('.modifier-stack-drop-guide'), 'inspector rebuild cleanup removes ghost and guide');

  kind = 'operator'; state.mode = 'paint'; inspector.scrollTop = 0; render();
  assert(inspector.querySelectorAll('[data-stack-drag="operator"]').length === 3, 'paint-mode operators have the same grips');
  paintSymmetryRelationCache.set('o1', { relationCount: 2 });
  press = start('o1'); pointer(document, 'pointermove', press.x + 8, press.y);
  assert(ghost()?.children.length === 1 && getComputedStyle(ghost()).opacity === '1', 'disabled operator ghost is also an opaque heading');
  pointer(document, 'pointerup', 5000, 5000);
  equal(ids(owner.operators), ['o2', 'o3', 'o1'], 'operators reorder in painting mode');
  assert(snapshots.length === 2 && snapshots[1].id === 'operator.paint_symmetry.move', 'operator reorder is independently undoable');
  assert(!paintSymmetryRelationCache.has('o1'), 'operator relation cache is invalidated after a move');
  assert(counters.geometry === 1, 'operator reorder does not rebuild modifier geometry');
  equal([...state.collapsedOperators], ['o2'], 'operator collapse state remains unchanged');
  press = start('o1'); pointer(document, 'pointermove', 5000, -5000); pointer(document, 'pointerup', 5000, -5000);
  equal(ids(owner.operators), ['o1', 'o2', 'o3'], 'Y above the list clamps to the first position');
  assert(snapshots.length === 3, 'repeated panel binds do not duplicate commits');
  press = start('o1'); pointer(document, 'pointermove', press.x + 8, press.y); pointer(document, 'pointerup', press.x + 8, press.y);
  assert(snapshots.length === 3, 'dropping at the original slot creates no undo step');

  press = start('o1'); pointer(document, 'pointermove', press.x + 8, press.y);
  state.project = new CubeBricksProject({ elements: [] });
  pointer(document, 'pointerup', press.x, 5000);
  assert(snapshots.length === 3 && !ghost(), 'a project switch cancels a stale drag');
  state.project = project; render();
  press = start('o1'); pointer(document, 'pointermove', press.x + 8, press.y);
  window.dispatchEvent(new Event('blur'));
  assert(snapshots.length === 3 && !ghost(), 'window blur cancels the drag without history');
  cleanupNumbers();
  return { passed: true, modifierOrder: ids(owner.modifiers), operatorOrder: ids(owner.operators), undoSteps: snapshots.length, counters };
}
