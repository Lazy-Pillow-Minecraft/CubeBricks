import { Cube, Group, Shape, CubeBricksProject, importBlockbench } from './model.js';
import { ConfigKey, applyLanguage, configRegistry, getLanguageLabel } from './config/app-config.js';
import { WebGLSceneRenderer, applyGroupTransforms, getBlockbenchBoxUv } from './render/webgl-renderer.js';
import { DockManager } from './ui/dock-manager.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  project: CubeBricksProject.demo(),
  selectedUid: null,
  mode: 'edit',
  tool: 'move',
  filePath: null,
  dirty: false,
  grid: configRegistry.get(ConfigKey.SHOW_GRID),
  wire: configRegistry.get(ConfigKey.SHOW_WIREFRAME),
  renderMode: 'textured',
  transformSpace: 'global',
  scaleHandleMode: 'bounds',
  projection: configRegistry.get(ConfigKey.PROJECTION),
  previewShade: configRegistry.get(ConfigKey.PREVIEW_SHADE),
  geometryOnly: configRegistry.get(ConfigKey.SHOW_GEOMETRY_ONLY),
  snap: configRegistry.get(ConfigKey.SNAP),
  allowNegativeSize: configRegistry.get(ConfigKey.ALLOW_NEGATIVE_SIZE),
  modifierSnap: {
    shift: { mode: configRegistry.get(ConfigKey.SHIFT_SNAP_MODE), value: configRegistry.get(ConfigKey.SHIFT_SNAP_VALUE) },
    ctrl: { mode: configRegistry.get(ConfigKey.CTRL_SNAP_MODE), value: configRegistry.get(ConfigKey.CTRL_SNAP_VALUE) },
    shiftCtrl: { mode: configRegistry.get(ConfigKey.SHIFT_CTRL_SNAP_MODE), value: configRegistry.get(ConfigKey.SHIFT_CTRL_SNAP_VALUE) }
  },
  symmetry: configRegistry.get(ConfigKey.SYMMETRY),
  alphaLock: configRegistry.get(ConfigKey.ALPHA_LOCK),
  zoom: 1,
  panX: 0,
  panY: 0,
  yaw: -0.72,
  pitch: 0.38,
  target: [0, 9, 0],
  history: [],
  future: [],
  hitAreas: [],
  dragging: null,
  outlinerCollapsed: false,
  collapsedGroups: new Set(),
  textureAssets: [],
  timelinePlaying: false,
  timelineFrame: 0,
  layoutResizing: false
};

const DOCK_PANEL_DEFINITIONS = Object.freeze([
  { id: 'texture', index: 0, modes: ['edit', 'paint'], defaultDock: 'left', defaultOrder: 0, defaultPosition: { x: 24, y: 104 }, defaultSize: { width: 236, height: 620 }, defaultCollapsed: false },
  { id: 'inspector', index: 1, modes: ['edit', 'paint', 'animate'], defaultDock: 'right', defaultOrder: 0, defaultPosition: { x: 920, y: 104 }, defaultSize: { width: 292, height: 340 }, defaultCollapsed: false },
  { id: 'outliner', index: 2, modes: ['edit', 'paint', 'animate'], defaultDock: 'right', defaultOrder: 1, defaultPosition: { x: 920, y: 460 }, defaultSize: { width: 292, height: 340 }, defaultCollapsed: false },
  { id: 'bottom', index: 3, modes: ['edit', 'paint', 'animate'], defaultDock: 'bottom', defaultOrder: 0, defaultPosition: { x: 280, y: 620 }, defaultSize: { width: 720, height: 176 }, defaultCollapsed: false }
]);

state.selectedUid = state.project.elements[0]?.uid;

const sceneCanvas = $('#sceneCanvas');
const sceneRenderer = new WebGLSceneRenderer(sceneCanvas);
const textureCanvas = $('#textureCanvas');
const textureCtx = textureCanvas.getContext('2d');
const outliner = $('#outliner');
const inspector = $('#inspector');
const projectState = $('#projectState');
const themeDialog = $('#themeDialog');
const languageSelect = $('#languageSelect');
const fileInput = $('#fileInput');
const textureInput = $('#textureInput');
let toastTimer;
let outlinerFrame = null;
let dockManager = null;

function selected() {
  return state.project.getNode(state.selectedUid);
}

function snapshot() {
  state.history.push(state.project.serialize());
  if (state.history.length > 60) state.history.shift();
  state.future.length = 0;
}

function restore(serialized) {
  state.project = new CubeBricksProject(JSON.parse(serialized));
  if (!state.project.getNode(state.selectedUid)) {
    state.selectedUid = state.project.elements[0]?.uid || null;
  }
  markDirty(true);
  renderAll();
}

function undo() {
  if (!state.history.length) return toast('沒有可撤銷的操作');
  state.future.push(state.project.serialize());
  restore(state.history.pop());
}

function redo() {
  if (!state.future.length) return toast('沒有可重做的操作');
  state.history.push(state.project.serialize());
  restore(state.future.pop());
}

function markDirty(value = true) {
  state.dirty = value;
  const fileName = state.filePath ? state.filePath.split(/[\\/]/).pop() : `${state.project.name}.cbmodel`;
  projectState.textContent = `${value ? '● ' : ''}${fileName}`;
  projectState.style.color = value ? 'var(--accent)' : '';
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2100);
}

function renderAll(geometryScope = 'all') {
  if (geometryScope === 'selection') sceneRenderer.invalidateSelectionGeometry();
  else sceneRenderer.invalidateGeometry();
  $('#minecraftRenderType').value = state.project.renderType;
  $('#cullFaces').checked = state.project.cullFaces;
  updateRenderModeControl();
  updateToolOptions();
  renderOutliner();
  renderInspector();
  renderScene();
  updateSelectionLabels();
}

function updateSelectionLabels() {
  const item = selected();
  $('#selectionType').textContent = item?.type || 'Scene';
  $('#selectionName').textContent = item?.name || state.project.name;
  $('#uidChip').textContent = item?.uid || '—';
}

function renderOutliner() {
  const filter = $('#outlinerSearch').value.trim().toLowerCase();
  const matches = uidValue => {
    const node = state.project.getNode(uidValue);
    if (!node) return false;
    if (!filter || node.name.toLowerCase().includes(filter) || node.uid.toLowerCase().includes(filter)) return true;
    return node.type === 'group' && node.children.some(matches);
  };
  const rows = [];
  const collectNode = (uidValue, depth = 0) => {
    const node = state.project.getNode(uidValue);
    if (!node || !matches(uidValue)) return;
    const group = node.type === 'group';
    const collapsed = group && state.collapsedGroups.has(node.uid);
    rows.push({ node, depth, group, collapsed });
    if (group && !collapsed) node.children.forEach(child => collectNode(child, depth + 1));
  };
  state.project.outliner.forEach(uidValue => collectNode(uidValue));
  state.outlinerRows = rows;
  state.outlinerWindowStart = -1;
  state.outlinerWindowEnd = -1;
  const scrollTop = outliner.scrollTop;
  outliner.innerHTML = `<div class="outliner-virtual-spacer" style="height:${rows.length * 31}px"></div><div class="outliner-virtual-window"></div>`;
  outliner.scrollTop = scrollTop;
  renderOutlinerWindow();
}

function renderOutlinerWindow() {
  const rows = state.outlinerRows || [];
  const rowHeight = 31;
  const overscan = 6;
  const start = Math.max(0, Math.floor(outliner.scrollTop / rowHeight) - overscan);
  const end = Math.min(rows.length, Math.ceil((outliner.scrollTop + outliner.clientHeight) / rowHeight) + overscan);
  if (start === state.outlinerWindowStart && end === state.outlinerWindowEnd) return;
  state.outlinerWindowStart = start;
  state.outlinerWindowEnd = end;
  const windowNode = $('.outliner-virtual-window', outliner);
  if (!windowNode) return;
  windowNode.style.transform = `translateY(${start * rowHeight}px)`;
  windowNode.innerHTML = rows.slice(start, end).map(({ node, depth, group, collapsed }) => `<button class="outliner-item ${node.uid === state.selectedUid ? 'active' : ''}" data-uid="${node.uid}" style="padding-left:${5 + depth * 13}px">
      <span data-disclosure="${group ? node.uid : ''}">${group ? (collapsed ? '›' : '⌄') : ''}</span>
      <span class="kind">${group ? '▰' : node.type === 'shape' ? '◉' : node.type === 'locator' ? '⌖' : '◇'}</span>
      <span class="item-name">${escapeHtml(node.name)}</span><span class="eye" data-toggle-visible="${node.uid}">${node.visible ? '◉' : '○'}</span>
    </button>`).join('');
}

function scheduleOutlinerWindow() {
  if (outlinerFrame !== null) return;
  outlinerFrame = requestAnimationFrame(() => {
    outlinerFrame = null;
    renderOutlinerWindow();
  });
}

function renderInspector() {
  const item = selected();
  if (!item) {
    inspector.innerHTML = '<div class="field-section"><p style="color:var(--muted);font-size:.7rem">選擇一個 Cube、Shape 或組來編輯。</p></div>';
    return;
  }
  const rotation = item.rotation || [0, 0, 0];
  const typeLabel = item.type === 'shape' ? '程序化形狀' : item.type === 'locator' ? 'Locator' : item.type === 'group' ? '組' : '立方體';
  const details = item.type === 'cube' ? `
      <div class="field-title"><span>幾何</span><button data-action="resetTransform">重置</button></div>
      ${vectorField('位置', 'position', item.position)}
      ${vectorField('尺寸', 'size', item.size)}
      ${vectorField('樞軸', 'pivot', item.pivot)}
      ${vectorField('旋轉', 'rotation', rotation)}
      <div class="option-row"><span>膨脹</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-field="inflate" value="${item.inflate}" /></div></div>
      <div class="option-row"><span>UV 模式</span><select data-field="uvMode"><option value="box" ${item.uvMode === 'box' ? 'selected' : ''}>箱型 UV</option><option value="face" ${item.uvMode === 'face' ? 'selected' : ''}>逐面 UV</option></select></div>`
    : item.type === 'shape' ? `
      <div class="field-title"><span>形狀參數</span><span>${item.shapeType}</span></div>
      ${vectorField('位置', 'origin', item.origin)}
      ${vectorField('旋轉', 'rotation', rotation)}
      ${parameterField('半徑', 'radius', item.parameters.radius, .1)}
      ${parameterField('高度', 'height', item.parameters.height, .1)}
      ${parameterField('邊數', 'sides', item.parameters.sides, 1)}
      <div class="option-row"><span>生成 Cube</span><strong style="color:var(--accent)">${item.toCubes().length} 個</strong></div>`
    : item.type === 'locator' ? `
      <div class="field-title"><span>Locator 變換</span><button data-action="resetTransform">重置</button></div>
      ${vectorField('位置', 'position', item.position)}
      ${vectorField('旋轉', 'rotation', rotation)}`
    : `
      <div class="field-title"><span>組變換</span><button data-action="resetTransform">重置</button></div>
      ${vectorField('樞軸', 'pivot', item.pivot)}
      ${vectorField('旋轉', 'rotation', rotation)}
      <div class="option-row"><span>直接子項</span><strong style="color:var(--accent)">${item.children.length}</strong></div>`;
  inspector.innerHTML = `
    <div class="field-section">
      <div class="field-title"><span>基本</span><span>${typeLabel}</span></div>
      <input class="name-field" data-field="name" value="${escapeAttribute(item.name)}" aria-label="名稱" />
      <div class="option-row"><span>可見</span><label class="switch"><input type="checkbox" data-field="visible" ${item.visible ? 'checked' : ''}/><i></i></label></div>
    </div>
    <div class="field-section">
      ${details}
    </div>
    ${item.type === 'cube' || item.type === 'shape' ? `
    <div class="field-section">
      <div class="field-title"><span>外觀</span><span>預覽色</span></div>
      <div class="option-row"><span>材質色</span><input type="color" data-field="color" value="${item.color}" /></div>
      <div class="option-row"><span>面陰影</span><label class="switch"><input type="checkbox" data-field="shade" ${item.shade !== false ? 'checked' : ''}/><i></i></label></div>
    </div>` : ''}
    <div class="field-section"><button class="danger-button" data-action="deleteSelected">刪除${item.type === 'group' ? '組及其內容' : '物件'}</button></div>`;
  bindInspector();
}

function vectorField(label, field, values) {
  return `<div class="vector-field"><span>${label}</span>${values.map((value, index) => `<label class="number-wrap"><b>${'XYZ'[index]}</b><input type="number" step="0.25" data-vector="${field}" data-axis="${index}" value="${round(value)}" /></label>`).join('')}</div>`;
}

function parameterField(label, key, value, step) {
  return `<div class="option-row"><span>${label}</span><div class="number-wrap" style="width:68px"><input type="number" min="${key === 'sides' ? 3 : .1}" step="${step}" data-parameter="${key}" value="${value}" /></div></div>`;
}

function bindInspector() {
  const item = selected();
  if (!item) return;
  $$('[data-field]', inspector).forEach(input => {
    const eventName = input.type === 'text' ? 'change' : 'change';
    input.addEventListener(eventName, () => {
      snapshot();
      const key = input.dataset.field;
      item[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
      markDirty();
      renderAll('selection');
    });
  });
  $$('[data-vector]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      if (!snapshotTaken) { snapshot(); snapshotTaken = true; }
      const field = input.dataset.vector;
      const axis = Number(input.dataset.axis);
      const nextValue = item.type === 'cube' && field === 'size' && !state.allowNegativeSize
        ? Math.max(0, value)
        : value;
      if (nextValue !== value) input.value = String(nextValue);
      if (item.type === 'cube' && field === 'position') {
        const delta = nextValue - item.position[axis];
        item.position[axis] = nextValue;
        item.pivot[axis] += delta;
      } else item[field][axis] = nextValue;
      markDirty(); sceneRenderer.invalidateSelectionGeometry(); renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  $$('[data-parameter]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      if (!snapshotTaken) { snapshot(); snapshotTaken = true; }
      const key = input.dataset.parameter;
      item.parameters[key] = key === 'sides' ? Math.max(3, Math.round(value)) : Math.max(.1, value);
      markDirty(); sceneRenderer.invalidateSelectionGeometry(); renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  $('[data-action="deleteSelected"]', inspector)?.addEventListener('click', deleteSelected);
  $('[data-action="resetTransform"]', inspector)?.addEventListener('click', () => {
    snapshot();
    item.rotation = [0, 0, 0];
    markDirty(); renderAll('selection');
  });
}

function selectItem(uid) {
  if (uid === state.selectedUid) return;
  sceneRenderer.commitSelectionGeometry(state.project, state.selectedUid);
  const previous = outliner.querySelector('.outliner-item.active');
  previous?.classList.remove('active');
  state.selectedUid = uid;
  outliner.querySelector(`[data-uid="${uid}"]`)?.classList.add('active');
  sceneRenderer.invalidateSelectionGeometry();
  renderInspector();
  renderScene();
  updateSelectionLabels();
}

function syncInspectorValues(item) {
  if (!item) return;
  $$('[data-vector]', inspector).forEach(input => {
    const values = item[input.dataset.vector];
    if (!values) return;
    const value = round(values[Number(input.dataset.axis)]);
    if (document.activeElement !== input) input.value = String(value);
  });
  $$('[data-parameter]', inspector).forEach(input => {
    const value = item.parameters?.[input.dataset.parameter];
    if (value !== undefined && document.activeElement !== input) input.value = String(round(value));
  });
}

function addCube() {
  snapshot();
  const count = state.project.elements.filter(item => item.type === 'cube').length + 1;
  const cube = new Cube({ name: `cube_${count}`, position: [-3, 1, -3], size: [6, 6, 6], pivot: [0, 4, 0], color: '#a7d352' });
  state.project.addElement(cube, selected()?.type === 'group' ? selected().uid : null);
  state.selectedUid = cube.uid;
  markDirty(); renderAll(); toast('已新增 Cube');
}

function addShape() {
  snapshot();
  const shape = new Shape({ name: 'cylinder_shape', origin: [0, 2, 0] });
  state.project.addElement(shape, selected()?.type === 'group' ? selected().uid : null);
  state.selectedUid = shape.uid;
  markDirty(); renderAll(); toast('已新增程序化 Shape');
}

function addGroup() {
  snapshot();
  const current = selected();
  const parent = current?.type === 'group' ? current : state.project.getParentGroup(current?.uid);
  const group = new Group({ name: `group_${state.project.groups.length + 1}`, children: [] });
  state.project.addGroup(group, parent?.uid || null);
  if (current && current.type !== 'group') {
    const container = parent ? parent.children : state.project.outliner;
    const oldIndex = container.indexOf(current.uid);
    if (oldIndex >= 0) container.splice(oldIndex, 1);
    group.children.push(current.uid);
  }
  state.selectedUid = group.uid;
  markDirty(); renderAll(); toast('已新增組');
}

function deleteSelected() {
  if (!selected()) return;
  snapshot();
  state.project.removeNode(state.selectedUid);
  state.selectedUid = state.project.outliner[0] || state.project.elements[0]?.uid || null;
  markDirty(); renderAll(); toast('物件已刪除');
}

function renderScene() {
  sceneRenderer.render(state.project, state.selectedUid, state);
  updateTransformGizmo();
  updateAxisWidget();
}

function bakeCameraPan() {
  const frame = sceneRenderer.getCameraFrame();
  if (frame?.target) state.target = [...frame.target];
  state.panX = 0;
  state.panY = 0;
}

function focusSelected() {
  const center = state.selectedUid && sceneRenderer.getGeometryCenter(state.project, state.selectedUid);
  if (!center) return toast('目前沒有可聚焦的物件');
  state.target = [...center];
  state.panX = 0;
  state.panY = 0;
  renderScene();
}

function focusSceneOrigin() {
  state.target = [0, 0, 0];
  state.panX = 0;
  state.panY = 0;
  renderScene();
}

function updateAxisWidget() {
  const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch), cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
  const forward = [-sy * cp, -sp, -cy * cp];
  const right = normalize3(cross3(forward, [0, 1, 0]));
  const up = normalize3(cross3(right, forward));
  const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  for (const [name, axis] of Object.entries(axes)) {
    const x = 33 + dot3(axis, right) * 22;
    const y = 33 - dot3(axis, up) * 22;
    const depth = dot3(axis, forward);
    const line = $(`#axisLine${name.toUpperCase()}`);
    line.setAttribute('x2', x); line.setAttribute('y2', y);
    line.style.opacity = String(.45 + Math.max(0, depth) * .55);
    const button = $(`[data-view-axis="${name}"]`);
    button.style.left = `${x}px`; button.style.top = `${y}px`;
    button.style.zIndex = depth > 0 ? '2' : '1';
    button.style.opacity = String(.6 + Math.max(0, depth) * .4);
  }
}

function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize3(vector) { const length = Math.hypot(...vector) || 1; return vector.map(value => value / length); }

function updateTransformSpaceButtons() {
  $$('[data-transform-space]').forEach(button => {
    const active = button.dataset.transformSpace === state.transformSpace;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateScaleHandleModeButtons() {
  $$('[data-scale-handle-mode]').forEach(button => {
    const active = button.dataset.scaleHandleMode === state.scaleHandleMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function rotateVector(vector, rotation) {
  let [x, y, z] = vector;
  const [rx, ry, rz] = rotation.map(value => value * Math.PI / 180);
  let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

function inverseRotateVector(vector, rotation) {
  return rotateVector(rotateVector(rotateVector(vector, [0, 0, -rotation[2]]), [0, -rotation[1], 0]), [-rotation[0], 0, 0]);
}

function quaternionMultiply(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

function quaternionFromEuler(rotation) {
  const half = rotation.map(value => value * Math.PI / 360);
  const qx = [Math.sin(half[0]), 0, 0, Math.cos(half[0])];
  const qy = [0, Math.sin(half[1]), 0, Math.cos(half[1])];
  const qz = [0, 0, Math.sin(half[2]), Math.cos(half[2])];
  return quaternionMultiply(quaternionMultiply(qz, qy), qx);
}

function quaternionFromAxisAngle(axis, degrees) {
  const half = degrees * Math.PI / 360, direction = normalize3(axis);
  return [...direction.map(value => value * Math.sin(half)), Math.cos(half)];
}

function eulerFromQuaternion(q) {
  const [x, y, z, w] = q;
  const sinY = 2 * (w * y - z * x);
  const rx = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const ry = Math.asin(Math.max(-1, Math.min(1, sinY)));
  const rz = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [rx, ry, rz].map(value => value * 180 / Math.PI);
}

function getTransformPivot(item) {
  const local = item.type === 'cube' || item.type === 'group' ? item.pivot : item.type === 'locator' ? item.position : item.origin;
  return applyGroupTransforms(local, state.project.getGroupChain(item.uid));
}

function getTransformAxes(item) {
  const chain = state.project.getGroupChain(item.uid);
  const parentRotation = vector => applyGroupTransforms(vector, chain.map(group => ({ pivot: [0, 0, 0], rotation: group.rotation })));
  return [0, 1, 2].map(axis => {
    const unit = [0, 0, 0]; unit[axis] = 1;
    let direction = state.transformSpace === 'global' ? unit : parentRotation(unit);
    if (state.transformSpace === 'self' || (state.tool === 'resize' && item.type !== 'group')) {
      direction = parentRotation(rotateVector(unit, item.rotation || [0, 0, 0]));
    }
    return normalize3(direction);
  });
}

function addScaled3(point, direction, amount) {
  return point.map((value, axis) => value + direction[axis] * amount);
}

function projectViewportPoint(point) {
  const projected = sceneRenderer.projectPoint(point);
  return { ...projected, worldPerPixel: sceneRenderer.getCameraFrame()?.worldPerPixel || .08 };
}

function axisBasis(axis) {
  const reference = Math.abs(axis[1]) < .82 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize3(cross3(axis, reference));
  return [u, normalize3(cross3(axis, u))];
}

function pointsPath(points, close = false) {
  if (!points.length) return '';
  return `${points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}${close ? ' Z' : ''}`;
}

const GIZMO_AXIS_PIXELS = 93;
const GIZMO_HEAD_GAP_PIXELS = 25;

function coneMarkup(handle, origin, axisClass, pixelWorld) {
  const baseWorld = addScaled3(origin, handle.vector, handle.positiveDistance);
  const tipWorld = addScaled3(baseWorld, handle.vector, pixelWorld * 19.5);
  const u = handle.basisU, v = handle.basisV;
  const base = Array.from({ length: 12 }, (_, index) => {
    const angle = index / 12 * Math.PI * 2;
    let point = addScaled3(baseWorld, u, Math.cos(angle) * pixelWorld * 8.25);
    point = addScaled3(point, v, Math.sin(angle) * pixelWorld * 8.25);
    return projectViewportPoint(point);
  });
  const tip = projectViewportPoint(tipWorld);
  const baseCenter = projectViewportPoint(baseWorld);
  const faces = base.map((point, index) => `<path class="gizmo-visible gizmo-head cone-face" d="${pointsPath([tip, point, base[(index + 1) % base.length]], true)}"/>`).join('');
  return `<g class="gizmo-control ${axisClass}" data-axis="${handle.axis}" data-kind="axis">
    <line class="gizmo-hit" x1="${handle.centerX}" y1="${handle.centerY}" x2="${tip.x}" y2="${tip.y}"/>
    <line class="gizmo-visible axis-stem" x1="${handle.centerX}" y1="${handle.centerY}" x2="${baseCenter.x}" y2="${baseCenter.y}"/>
    ${faces}<circle class="gizmo-hit-point" cx="${tip.x}" cy="${tip.y}" r="18"/>
  </g>`;
}

function prismMarkup(handle, origin, axisClass, pixelWorld, sign) {
  const direction = handle.vector.map(value => value * sign);
  const distance = sign > 0 ? handle.positiveDistance : handle.negativeDistance;
  const endpointWorld = addScaled3(origin, direction, distance);
  const side = pixelWorld * 13.5;
  const halfSide = side / 2;
  const halfThickness = side / 4;
  const corners = [];
  for (const along of [-halfThickness, halfThickness]) for (const acrossU of [-halfSide, halfSide]) for (const acrossV of [-halfSide, halfSide]) {
    let point = addScaled3(endpointWorld, direction, along);
    point = addScaled3(point, handle.basisU, acrossU);
    point = addScaled3(point, handle.basisV, acrossV);
    corners.push(projectViewportPoint(point));
  }
  const faces = [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]
    .map(indices => ({ points: indices.map(index => corners[index]), depth: indices.reduce((sum, index) => sum + corners[index].depth, 0) / 4 }))
    .sort((a, b) => b.depth - a.depth)
    .map(face => `<path class="gizmo-visible gizmo-head prism-face" d="${pointsPath(face.points, true)}"/>`).join('');
  const endpoint = projectViewportPoint(endpointWorld);
  return `<g class="gizmo-control ${axisClass}" data-axis="${handle.axis}" data-kind="axis" data-sign="${sign}">
    <line class="gizmo-hit" x1="${handle.centerX}" y1="${handle.centerY}" x2="${endpoint.x}" y2="${endpoint.y}"/>
    <line class="gizmo-visible axis-stem" x1="${handle.centerX}" y1="${handle.centerY}" x2="${endpoint.x}" y2="${endpoint.y}"/>
    ${faces}<circle class="gizmo-hit-point" cx="${endpoint.x}" cy="${endpoint.y}" r="18"/>
  </g>`;
}

function frontRingPath(origin, axis, radius, cameraFrame) {
  const [u, v] = axisBasis(axis);
  let path = '', drawing = false;
  for (let step = 0; step <= 144; step++) {
    const angle = step / 144 * Math.PI * 2;
    let offset = u.map(value => value * Math.cos(angle) * radius);
    offset = offset.map((value, component) => value + v[component] * Math.sin(angle) * radius);
    const world = origin.map((value, component) => value + offset[component]);
    const toCamera = cameraFrame.projection === 'perspective'
      ? normalize3(cameraFrame.eye.map((value, component) => value - world[component]))
      : cameraFrame.forward.map(value => -value);
    if (dot3(offset, toCamera) < -.0001) { drawing = false; continue; }
    const point = projectViewportPoint(world);
    path += `${drawing ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)} `;
    drawing = true;
  }
  return path.trim();
}

function cameraRingPath(origin, radius, cameraFrame) {
  const points = Array.from({ length: 97 }, (_, step) => {
    const angle = step / 96 * Math.PI * 2;
    let point = addScaled3(origin, cameraFrame.right, Math.cos(angle) * radius);
    point = addScaled3(point, cameraFrame.up, Math.sin(angle) * radius);
    return projectViewportPoint(point);
  });
  return pointsPath(points, true);
}

function infiniteGuideMarkup(handle, width, height, axisClass) {
  const direction = [handle.screen[0], -handle.screen[1]];
  const center = [handle.centerX, handle.centerY];
  const candidates = [];
  if (Math.abs(direction[0]) > .0001) {
    for (const x of [0, width]) {
      const t = (x - center[0]) / direction[0];
      const y = center[1] + direction[1] * t;
      if (y >= 0 && y <= height) candidates.push([x, y, t]);
    }
  }
  if (Math.abs(direction[1]) > .0001) {
    for (const y of [0, height]) {
      const t = (y - center[1]) / direction[1];
      const x = center[0] + direction[0] * t;
      if (x >= 0 && x <= width) candidates.push([x, y, t]);
    }
  }
  candidates.sort((a, b) => a[2] - b[2]);
  if (candidates.length < 2) return '';
  const first = candidates[0], last = candidates[candidates.length - 1];
  return `<line class="drag-infinite-line ${axisClass}" x1="${first[0]}" y1="${first[1]}" x2="${last[0]}" y2="${last[1]}"/>`;
}

function updateTransformGizmo() {
  const gizmo = $('#transformGizmo');
  const item = selected();
  if (!item || !['move', 'resize', 'rotate'].includes(state.tool)
    || (state.tool === 'resize' && !['cube', 'shape'].includes(item.type))) {
    gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; state.gizmoAxes = null; state.gizmoCenter = null; return;
  }
  const rect = sceneCanvas.getBoundingClientRect();
  const width = rect.width, height = rect.height;
  const pivot = getTransformPivot(item);
  const geometryCenter = sceneRenderer.getGeometryCenter(state.project, item.uid) || pivot;
  const gizmoOrigin = state.tool === 'rotate' ? pivot : geometryCenter;
  const center = projectViewportPoint(gizmoOrigin);
  state.gizmoCenter = { x: center.x, y: center.y };
  const axes = getTransformAxes(item);
  const classes = ['x', 'y', 'z'];
  const cameraFrame = sceneRenderer.getCameraFrame();
  const pixelSample = projectViewportPoint(addScaled3(gizmoOrigin, cameraFrame.right, 1));
  const pixelWorld = 1 / Math.max(.0001, Math.hypot(pixelSample.x - center.x, pixelSample.y - center.y));
  const relativeAxisLength = pixelWorld * GIZMO_AXIS_PIXELS;
  const handles = axes.map((axis, index) => {
    const unitPoint = projectViewportPoint(addScaled3(gizmoOrigin, axis, 1));
    const pixelsPerUnit = Math.hypot(unitPoint.x - center.x, unitPoint.y - center.y);
    const screenDelta = [unitPoint.x - center.x, -(unitPoint.y - center.y), 0];
    const screen = Math.hypot(screenDelta[0], screenDelta[1]) > 1
      ? normalize3(screenDelta)
      : index === 1 ? [0, 1, 0] : [1, 0, 0];
    let positiveDistance = relativeAxisLength, negativeDistance = relativeAxisLength;
    if (state.tool === 'resize' && state.scaleHandleMode === 'bounds') {
      const extent = item.type === 'cube'
        ? Math.abs(item.size[index]) / 2
        : index === 1 ? Math.abs(item.parameters.height) / 2 : Math.abs(item.parameters.radius);
      positiveDistance = extent + pixelWorld * GIZMO_HEAD_GAP_PIXELS;
      negativeDistance = positiveDistance;
    }
    return { axis: index, vector: axis, screen, positiveDistance, negativeDistance,
      basisU: axes[(index + 1) % 3], basisV: axes[(index + 2) % 3],
      worldPerPixel: 1 / Math.max(pixelsPerUnit, .0001) };
  });
  state.gizmoAxes = handles.map(handle => ({ ...handle, centerX: center.x, centerY: center.y }));
  gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (state.tool === 'rotate') {
    const pixelsPerUnit = 1 / pixelWorld;
    const radius = 87 / pixelsPerUnit;
    const spherePath = cameraRingPath(gizmoOrigin, radius, cameraFrame);
    const rings = handles.map(handle => {
      const path = frontRingPath(gizmoOrigin, handle.vector, radius * .965, cameraFrame);
      return `<g class="gizmo-control axis-${classes[handle.axis]}" data-axis="${handle.axis}" data-kind="rotate">
        <path class="gizmo-hit rotate-hit" d="${path}"/><path class="gizmo-visible rotate-ring" d="${path}"/>
      </g>`;
    }).join('');
    gizmo.innerHTML = `<g class="gizmo-control sphere-control" data-axis="view" data-kind="rotate-view">
      <path class="gizmo-hit rotate-hit" d="${spherePath}"/><path class="gizmo-visible rotation-sphere" d="${spherePath}"/>
    </g>${rings}<circle class="gizmo-visible rotation-pivot" cx="${center.x}" cy="${center.y}" r="5"/>`;
  } else if (state.tool === 'move') {
    gizmo.innerHTML = `${handles.map(handle => coneMarkup({ ...handle, centerX: center.x, centerY: center.y }, gizmoOrigin, `axis-${classes[handle.axis]}`, pixelWorld)).join('')}
      <g class="gizmo-control center-control" data-axis="free" data-kind="free"><circle class="gizmo-hit-point" cx="${center.x}" cy="${center.y}" r="13"/><circle class="gizmo-visible center" cx="${center.x}" cy="${center.y}" r="5"/></g>`;
  } else {
    gizmo.innerHTML = handles.flatMap(handle => [-1, 1].map(sign => prismMarkup({ ...handle, centerX: center.x, centerY: center.y }, gizmoOrigin, `axis-${classes[handle.axis]}`, pixelWorld, sign))).join('');
  }
  if (state.dragging?.type === 'transform' && state.dragging.axisIndex !== null && ['move', 'resize'].includes(state.dragging.tool)) {
    const handle = state.gizmoAxes[state.dragging.axisIndex];
    gizmo.innerHTML = infiniteGuideMarkup(handle, width, height, `axis-${classes[state.dragging.axisIndex]}`) + gizmo.innerHTML;
  }
  if (state.dragging?.type === 'transform') {
    const axis = state.dragging.axisKey;
    const sign = state.dragging.axisIndex === null ? '' : `[data-sign="${state.dragging.sign}"]`;
    const active = gizmo.querySelector(`[data-axis="${axis}"]${sign}`) || gizmo.querySelector(`[data-axis="${axis}"]`);
    active?.classList.add('active');
    state.dragging.handleElement = active;
  }
  gizmo.removeAttribute('hidden');
}

function renderTexture() {
  textureCtx.imageSmoothingEnabled = false;
  const size = 16;
  const colors = ['#293521', '#3c4d2b', '#536b35', '#718c42', '#91ad52', '#b2ca69', '#d0dc8a'];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    const wave = Math.sin(x * 1.7 + y * .6) + Math.cos(y * 1.4 - x * .3);
    const index = Math.max(0, Math.min(colors.length - 1, Math.floor((wave + 2) / 4 * colors.length)));
    textureCtx.fillStyle = colors[index];
    textureCtx.fillRect(x * size, y * size, size, size);
    if ((x * 7 + y * 11) % 13 === 0) { textureCtx.fillStyle = '#d5df9a'; textureCtx.fillRect(x * size + 5, y * size + 4, 4, 4); }
  }
  sceneRenderer.setTexture(textureCanvas);
}

const paletteRows = [
  { id: crypto.randomUUID(), name: '苔原', gradient: false, marker: .5, colors: ['#172016','#273522','#3a4d2c','#526b35','#708d42','#91ad52','#b4ce68','#d3e18b','#e9efb3','#f5f5da','#c8a85a','#a77a3f','#76502f','#463324'] },
  { id: crypto.randomUUID(), name: '深潭', gradient: false, marker: .5, colors: ['#11191b','#1d2a29','#2b403a','#3b5b4c','#4b7560','#629178','#7aaf91','#9bc9aa','#c3dfc9','#f1f3dd','#8baab2','#587989','#365261','#263640'] },
  { id: crypto.randomUUID(), name: '暖岩', gradient: false, marker: .5, colors: ['#22191b','#402329','#663233','#8b443b','#b65e48','#d9805a','#eca875','#f6d09b','#f4e4c2','#8b705b','#66503e','#48382f','#2f2926','#1c1d19'] }
];

function renderPalette() {
  $('#paletteSummary').textContent = `${paletteRows.length} 行 · 每行獨立設定`;
  $('#paletteRows').innerHTML = paletteRows.map((row, index) => `
    <div class="palette-row-card" data-palette-id="${row.id}">
      <div class="palette-row-controls">
        <span class="palette-row-name" title="${escapeAttribute(row.name)}">${escapeHtml(row.name)}</span>
        <label class="row-gradient-toggle" title="此行使用連續漸變">
          <input type="checkbox" data-gradient-row="${index}" ${row.gradient ? 'checked' : ''} /> 漸變
        </label>
        <button class="delete-palette-row" data-delete-row="${index}" title="刪除此行">×</button>
      </div>
      ${row.gradient
        ? `<div class="gradient-picker" data-gradient-picker="${index}" style="background:linear-gradient(90deg, ${row.colors.join(', ')})"><i class="gradient-marker" style="left:${row.marker * 100}%"></i></div>`
        : `<div class="palette-row">${row.colors.map(color => `<button class="swatch" data-color="${color}" style="background:${color}" title="${color}"></button>`).join('')}</div>`}
    </div>`).join('');

  $$('.swatch').forEach(swatch => swatch.addEventListener('click', () => { snapshot(); applyPaletteColor(swatch.dataset.color); }));
  $$('[data-gradient-row]').forEach(toggle => toggle.addEventListener('change', () => {
    paletteRows[Number(toggle.dataset.gradientRow)].gradient = toggle.checked;
    renderPalette();
  }));
  $$('[data-delete-row]').forEach(button => button.addEventListener('click', () => {
    if (paletteRows.length === 1) return toast('至少保留一行色卡');
    paletteRows.splice(Number(button.dataset.deleteRow), 1);
    renderPalette();
  }));
  $$('[data-gradient-picker]').forEach(picker => {
    picker.addEventListener('pointerdown', event => {
      event.preventDefault(); snapshot(); picker.setPointerCapture(event.pointerId); pickGradientColor(picker, event);
    });
    picker.addEventListener('pointermove', event => { if (picker.hasPointerCapture(event.pointerId)) pickGradientColor(picker, event); });
  });
}

function addPaletteRow() {
  const number = paletteRows.length + 1;
  paletteRows.push({
    id: crypto.randomUUID(), name: `自定義 ${number}`, gradient: false, marker: .5,
    colors: ['#101410', '#283323', '#4c6338', '#78964d', '#a9c866', '#d8e79a', '#f1f3d0']
  });
  renderPalette();
  const rows = $('#paletteRows'); rows.scrollTop = rows.scrollHeight;
}

function pickGradientColor(picker, event) {
  const index = Number(picker.dataset.gradientPicker);
  const rect = picker.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  paletteRows[index].marker = ratio;
  picker.querySelector('.gradient-marker').style.left = `${ratio * 100}%`;
  applyPaletteColor(sampleGradient(paletteRows[index].colors, ratio), false);
}

function sampleGradient(colors, ratio) {
  if (colors.length === 1) return colors[0];
  const scaled = ratio * (colors.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(colors.length - 1, left + 1);
  const amount = scaled - left;
  const a = hexToRgb(colors[left]), b = hexToRgb(colors[right]);
  return `#${a.map((channel, axis) => Math.round(channel + (b[axis] - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function applyPaletteColor(color, notify = true) {
  const item = selected();
  if (!item) return toast('先選擇一個物件');
  item.color = color;
  markDirty(); renderAll('selection');
  if (notify) toast(`已套用 ${color}`);
}

function cycleSnap() {
  const values = [4, 8, 16, 32, 64];
  const next = values[(values.indexOf(state.snap) + 1) % values.length];
  configRegistry.set(ConfigKey.SNAP, next, { source: 'toolbar' });
  toast(`吸附精度 ${next}（${formatNumber(16 / next)} px）`);
}

function addLayer() {
  const list = $('.layer-list');
  $$('.layer-item', list).forEach(item => item.classList.remove('active'));
  const number = list.children.length + 1;
  const button = document.createElement('button');
  button.className = 'layer-item active';
  button.innerHTML = `<span class="layer-dot mid"></span><span>圖層 ${number}</span><small>100%</small>`;
  list.prepend(button);
  toast(`已新增圖層 ${number}`);
}

function importTexture(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    textureCanvas.width = image.naturalWidth;
    textureCanvas.height = image.naturalHeight;
    textureCtx.imageSmoothingEnabled = false;
    textureCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
    textureCtx.drawImage(image, 0, 0);
    sceneRenderer.setTexture(textureCanvas);
    renderScene();
    $('.texture-preview > span').textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
    $$('.texture-item').forEach(item => item.classList.remove('active'));
    const button = document.createElement('button');
    button.className = 'texture-item active';
    button.innerHTML = `<span class="texture-thumb" style="background-image:url('${url}');background-size:cover;image-rendering:pixelated"></span><span><strong>${escapeHtml(file.name)}</strong><small>${image.naturalWidth} × ${image.naturalHeight} · ${file.type.split('/')[1]?.toUpperCase() || 'IMAGE'}</small></span><i>◉</i>`;
    $('#textureList').prepend(button);
    toast(`已導入貼圖 ${file.name}`);
  };
  image.onerror = () => { URL.revokeObjectURL(url); toast('無法讀取這張圖片'); };
  image.src = url;
}

function loadTextureSource(source, name) {
  const image = new Image();
  image.onload = () => {
    textureCanvas.width = image.naturalWidth;
    textureCanvas.height = image.naturalHeight;
    textureCtx.imageSmoothingEnabled = false;
    textureCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
    textureCtx.drawImage(image, 0, 0);
    sceneRenderer.setTexture(textureCanvas);
    $('.texture-preview > span').textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
    const activeName = $('.texture-item.active strong');
    if (activeName) activeName.textContent = name;
    renderScene();
  };
  image.src = source;
}

function installProjectTextures(assets) {
  state.textureAssets = assets;
  if (!assets.length) return;
  const list = $('#textureList');
  list.innerHTML = '';
  assets.forEach((asset, index) => {
    const button = document.createElement('button');
    button.className = 'texture-item';
    button.dataset.textureIndex = String(index);
    button.innerHTML = `<span class="texture-thumb"></span><span><strong>${escapeHtml(asset.name || `texture_${index + 1}.png`)}</strong><small>${asset.uvWidth || '?'} × ${asset.uvHeight || '?'} · BBMODEL</small></span><i>◉</i>`;
    const thumbnail = button.querySelector('.texture-thumb');
    thumbnail.style.backgroundImage = `url("${asset.source}")`;
    thumbnail.style.backgroundSize = 'cover';
    thumbnail.style.imageRendering = 'pixelated';
    list.append(button);
  });
  const defaultIndex = assets.findIndex(asset => asset.useAsDefault);
  activateProjectTexture(defaultIndex >= 0 ? defaultIndex : 0);
}

function activateProjectTexture(index) {
  const asset = state.textureAssets[index];
  if (!asset) return;
  $$('.texture-item').forEach(item => item.classList.toggle('active', Number(item.dataset.textureIndex) === index));
  loadTextureSource(asset.source, asset.name);
}

function setMode(mode) {
  state.mode = mode;
  dockManager?.setMode(mode);
  $$('.mode-tab').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  $('.paint-tool').style.display = mode === 'paint' ? '' : 'none';
  $('#viewLabel').textContent = mode === 'paint' ? '貼圖預覽' : mode === 'animate' ? '動畫預覽' : '實體著色';
  if (mode === 'paint') activateDock('palette');
  if (mode === 'animate') activateDock('timeline');
  toast({ edit: '編輯模式', paint: '繪畫模式', animate: '動畫模式' }[mode]);
}

function setTool(tool) {
  state.tool = tool;
  $$('.tool').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  updateToolOptions();
  if (tool === 'cube') { addCube(); setTool('move'); }
  if (tool === 'shape') { addShape(); setTool('move'); }
  renderScene();
}

function updateToolOptions() {
  const lane = $('#toolOptionsLane');
  const labels = { move: '移動', resize: '縮放', rotate: '旋轉' };
  lane.hidden = !labels[state.tool];
  $('#transformSpaceControl').hidden = lane.hidden;
  $('#scaleHandleModeControl').hidden = state.tool !== 'resize';
  if (!lane.hidden) $('#toolContext').textContent = labels[state.tool];
  updateTransformSpaceButtons();
  updateScaleHandleModeButtons();
}

const renderModeLabels = Object.freeze({ wireframe: '線框', solid: '體塊', textured: '紋理' });

function updateRenderModeControl() {
  const label = renderModeLabels[state.renderMode] || renderModeLabels.textured;
  const button = $('#renderModeButton');
  button.dataset.mode = state.renderMode;
  button.dataset.tooltip = `目前：${label}`;
  button.title = `目前：${label}`;
  button.setAttribute('aria-label', `目前渲染模式：${label}`);
  $$('[data-render-mode]').forEach(option => option.classList.toggle('active', option.dataset.renderMode === state.renderMode));
}

function setRenderModeMenu(open) {
  $('#renderModeMenu').hidden = !open;
  $('#renderModeButton').setAttribute('aria-expanded', String(open));
}

function activateDock(name) {
  $$('.dock-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.dock === name));
  $$('[data-dock-view]').forEach(view => view.classList.toggle('active', view.dataset.dockView === name));
  dockManager?.expand('bottom');
}

async function openProject() {
  try {
    if (window.cubeBricksDesktop) {
      const result = await window.cubeBricksDesktop.openProject();
      if (!result) return;
      loadProjectContent(result.content, result.filePath, result.textureAssets || []);
    } else fileInput.click();
  } catch (error) { toast(`打開失敗：${error.message}`); }
}

function loadProjectContent(content, filePath = '', resolvedTextures = []) {
  const data = JSON.parse(content);
  snapshot();
  state.project = filePath.toLowerCase().endsWith('.bbmodel') || data.meta?.model_format ? importBlockbench(data) : new CubeBricksProject(data);
  state.filePath = filePath.toLowerCase().endsWith('.cbmodel') ? filePath : null;
  state.selectedUid = state.project.elements[0]?.uid || null;
  state.history.length = 0; state.future.length = 0;
  const embeddedTextures = (data.textures || []).filter(texture => typeof texture.source === 'string' && texture.source.startsWith('data:image/')).map(texture => ({
    uuid: texture.uuid, id: texture.id, name: texture.name || 'embedded_texture.png', source: texture.source,
    uvWidth: texture.uv_width, uvHeight: texture.uv_height, useAsDefault: texture.use_as_default === true
  }));
  installProjectTextures(resolvedTextures.length ? resolvedTextures : embeddedTextures);
  markDirty(!state.filePath); renderAll(); toast(`已打開 ${state.project.name}`);
}

async function saveProject(saveAs = false) {
  try {
    const content = state.project.serialize();
    if (window.cubeBricksDesktop) {
      const result = await window.cubeBricksDesktop.saveProject({ filePath: saveAs ? null : state.filePath, name: state.project.name, content });
      if (!result) return;
      state.filePath = result.filePath;
    } else download(content, `${state.project.name}.cbmodel`, 'application/json');
    markDirty(false); toast('項目已保存');
  } catch (error) { toast(`保存失敗：${error.message}`); }
}

function exportProject() {
  download(state.project.serialize(), `${state.project.name}.cbmodel`, 'application/json');
  toast('已導出 .cbmodel');
}

function download(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function newProject() {
  state.project = new CubeBricksProject({ name: 'untitled', elements: [new Cube({ name: 'cube' })] });
  state.selectedUid = state.project.elements[0].uid; state.filePath = null; state.history.length = 0; state.future.length = 0;
  markDirty(); renderAll(); toast('已建立新項目');
}

const themePresets = {
  moss: { '--accent': '#b9f55a', '--selection-outline': '#d8f59b', '--bg': '#11130f', '--panel': '#1b1f18', '--viewport': '#20251e' },
  ember: { '--accent': '#ff9d57', '--selection-outline': '#ffd0a6', '--bg': '#160f0e', '--panel': '#241917', '--viewport': '#291d1b' },
  slate: { '--accent': '#65d7e8', '--selection-outline': '#a7f0fa', '--bg': '#0d1115', '--panel': '#171e24', '--viewport': '#1b242b' }
};

function setThemeVar(key, value, persist = true) {
  document.documentElement.style.setProperty(key, value);
  if (key === '--accent') document.documentElement.style.setProperty('--accent-rgb', hexToRgb(value).join(', '));
  if (key === '--selection-outline') sceneRenderer.setSelectionOutline(value);
  if (key === '--radius') $('#radiusOutput').textContent = value;
  if (key === '--ui-scale') $('#scaleOutput').textContent = value;
  if (persist) saveTheme();
  renderScene();
}

function saveTheme() {
  const theme = {};
  $$('[data-theme-var]').forEach(input => theme[input.dataset.themeVar] = input.dataset.unit ? `${input.value}${input.dataset.unit}` : input.value);
  localStorage.setItem('cubebricks.theme', JSON.stringify(theme));
}

function loadTheme() {
  const raw = localStorage.getItem('cubebricks.theme');
  if (!raw) return;
  try {
    const theme = JSON.parse(raw);
    Object.entries(theme).forEach(([key, value]) => {
      setThemeVar(key, value, false);
      const input = $(`[data-theme-var="${key}"]`);
      if (input) input.value = String(value).replace(input.dataset.unit || '', '');
    });
  } catch { localStorage.removeItem('cubebricks.theme'); }
}

function applyPreset(name) {
  Object.entries(themePresets[name]).forEach(([key, value]) => {
    const input = $(`[data-theme-var="${key}"]`); if (input) input.value = value;
    setThemeVar(key, value, false);
  });
  saveTheme(); toast('外觀已套用');
}

function initializeConfigRegistry() {
  configRegistry.list().forEach(definition => applyRegisteredConfig(definition.id, configRegistry.get(definition.id), false));
  configRegistry.subscribe(change => applyRegisteredConfig(change.id, change.value, true));

  window.CubeBricks = Object.freeze({
    config: Object.freeze({
      get: id => configRegistry.get(id),
      set: (id, value) => configRegistry.set(id, value, { source: 'public-api' }),
      reset: id => configRegistry.reset(id, { source: 'public-api' }),
      list: () => configRegistry.list(),
      subscribe: (id, listener) => configRegistry.subscribe(id, listener)
    }),
    docks: Object.freeze({
      list: () => dockManager?.getIndex() || [],
      get: id => dockManager?.getIndex().find(panel => panel.id === id) || null
    })
  });
}

function applyRegisteredConfig(id, value, notify = false) {
  const control = $(`[data-config-key="${id}"]`);
  if (control) control.type === 'checkbox' ? control.checked = Boolean(value) : control.value = String(value);

  if (id === ConfigKey.LANGUAGE) {
    languageSelect.value = value; applyLanguage(value);
    if (notify) toast(`介面語言：${getLanguageLabel(value)}`);
  }
  if (id === ConfigKey.SNAP) {
    state.snap = value;
    $('#snapButton').textContent = `吸附 ${formatNumber(value)} · ${formatNumber(16 / value)}px`;
  }
  if (id === ConfigKey.ALLOW_NEGATIVE_SIZE) state.allowNegativeSize = value;
  if (id === ConfigKey.SHIFT_SNAP_MODE) state.modifierSnap.shift.mode = value;
  if (id === ConfigKey.SHIFT_SNAP_VALUE) state.modifierSnap.shift.value = value;
  if (id === ConfigKey.CTRL_SNAP_MODE) state.modifierSnap.ctrl.mode = value;
  if (id === ConfigKey.CTRL_SNAP_VALUE) state.modifierSnap.ctrl.value = value;
  if (id === ConfigKey.SHIFT_CTRL_SNAP_MODE) state.modifierSnap.shiftCtrl.mode = value;
  if (id === ConfigKey.SHIFT_CTRL_SNAP_VALUE) state.modifierSnap.shiftCtrl.value = value;
  if (id === ConfigKey.SYMMETRY) { state.symmetry = value; $('#symmetryToggle').checked = value; }
  if (id === ConfigKey.ALPHA_LOCK) { state.alphaLock = value; $('#alphaLockToggle').checked = value; }
  if (id === ConfigKey.PREVIEW_SHADE) { state.previewShade = value; $('#previewShadeToggle').checked = value; }
  if (id === ConfigKey.SHOW_GEOMETRY_ONLY) { state.geometryOnly = value; $('#geometryOnlyToggle').checked = value; }
  if (id === ConfigKey.PROJECTION) {
    if (state.projection && state.projection !== value) {
      state.zoom = mapProjectionZoom(state.zoom, state.projection, value);
    }
    state.projection = value;
    $$('[data-projection]').forEach(button => button.classList.toggle('active', button.dataset.projection === value));
  }
  if (id === ConfigKey.SHOW_GRID) state.grid = value;
  if (id === ConfigKey.SHOW_WIREFRAME) state.wire = value;
  if (notify && id !== ConfigKey.LANGUAGE) renderScene();
}

function mapProjectionZoom(zoom, fromProjection, toProjection) {
  if (fromProjection === toProjection) return zoom;
  const perspectiveHalfHeightAtUnitZoom = 42 * Math.tan(45 * Math.PI / 360);
  const orthographicHalfHeightAtUnitZoom = 18;
  const mapped = fromProjection === 'perspective' && toProjection === 'orthographic'
    ? zoom * orthographicHalfHeightAtUnitZoom / perspectiveHalfHeightAtUnitZoom
    : zoom * perspectiveHalfHeightAtUnitZoom / orthographicHalfHeightAtUnitZoom;
  return Math.max(.002, Math.min(100, mapped));
}

function setConfigFromControl(control) {
  const definition = configRegistry.getDefinition(control.dataset.configKey);
  let value = control.type === 'checkbox' ? control.checked : control.value;
  if (definition.type === 'number') value = Number(value);
  if (definition.type === 'enum') value = definition.options.find(option => String(option.value) === String(value))?.value;
  try {
    configRegistry.set(definition.id, value, { source: 'settings-panel' });
  } catch {
    control.type === 'checkbox' ? control.checked = Boolean(configRegistry.get(definition.id)) : control.value = String(configRegistry.get(definition.id));
    toast('這個配置值無效');
  }
}

function initializeDockSystem() {
  dockManager = new DockManager({
    root: $('.workspace'),
    definitions: DOCK_PANEL_DEFINITIONS,
    onInteraction: active => { state.layoutResizing = active; },
    onLayoutChange: () => {
      scheduleOutlinerWindow();
      requestAnimationFrame(renderScene);
    }
  });
  dockManager.setMode(state.mode);
}

function bindEvents() {
  $$('.mode-tab').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $$('.tool').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
  $$('.dock-tab').forEach(button => button.addEventListener('click', () => activateDock(button.dataset.dock)));
  $('[data-action="addCube"]').addEventListener('click', addCube);
  $('[data-action="addGroup"]').addEventListener('click', addGroup);
  $('[data-action="new"]').addEventListener('click', newProject);
  $('[data-action="open"]').addEventListener('click', openProject);
  $('[data-action="save"]').addEventListener('click', () => saveProject(false));
  $('[data-action="export"]').addEventListener('click', exportProject);
  $('[data-action="undo"]').addEventListener('click', undo);
  $('[data-action="redo"]').addEventListener('click', redo);
  $('[data-action="theme"]').addEventListener('click', () => themeDialog.showModal());
  $$('[data-settings-page]').forEach(button => button.addEventListener('click', () => {
    $$('[data-settings-page]').forEach(entry => entry.classList.toggle('active', entry === button));
    $$('[data-settings-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.settingsPanel === button.dataset.settingsPage));
  }));
  languageSelect.addEventListener('change', event => {
    configRegistry.set(ConfigKey.LANGUAGE, event.target.value, { source: 'appearance-dialog' });
  });
  $$('[data-config-key]').forEach(control => control.addEventListener('change', () => setConfigFromControl(control)));
  $('#symmetryToggle').addEventListener('change', event => configRegistry.set(ConfigKey.SYMMETRY, event.target.checked, { source: 'toolbar' }));
  $('#alphaLockToggle').addEventListener('change', event => configRegistry.set(ConfigKey.ALPHA_LOCK, event.target.checked, { source: 'toolbar' }));
  $('#previewShadeToggle').addEventListener('change', event => configRegistry.set(ConfigKey.PREVIEW_SHADE, event.target.checked, { source: 'toolbar' }));
  $('#geometryOnlyToggle').addEventListener('change', event => configRegistry.set(ConfigKey.SHOW_GEOMETRY_ONLY, event.target.checked, { source: 'toolbar' }));
  $$('[data-transform-space]').forEach(button => button.addEventListener('click', () => {
    state.transformSpace = button.dataset.transformSpace;
    updateTransformSpaceButtons();
    renderScene();
  }));
  $$('[data-scale-handle-mode]').forEach(button => button.addEventListener('click', () => {
    state.scaleHandleMode = button.dataset.scaleHandleMode;
    updateScaleHandleModeButtons();
    renderScene();
  }));
  $('[data-action="grid"]').addEventListener('click', () => configRegistry.set(ConfigKey.SHOW_GRID, !state.grid, { source: 'viewport-toolbar' }));
  $('[data-action="wire"]').addEventListener('click', () => configRegistry.set(ConfigKey.SHOW_WIREFRAME, !state.wire, { source: 'viewport-toolbar' }));
  $('[data-action="cycleSnap"]').addEventListener('click', cycleSnap);
  $('[data-action="frame"]').addEventListener('click', focusSelected);
  $$('[data-projection]').forEach(button => button.addEventListener('click', () => {
    configRegistry.set(ConfigKey.PROJECTION, button.dataset.projection, { source: 'viewport-toolbar' });
  }));
  $('#renderModeButton').addEventListener('click', event => {
    event.stopPropagation();
    setRenderModeMenu($('#renderModeMenu').hidden);
  });
  $$('[data-render-mode]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    state.renderMode = button.dataset.renderMode;
    updateRenderModeControl();
    setRenderModeMenu(false);
    renderScene();
  }));
  document.addEventListener('click', event => {
    if (!event.target.closest('#viewportRenderMenu')) setRenderModeMenu(false);
  });
  $('#minecraftRenderType').addEventListener('change', event => {
    snapshot();
    state.project.renderType = event.target.value;
    markDirty();
    renderScene();
  });
  $('#cullFaces').addEventListener('change', event => {
    snapshot();
    state.project.cullFaces = event.target.checked;
    markDirty();
    renderScene();
  });
  $('[data-action="addTexture"]').addEventListener('click', () => textureInput.click());
  $('[data-action="addLayer"]').addEventListener('click', addLayer);
  $('[data-action="openUv"]').addEventListener('click', () => { setMode('paint'); toast('UV 編輯視圖已啟用'); });
  $('[data-action="openColorMap"]').addEventListener('click', () => { activateDock('palette'); toast('色階映射面板已啟用'); });
  $('[data-action="playTimeline"]').addEventListener('click', playTimeline);
  $('[data-action="stopTimeline"]').addEventListener('click', stopTimeline);
  $('[data-action="addPaletteRow"]').addEventListener('click', addPaletteRow);
  $('#outlinerSearch').addEventListener('input', renderOutliner);
  outliner.addEventListener('scroll', scheduleOutlinerWindow, { passive: true });
  outliner.addEventListener('click', event => {
    const button = event.target.closest('[data-uid]');
    if (!button) return;
    const visibility = event.target.closest('[data-toggle-visible]');
    if (visibility) {
      const node = state.project.getNode(visibility.dataset.toggleVisible);
      node.visible = !node.visible; markDirty(); renderAll(); return;
    }
    const disclosure = event.target.closest('[data-disclosure]');
    if (disclosure?.dataset.disclosure) {
      const uidValue = disclosure.dataset.disclosure;
      state.collapsedGroups.has(uidValue) ? state.collapsedGroups.delete(uidValue) : state.collapsedGroups.add(uidValue);
      renderOutliner(); return;
    }
    selectItem(button.dataset.uid);
  });
  $$('[data-theme-var]').forEach(input => input.addEventListener('input', () => setThemeVar(input.dataset.themeVar, `${input.value}${input.dataset.unit || ''}`)));
  $$('[data-preset]').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
  $('[data-action="resetTheme"]').addEventListener('click', () => {
    localStorage.removeItem('cubebricks.theme'); applyPreset('moss');
    setThemeVar('--radius', '10px'); setThemeVar('--ui-scale', '100%');
    configRegistry.resetAll();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; if (!file) return;
    try { loadProjectContent(await file.text(), file.name); } catch (error) { toast(`文件無法讀取：${error.message}`); }
    fileInput.value = '';
  });
  textureInput.addEventListener('change', () => {
    importTexture(textureInput.files[0]);
    textureInput.value = '';
  });
  $('#textureList').addEventListener('click', event => {
    const item = event.target.closest('.texture-item'); if (!item) return;
    $$('.texture-item').forEach(entry => entry.classList.toggle('active', entry === item));
    if (item.dataset.textureIndex !== undefined) activateProjectTexture(Number(item.dataset.textureIndex));
  });
  $$('[data-view-axis]').forEach(button => button.addEventListener('click', () => {
    const axis = button.dataset.viewAxis;
    if (axis === 'x') { state.yaw = Math.PI / 2; state.pitch = 0; }
    if (axis === 'y') { state.yaw = 0; state.pitch = Math.PI / 2 - .001; }
    if (axis === 'z') { state.yaw = 0; state.pitch = 0; }
    renderScene();
  }));
  $('#transformGizmo').addEventListener('pointerdown', event => {
    if (event.button === 1) {
      event.preventDefault(); event.stopPropagation();
      startCameraDrag(event, event.currentTarget);
      return;
    }
    if (event.button !== 0) return;
    const handle = event.target.closest('[data-axis]');
    if (!handle) return;
    event.preventDefault(); event.stopPropagation();
    const axisKey = handle.dataset.axis;
    const axisIndex = /^[0-2]$/.test(axisKey) ? Number(axisKey) : null;
    startTransformDrag(event, axisIndex, event.currentTarget, handle.dataset.kind || 'free', Number(handle.dataset.sign || 1), handle, axisKey);
  });
  $('#transformGizmo').addEventListener('pointermove', onPointerMove);
  $('#transformGizmo').addEventListener('pointerup', endPointerDrag);
  $('#transformGizmo').addEventListener('pointercancel', endPointerDrag);
  $('.layer-list').addEventListener('click', event => {
    const item = event.target.closest('.layer-item'); if (!item) return;
    $$('.layer-item').forEach(entry => entry.classList.toggle('active', entry === item));
  });
  sceneCanvas.addEventListener('pointerdown', onPointerDown);
  sceneCanvas.addEventListener('pointermove', onPointerMove);
  sceneCanvas.addEventListener('pointerup', endPointerDrag);
  sceneCanvas.addEventListener('pointercancel', endPointerDrag);
  sceneCanvas.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
  sceneCanvas.addEventListener('wheel', event => { event.preventDefault(); state.zoom = Math.max(.002, Math.min(100, state.zoom * (event.deltaY > 0 ? .9 : 1.1))); renderScene(); }, { passive: false });
  window.addEventListener('resize', renderScene);
  window.addEventListener('keydown', event => {
    if (event.target.matches('input,select')) return;
    if (event.key === 'Escape') setRenderModeMenu(false);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(event.shiftKey); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if (event.key === 'Delete') deleteSelected();
    if (event.key.toLowerCase() === 'f') { state.zoom = 1.12; state.panX = 0; state.panY = 0; renderScene(); }
    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      event.shiftKey ? focusSceneOrigin() : focusSelected();
    }
    const shortcuts = { '1': 'move', '2': 'resize', '3': 'rotate' }; if (shortcuts[event.key]) setTool(shortcuts[event.key]);
  });
}

let timelineAnimation = null;
let timelineLastTime = 0;

function playTimeline() {
  if (state.timelinePlaying) return;
  state.timelinePlaying = true;
  timelineLastTime = performance.now();
  $('[data-action="playTimeline"]').textContent = '❚❚';
  const tick = now => {
    if (!state.timelinePlaying) return;
    state.timelineFrame = (state.timelineFrame + (now - timelineLastTime) / 1000 * 24) % 48;
    timelineLastTime = now;
    updateTimelineUI();
    timelineAnimation = requestAnimationFrame(tick);
  };
  timelineAnimation = requestAnimationFrame(tick);
}

function stopTimeline() {
  state.timelinePlaying = false;
  state.timelineFrame = 0;
  if (timelineAnimation) cancelAnimationFrame(timelineAnimation);
  timelineAnimation = null;
  $('[data-action="playTimeline"]').textContent = '▶';
  updateTimelineUI();
}

function updateTimelineUI() {
  const frame = Math.floor(state.timelineFrame);
  const seconds = Math.floor(frame / 24);
  $('#timelineTime').textContent = `00:00:${String(seconds).padStart(2, '0')}:${String(frame % 24).padStart(2, '0')}`;
  $('#timelineRuler').style.setProperty('--playhead', `${state.timelineFrame / 48 * 100}%`);
}

function onPointerDown(event) {
  const rect = sceneCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  if (event.button === 1) {
    startCameraDrag(event, sceneCanvas);
    return;
  }
  if (event.button !== 0) return;
  const hitUid = sceneRenderer.pick(state.project, x, y, state.geometryOnly);
  if (hitUid && hitUid !== state.selectedUid) selectItem(hitUid);
}

function startCameraDrag(event, captureTarget) {
  event.preventDefault();
  captureTarget.setPointerCapture(event.pointerId);
  bakeCameraPan();
  const frame = sceneRenderer.getCameraFrame();
  state.dragging = event.shiftKey
    ? {
        type: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        target: [...state.target], right: [...frame.right], up: [...frame.up], worldPerPixel: frame.worldPerPixel
      }
    : { type: 'orbit', pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
  sceneCanvas.classList.add(event.shiftKey ? 'is-panning' : 'is-orbiting');
}

const CUBE_FACE_NAMES = ['north', 'east', 'south', 'west', 'up', 'down'];

function freezeCubeUvs(cube) {
  const existing = cube.faces || {};
  cube.faces = Object.fromEntries(CUBE_FACE_NAMES.map(faceName => {
    const face = { ...(existing[faceName] || {}) };
    face.uv = Array.isArray(face.uv) && face.uv.length >= 4
      ? [...face.uv]
      : [...getBlockbenchBoxUv(cube, faceName)];
    return [faceName, face];
  }));
}

function startTransformDrag(event, axisIndex, captureTarget, kind = 'free', sign = 1, handleElement = null, axisKey = axisIndex === null ? 'free' : String(axisIndex)) {
  if (event.button !== 0) return;
  const item = selected();
  if (!item || !['move', 'resize', 'rotate'].includes(state.tool)) return;
  const rect = sceneCanvas.getBoundingClientRect();
  let handle = axisIndex === null ? null : state.gizmoAxes?.[axisIndex];
  if (kind === 'rotate-view') {
    const cameraFrame = sceneRenderer.getCameraFrame();
    handle = {
      vector: [...cameraFrame.forward], screen: [1, 0, 0], worldPerPixel: cameraFrame.worldPerPixel,
      centerX: state.gizmoCenter.x, centerY: state.gizmoCenter.y
    };
  }
  const chain = state.project.getGroupChain(item.uid);
  let storedAxis = handle ? handle.vector.map(value => value * sign) : null;
  let rotationAxis = null;
  let rotationScreenSign = 1;
  if (storedAxis) {
    if (kind === 'rotate' || kind === 'rotate-view') {
      const cameraFrame = sceneRenderer.getCameraFrame();
      const toCamera = cameraFrame.forward.map(value => -value);
      rotationScreenSign = dot3(handle.vector, toCamera) >= 0 ? -1 : 1;
      rotationAxis = [...storedAxis];
      chain.forEach(group => { rotationAxis = inverseRotateVector(rotationAxis, group.rotation || [0, 0, 0]); });
      if (state.transformSpace === 'self' && kind === 'rotate') rotationAxis = [0, 0, 0].map((_, index) => index === axisIndex ? 1 : 0);
    } else {
      chain.forEach(group => { storedAxis = inverseRotateVector(storedAxis, group.rotation || [0, 0, 0]); });
      if (state.tool === 'resize' && item.type !== 'group') storedAxis = inverseRotateVector(storedAxis, item.rotation || [0, 0, 0]);
    }
  }
  captureTarget.setPointerCapture(event.pointerId);
  handleElement?.classList.add('active');
  state.dragging = {
    type: 'transform', tool: state.tool, pointerId: event.pointerId,
    snapshotTaken: false,
    x: event.clientX, y: event.clientY, item, axisIndex, axisKey, axis: handle ? { ...handle, screen: handle.screen.map(value => value * sign) } : null,
    kind, sign, rotationAxis, rotationScreenSign, handleElement, gizmoCenter: handle ? { x: handle.centerX + rect.left, y: handle.centerY + rect.top } : null,
    startAngle: kind.startsWith('rotate') && handle ? Math.atan2(event.clientY - (handle.centerY + rect.top), event.clientX - (handle.centerX + rect.left)) : 0,
    rect, storedAxis, chain,
    position: item.position ? [...item.position] : item.origin ? [...item.origin] : item.pivot ? [...item.pivot] : [0, 0, 0],
    pivot: item.pivot ? [...item.pivot] : null,
    size: item.size ? [...item.size] : null,
    rotation: [...(item.rotation || [0, 0, 0])],
    radius: item.parameters?.radius,
    height: item.parameters?.height,
    uvFrozen: false,
    groupMembers: item.type === 'group' ? captureGroupMembers(item) : []
  };
  sceneRenderer.beginTransformGhost();
  $('#transformTooltip').hidden = true;
  sceneCanvas.classList.add(`is-${state.tool}`);
}

function onPointerMove(event) {
  if (!state.dragging) return;
  const dx = event.clientX - state.dragging.x;
  const dy = event.clientY - state.dragging.y;
  if (state.dragging.type === 'transform') {
    if (Math.hypot(dx, dy) < .5) return;
    if (!state.dragging.snapshotTaken) {
      snapshot();
      state.dragging.snapshotTaken = true;
    }
    if (state.dragging.tool === 'resize' && state.dragging.item.type === 'cube' && !state.dragging.uvFrozen) {
      freezeCubeUvs(state.dragging.item);
      state.dragging.uvFrozen = true;
    }
    applyTransformDrag(state.dragging, dx, dy, event);
    updateTransformTooltip(event, state.dragging);
    sceneRenderer.invalidateSelectionGeometry();
    markDirty();
    syncInspectorValues(state.dragging.item);
    renderScene();
    return;
  } else if (state.dragging.type === 'pan') {
    state.target = [0, 1, 2].map(axis => state.dragging.target[axis]
      - state.dragging.right[axis] * dx * state.dragging.worldPerPixel
      + state.dragging.up[axis] * dy * state.dragging.worldPerPixel);
  } else {
    const fullTurn = Math.PI * 2;
    state.yaw = ((state.dragging.yaw - dx * .01) % fullTurn + fullTurn) % fullTurn;
    state.pitch = Math.max(-Math.PI / 2 + .001, Math.min(Math.PI / 2 - .001, state.dragging.pitch + dy * .01));
  }
  renderScene();
}

function endPointerDrag(event) {
  if (!state.dragging) return;
  const finishedDrag = state.dragging;
  state.dragging.handleElement?.classList.remove('active');
  const captureTarget = event.currentTarget;
  if (captureTarget.hasPointerCapture?.(event.pointerId)) captureTarget.releasePointerCapture(event.pointerId);
  state.dragging = null;
  if (finishedDrag.type === 'transform' && finishedDrag.snapshotTaken) {
    sceneRenderer.commitSelectionGeometry(state.project, state.selectedUid);
  }
  sceneRenderer.endTransformGhost();
  $('#transformTooltip').hidden = true;
  sceneCanvas.classList.remove('is-orbiting', 'is-panning', 'is-move', 'is-resize', 'is-rotate');
  renderScene();
}

function applyTransformDrag(drag, dx, dy, event) {
  const item = drag.item;
  const axisDelta = drag.kind.startsWith('rotate') && drag.axis
    ? (() => {
      const angle = Math.atan2(event.clientY - drag.gizmoCenter.y, event.clientX - drag.gizmoCenter.x);
      let delta = angle - drag.startAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      return delta * 180 / Math.PI * drag.rotationScreenSign;
    })()
    : drag.axis
    ? (dx * drag.axis.screen[0] + -dy * drag.axis.screen[1]) * drag.axis.worldPerPixel
    : null;
  const fallbackScale = drag.axis?.worldPerPixel || (state.projection === 'perspective'
    ? 2 * (42 / state.zoom) * Math.tan(Math.PI / 8) / drag.rect.height
    : 36 / (drag.rect.height * state.zoom));
  if (drag.tool === 'move') {
    let delta;
    if (drag.axis) {
      const snappedDistance = snapValue(axisDelta, event);
      delta = drag.storedAxis.map(value => value * snappedDistance);
    }
    else {
      const frame = sceneRenderer.getCameraFrame();
      const worldDelta = [0, 1, 2].map(axis => frame.right[axis] * dx * fallbackScale + frame.up[axis] * -dy * fallbackScale);
      delta = [...worldDelta];
      drag.chain.forEach(group => { delta = inverseRotateVector(delta, group.rotation || [0, 0, 0]); });
    }
    const next = drag.axis
      ? drag.position.map((value, axis) => value + delta[axis])
      : drag.position.map((value, axis) => snapValue(value + delta[axis], event));
    drag.tooltipText = `距離 ${formatSigned(Math.hypot(...next.map((value, axis) => value - drag.position[axis])))} px`;
    if (item.type === 'cube') {
      const applied = next.map((value, axis) => value - drag.position[axis]);
      item.position = next;
      item.pivot = drag.pivot.map((value, axis) => value + applied[axis]);
    } else if (item.type === 'locator') item.position = next;
    else if (item.type === 'shape') item.origin = next;
    else if (item.type === 'group') {
      const delta = next.map((value, axis) => value - drag.position[axis]);
      item.pivot = next;
      drag.groupMembers.forEach(member => {
        if (member.node.type === 'cube') {
          member.node.position = member.position.map((value, axis) => value + delta[axis]);
          member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
        } else if (member.node.type === 'shape') member.node.origin = member.position.map((value, axis) => value + delta[axis]);
        else if (member.node.type === 'locator') member.node.position = member.position.map((value, axis) => value + delta[axis]);
        else member.node.pivot = member.position.map((value, axis) => value + delta[axis]);
      });
    }
  }
  if (drag.tool === 'resize') {
    if (item.type === 'cube') {
      const size = [...drag.size];
      const targetAxis = drag.axis ? drag.axisIndex : 0;
      const requestedChange = drag.axis ? snapValue(axisDelta, event) : snapValue(dx * fallbackScale, event);
      const proposedSize = drag.size[targetAxis] + requestedChange;
      size[targetAxis] = state.allowNegativeSize ? proposedSize : Math.max(0, proposedSize);
      const appliedChange = size[targetAxis] - drag.size[targetAxis];
      if (drag.axis && drag.sign < 0) item.position = drag.position.map((value, component) => value + drag.storedAxis[component] * appliedChange);
      item.size = size;
      drag.tooltipText = `尺寸 ${'XYZ'[targetAxis]} ${formatNumber(size[targetAxis])} px`;
    }
    if (item.type === 'shape') {
      if (drag.axisIndex === 1) item.parameters.height = Math.max(0, snapValue(drag.height + axisDelta, event));
      else item.parameters.radius = Math.max(0, snapValue(drag.radius + (axisDelta ?? dx * fallbackScale), event));
      drag.tooltipText = `${drag.axisIndex === 1 ? '高度' : '半徑'} ${formatNumber(drag.axisIndex === 1 ? item.parameters.height : item.parameters.radius)} px`;
    }
  }
  if (drag.tool === 'rotate') {
    const angleStep = Math.max(.1, 15 * getSnapStep(event));
    const angle = drag.axis ? axisDelta : (dx - dy) * .4;
    if (drag.axis) {
      const snappedDelta = snapAngle(angle, angleStep);
      const turn = quaternionFromAxisAngle(drag.rotationAxis, snappedDelta);
      const current = quaternionFromEuler(drag.rotation);
      item.rotation = eulerFromQuaternion(state.transformSpace === 'self' && drag.kind !== 'rotate-view'
        ? quaternionMultiply(current, turn)
        : quaternionMultiply(turn, current));
      drag.tooltipText = `角度 ${formatSigned(snappedDelta)}°`;
    } else {
      item.rotation = [snapAngle(drag.rotation[0] - dy * .4, angleStep), snapAngle(drag.rotation[1] + dx * .4, angleStep), drag.rotation[2]];
      drag.tooltipText = `角度 ${formatSigned(Math.hypot(dx, dy) * .4)}°`;
    }
  }
}

function updateTransformTooltip(event, drag) {
  const tooltip = $('#transformTooltip');
  const viewportRect = $('#viewport').getBoundingClientRect();
  tooltip.textContent = drag.tooltipText || '';
  tooltip.style.left = `${Math.max(8, Math.min(viewportRect.width - 150, event.clientX - viewportRect.left + 14))}px`;
  tooltip.style.top = `${Math.max(28, event.clientY - viewportRect.top - 10)}px`;
  tooltip.hidden = !drag.tooltipText;
}

function captureGroupMembers(group) {
  const members = [];
  const visit = uidValue => {
    const node = state.project.getNode(uidValue); if (!node) return;
    if (node.type === 'group') {
      if (node !== group) members.push({ node, position: [...node.pivot] });
      node.children.forEach(visit);
    } else if (node.type === 'cube') members.push({ node, position: [...node.position], pivot: [...node.pivot] });
    else if (node.type === 'locator') members.push({ node, position: [...node.position] });
    else members.push({ node, position: [...node.origin] });
  };
  group.children.forEach(visit);
  return members;
}

function getSnapSubdivisions(event = {}) {
  const modifier = event.shiftKey && event.ctrlKey
    ? state.modifierSnap.shiftCtrl
    : event.shiftKey
      ? state.modifierSnap.shift
      : event.ctrlKey
        ? state.modifierSnap.ctrl
        : null;
  if (!modifier) return state.snap;
  return modifier.mode === 'multiplier' ? state.snap * modifier.value : modifier.value;
}

function getSnapStep(event = {}) { return 16 / Math.max(.0001, getSnapSubdivisions(event)); }
function snapValue(value, event) { const step = getSnapStep(event); return Math.round(value / step) * step; }
function snapAngle(value, step) { return Math.round(value / step) * step; }
function formatNumber(value) { return Number(value.toFixed(4)).toString(); }
function formatSigned(value) { const rounded = formatNumber(value); return value > 0 ? `+${rounded}` : rounded; }

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function escapeAttribute(value) { return escapeHtml(value).replaceAll('"', '&quot;'); }
function round(value) { return Math.round(value * 100) / 100; }
function hexToRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

initializeDockSystem();
initializeConfigRegistry();
loadTheme();
sceneRenderer.setSelectionOutline(getComputedStyle(document.documentElement).getPropertyValue('--selection-outline').trim());
renderTexture();
renderPalette();
bindEvents();
renderAll();
markDirty(false);
