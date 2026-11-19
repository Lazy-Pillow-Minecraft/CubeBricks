import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CubeBricksProject } from '../src/model.js';
import { createReferenceImageController } from '../src/screen/reference-images.js';
import { translateUiText } from '../src/common/config/app-config.js';
import { requireOperation } from '../src/common/core/operation-registry.js';

// Small DOM fixture: exercise the real reference controller without opening a
// desktop window or touching the user's projects, preferences, or images.
function element(tag = 'div') {
  const attributes = new Map(), classes = new Set(), properties = new Map();
  return {
    tag, dataset: {}, children: [], hidden: false, width: 0, height: 0, complete: true,
    style: { setProperty: (key, value) => properties.set(key, value), getPropertyValue: key => properties.get(key) },
    classList: { toggle(key, enabled) { enabled ? classes.add(key) : classes.delete(key); },
      add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) },
    setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key),
    get naturalWidth() { return this.width; }, get naturalHeight() { return this.height; },
    get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; },
    insertBefore(child, next) {
      child.remove(); child.parent = this;
      const index = this.children.indexOf(next);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
    },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
    querySelectorAll: function (selector) { return this.children.filter(child => child.tag === selector); },
    querySelector: function (selector) { return this.children.find(child => child.tag === selector); },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture(id) { this.capture = id; }, hasPointerCapture(id) { return this.capture === id; },
    releasePointerCapture() { this.capture = null; }
  };
}

function fixture({ images = true } = {}) {
  const image = { uid: 'reference', name: 'reference.png', source: 'data:image/png;base64,AA==',
    naturalWidth: 1024, naturalHeight: 512, scale: .25, offset: [0, 0] };
  const project = new CubeBricksProject({ referenceImages: { general: images ? [image] : [],
    x: [image], y: [image], z: [image] } });
  const state = { project, axisView: null, mode: 'edit', referenceImageSelection: {} };
  const layer = element(), hint = element('span'), controls = new Map(), snapshots = [];
  layer.insertBefore(hint, null);
  for (const id of ['#referenceImageViewLabel', '#referenceImageName', '#referenceImageList', '#referenceImageMenu',
    '[data-action="referenceImage"]', ...['edit', 'reset', 'remove', 'lock'].map(action => `[data-reference-action="${action}"]`)])
    controls.set(id, element());
  const lock = controls.get('[data-reference-action="lock"]');
  lock.insertBefore(element('use'), null); lock.insertBefore(element('span'), null);
  const buttons = ['edit', 'reset', 'remove'].map(action => {
    const button = controls.get(`[data-reference-action="${action}"]`);
    button.dataset.referenceAction = action; return button;
  });
  let dirty = 0;
  const renderer = { zoom: 10, sign: 1, projectPoint(point) {
    const x = state.axisView === 'x' ? -point[2] : point[0];
    const y = state.axisView === 'y' ? -point[2] : point[1];
    return { x: 400 + x * this.zoom * this.sign, y: 300 - y * this.zoom };
  } };
  const controller = createReferenceImageController({ state, $: selector => controls.get(selector), $$: () => buttons,
    escapeHtml: String, viewport: { clientWidth: 800, clientHeight: 600 }, sceneRenderer: renderer,
    referenceImageInput: {}, referenceImageLayer: layer, referenceImageHint: hint,
    snapshot: id => { requireOperation(id); snapshots.push(JSON.parse(project.serialize())); },
    markDirty: () => dirty++, toast() {}, setPaintColor() {}, updateToolOptions() {} });
  controller.updateReferenceImageLayer();
  return { state, layer, lock, controls, snapshots, renderer, controller, get dirty() { return dirty; } };
}

const originalDocument = globalThis.document;
const originalMatrix = globalThis.DOMMatrix;
before(() => {
  globalThis.document = { createElement(tag) {
    const node = element(tag);
    if (tag === 'canvas') node.getContext = () => ({ drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray([20, 40, 60, 255]) }) });
    return node;
  } };
  globalThis.DOMMatrix = class {
    constructor(value) { this.values = value.slice(7, -1).split(',').map(Number); }
    inverse() {
      const [a, b, c, d, tx, ty] = this.values, determinant = a * d - b * c;
      return { transformPoint: ({ x, y }) => ({
        x: ((x - tx) * d - (y - ty) * c) / determinant,
        y: ((y - ty) * a - (x - tx) * b) / determinant
      }) };
    }
  };
});
  test('glow width stays constant for different source resolutions, scales, zooms, and both axis signs', () => {
    const { state, layer, renderer, controller } = fixture();
    for (const view of [null, 'x', 'y', 'z']) for (const sign of [-1, 1]) for (const scale of [.01, .5, 8]) {
      state.axisView = view; renderer.sign = sign; renderer.zoom = scale === 8 ? 40 : 3;
      const record = state.project.referenceImages[view || 'general'][0];
      record.scale = scale; record.naturalWidth = scale === .01 ? 8192 : 32;
      controller.setReferenceImageEditing(true);
      const image = layer.querySelector('img');
      const [a, b] = image.style.transform.slice(7, -1).split(',').map(Number);
      assert.ok(Math.abs(Math.hypot(a, b) * parseFloat(image.style.getPropertyValue('--reference-glow-radius')) - 1) < 1e-9);
      assert.ok(image.classList.contains('selected'));
    }
  });

  test('locking stops current capture and blocks every edit entry, scaling, and reset until explicitly unlocked', () => {
    const f = fixture(), { controller, state, layer, controls, lock } = f;
    controller.setReferenceImageEditing(true);
    controller.beginReferenceImageDrag({ button: 0, pointerId: 7, clientX: 400, clientY: 300,
      preventDefault() {}, stopPropagation() {} });
    assert.equal(layer.hasPointerCapture(7), true);
    controller.setReferenceImagesLocked(true);
    assert.equal(layer.hasPointerCapture(7), false, 'locking releases a live image drag');
    assert.equal(controller.editing, false);
    assert.equal(controller.setReferenceImageEditing(true), false);
    assert.ok(!layer.classList.contains('editing'));
    assert.equal(lock.getAttribute('aria-pressed'), 'true');
    assert.equal(lock.querySelector('use').getAttribute('href'), '#icon-locked');
    for (const action of ['edit', 'reset']) assert.equal(controls.get(`[data-reference-action="${action}"]`).disabled, true);
    const before = JSON.stringify(state.project.referenceImages);
    controller.beginReferenceImageDrag({ button: 0 });
    controller.moveReferenceImageDrag({ pointerId: 7, clientX: 150, clientY: 200 });
    controller.scaleReferenceImage({ deltaY: -1, preventDefault() { throw new Error('locked wheel was consumed'); } });
    controller.resetReferenceImage();
    assert.equal(JSON.stringify(state.project.referenceImages), before);
    assert.equal(controller.sampleReferenceImage(400, 300), '#14283c', 'locked references remain available for color sampling');
    assert.equal(f.dirty, 1); assert.equal(f.snapshots.length, 1);
    controller.setReferenceImagesLocked(true);
    assert.equal(f.snapshots.length, 1, 'no-op locks do not add history entries');
    state.axisView = 'x'; controller.updateReferenceImageLayer();
    assert.equal(controller.setReferenceImageEditing(true), false, 'lock protects axis views too');
    controller.setReferenceImagesLocked(false);
    assert.equal(controller.editing, false, 'unlock does not unexpectedly enter edit mode');
    assert.equal(lock.querySelector('use').getAttribute('href'), '#icon-unlocked');
    assert.equal(controller.setReferenceImageEditing(true), true);
  });

  test('lock survives a native round trip, undo refresh, and empty-view cache updates', () => {
    const { controller, state, lock, snapshots } = fixture({ images: false });
    controller.setReferenceImagesLocked(true);
    assert.equal(lock.getAttribute('aria-pressed'), 'true');
    state.project = new CubeBricksProject(JSON.parse(state.project.serialize()));
    controller.updateReferenceImageLayer();
    assert.equal(controller.locked, true);
    assert.equal(controller.setReferenceImageEditing(true), false);
    state.project = new CubeBricksProject(snapshots[0]); controller.updateReferenceImageLayer();
    assert.equal(controller.locked, false); assert.equal(lock.getAttribute('aria-pressed'), 'false');
    for (const language of ['zh-Hans', 'zh-Hant', 'en'])
      assert.ok(!translateUiText('ui.lock-reference-images', language).startsWith('ui.'));
  });

  test('importing another image while locked leaves references protected instead of automatically editing', async () => {
    const originalImage = globalThis.Image, originalWindow = globalThis.window;
    globalThis.Image = class {
      naturalWidth = 32; naturalHeight = 32;
      set src(value) { queueMicrotask(() => this.onload()); }
    };
    globalThis.window = { cubeBricksDesktop: { readClipboardImage: async () => 'data:image/png;base64,AA==' } };
    try {
      const { controller, state } = fixture();
      controller.setReferenceImagesLocked(true);
      await controller.addReferenceImageFromClipboard();
      assert.equal(state.project.referenceImages.general.length, 2);
      assert.equal(controller.editing, false);
      assert.equal(controller.locked, true);
    } finally {
      if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage;
      if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
  });
after(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalMatrix === undefined) delete globalThis.DOMMatrix;
  else globalThis.DOMMatrix = originalMatrix;
});
