import { Cube, Group, Locator, Shape, CubeBricksProject, chooseKnifeCutAxis, getKnifeFaceAxes, importBlockbench, setPivotPreservingGeometry, splitCubeAt } from './model.js';
import { ConfigKey, applyLanguage, configRegistry, getLanguageLabel } from './config/app-config.js';
import { WebGLSceneRenderer, applyGroupTransforms, getBlockbenchBoxUv } from './render/webgl-renderer.js';
import { DockManager } from './ui/dock-manager.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const LOCATOR_ICON_SHAPES = '<path d="M98.74,144.52c-38.86,0-72.06-19.5-85.3-46.99-1.11,4.43-1.7,9-1.7,13.69,0,38.28,38.95,69.32,87,69.32s87-31.03,87-69.32c0-4.69-.59-9.26-1.7-13.69-13.24,27.49-46.44,46.99-85.3,46.99Z"/><rect x="81.01" y="56.54" width="35.47" height="96.98"/><rect x="59.53" y="77.83" width="78.43" height="25.75" rx="7.93" ry="7.93"/><path d="M98.74,0c-18.89,0-34.21,15.31-34.21,34.21s15.31,34.21,34.21,34.21,34.21-15.31,34.21-34.21S117.63,0,98.74,0ZM98.74,49.2c-8.28,0-14.99-6.71-14.99-14.99s6.71-14.99,14.99-14.99,14.99,6.71,14.99,14.99-6.71,14.99-14.99,14.99Z"/><path d="M26.73,85.59l17.01,31.01c1.89,3.45-.6,7.66-4.54,7.66H5.18c-3.93,0-6.43-4.22-4.54-7.66l17.01-31.01c1.96-3.58,7.11-3.58,9.07,0Z"/><path d="M179.83,85.59l17.01,31.01c1.89,3.45-.6,7.66-4.54,7.66h-34.03c-3.93,0-6.43-4.22-4.54-7.66l17.01-31.01c1.96-3.58,7.11-3.58,9.07,0Z"/><path d="M97.08,188.46l-18.84-16.15c-1.8-1.55-.71-4.5,1.67-4.5h37.68c2.38,0,3.47,2.96,1.67,4.5l-18.84,16.15c-.96.82-2.37.82-3.33,0Z"/>';
const TOOL_REGISTRY = Object.freeze({
  move: { modes: ['edit', 'animate'] },
  resize: { modes: ['edit', 'animate'] },
  rotate: { modes: ['edit', 'animate'] },
  pivot: { modes: ['edit'] },
  vertexSnap: { modes: ['edit'] },
  knife: { modes: ['edit'] },
  brush: { modes: ['paint'] }
});

const state = {
  project: new CubeBricksProject({ name: 'untitled' }),
  selectedUid: null,
  selectedUids: new Set(),
  selectionAnchorUid: null,
  mode: 'edit',
  tool: 'move',
  filePath: null,
  dirty: false,
  grid: configRegistry.get(ConfigKey.SHOW_GRID),
  wire: configRegistry.get(ConfigKey.SHOW_WIREFRAME),
  renderMode: 'textured',
  transformSpace: 'global',
  multiTransformMode: 'unified',
  rotationMode: 'pose',
  scaleHandleMode: 'fixed',
  knifeSelection: null,
  knifeHover: null,
  knifePointer: null,
  vertexSnapSource: null,
  vertexSnapMode: 'move',
  vertexSnapRotationMode: 'pivot',
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
  textureGroups: [],
  activeTextureUid: null,
  timelinePlaying: false,
  timelineFrame: 0,
  layoutResizing: false
};

const DOCK_PANEL_DEFINITIONS = Object.freeze([
  { id: 'texture', index: 0, modes: ['edit', 'paint'], defaultDock: 'left', defaultOrder: 0, defaultPosition: { x: 24, y: 104 }, defaultSize: { width: 236, height: 620 }, defaultCollapsed: false },
  { id: 'inspector', index: 1, modes: ['edit', 'paint', 'animate'], defaultDock: 'right', defaultOrder: 0, defaultPosition: { x: 920, y: 104 }, defaultSize: { width: 292, height: 340 }, defaultCollapsed: false },
  { id: 'outliner', index: 2, modes: ['edit', 'paint', 'animate'], defaultDock: 'right', defaultOrder: 1, defaultPosition: { x: 920, y: 460 }, defaultSize: { width: 292, height: 340 }, defaultCollapsed: false },
  { id: 'bottom', index: 3, modes: ['paint', 'animate'], defaultDock: 'bottom', defaultOrder: 0, defaultPosition: { x: 280, y: 620 }, defaultSize: { width: 720, height: 176 }, defaultCollapsed: false }
]);

state.selectedUid = state.project.elements[0]?.uid;
if (state.selectedUid) state.selectedUids.add(state.selectedUid);

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
let outlinerDragGhost = null;
let dockManager = null;
let cameraFocusFrame = null;

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
  state.selectedUids = new Set(state.selectedUid ? [state.selectedUid] : []);
  state.selectionAnchorUid = state.selectedUid;
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
  $('#selectionName').textContent = state.selectedUids.size > 1 ? `已選 ${state.selectedUids.size} 項` : item?.name || state.project.name;
  $('#uidChip').textContent = item?.uid || '—';
  const selectedCount = selectedElementUids().length;
  const counter = $('#outlinerSelectionCount');
  if (counter) counter.textContent = `${selectedCount}/${state.project.elements.length}`;
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
  windowNode.innerHTML = rows.slice(start, end).map(({ node, depth, group, collapsed }) => `<button class="outliner-item ${state.selectedUids.has(node.uid) ? 'active' : ''}" data-uid="${node.uid}" draggable="true" style="padding-left:${5 + depth * 13}px">
      ${group ? openIconMarkup(collapsed ? 'right' : 'down', 'outliner-disclosure', `data-disclosure="${node.uid}"`) : '<span></span>'}
      <span class="kind">${outlinerKindMarkup(node)}</span>
      <span class="item-name">${escapeHtml(node.name)}</span><span class="eye" data-toggle-visible="${node.uid}">${node.visible ? '◉' : '○'}</span>
    </button>`).join('');
}

function outlinerKindMarkup(node) {
  if (node.type !== 'locator') return `<svg class="outliner-kind-icon object-icon" aria-hidden="true"><use href="#icon-${node.type}"></use></svg>`;
  return `<svg class="outliner-kind-icon" aria-hidden="true" viewBox="0 0 197.49 189.08">${LOCATOR_ICON_SHAPES}</svg>`;
}

function openIconMarkup(direction = 'down', className = '', attributes = '') {
  return `<svg class="open-icon ${className}" data-icon-direction="${direction}" ${attributes} aria-hidden="true"><use href="#icon-open"></use></svg>`;
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
    inspector.innerHTML = '<div class="field-section"><p style="color:var(--muted);font-size:.7rem">選擇一個 Cube、Shape、Locator 或組來編輯。</p></div>';
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
      <div class="vector-field scalar-field"><span>膨脹</span><label class="number-wrap"><input type="number" step="0.1" data-field="inflate" value="${round(item.inflate)}" /></label></div>
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
  return `<div class="vector-field"><span>${label}</span>${values.map((value, index) => `<label class="number-wrap"><b>${'XYZ'[index]}</b><input type="number" step="0.0001" data-vector="${field}" data-axis="${index}" value="${round(value)}" /></label>`).join('')}</div>`;
}

function parameterField(label, key, value, step) {
  return `<div class="option-row"><span>${label}</span><div class="number-wrap" style="width:68px"><input type="number" min="${key === 'sides' ? 3 : .1}" step="${step}" data-parameter="${key}" value="${round(value)}" /></div></div>`;
}

function setNodeVisibility(node, visible, cascadeGroup = true) {
  if (!node) return;
  node.visible = visible;
  if (node.type !== 'group' || !cascadeGroup) return;
  for (const childUid of node.children) setNodeVisibility(state.project.getNode(childUid), visible, true);
}

function bindInspector() {
  const item = selected();
  if (!item) return;
  $$('[data-field]', inspector).forEach(input => {
    const eventName = input.type === 'text' ? 'change' : 'change';
    input.addEventListener(eventName, () => {
      snapshot();
      const key = input.dataset.field;
      if (key === 'visible') setNodeVisibility(item, input.checked);
      else item[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
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
      } else if (field === 'pivot' && ['cube', 'group'].includes(item.type)) {
        const nextPivot = [...item.pivot];
        nextPivot[axis] = nextValue;
        setPivotPreservingGeometry(state.project, item, nextPivot);
      } else item[field][axis] = nextValue;
      markDirty(); sceneRenderer.invalidateSelectionGeometry(); syncInspectorValues(item); renderScene();
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

function revealOutlinerItem(uid) {
  let hierarchyChanged = false;
  for (const group of state.project.getGroupChain(uid)) {
    if (!state.collapsedGroups.delete(group.uid)) continue;
    hierarchyChanged = true;
  }
  if (hierarchyChanged) renderOutliner();
  const index = (state.outlinerRows || []).findIndex(row => row.node.uid === uid);
  if (index < 0) return;
  const rowHeight = 31;
  const rowTop = index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const visibleTop = outliner.scrollTop;
  const visibleBottom = visibleTop + outliner.clientHeight;
  let target = null;
  if (rowTop < visibleTop) target = rowTop;
  else if (rowBottom > visibleBottom) target = Math.max(0, rowBottom - outliner.clientHeight);
  if (target !== null) outliner.scrollTo({ top: target, behavior: 'smooth' });
  else {
    state.outlinerWindowStart = -1;
    state.outlinerWindowEnd = -1;
    renderOutlinerWindow();
  }
}

function refreshSelectionUi() {
  state.outlinerWindowStart = -1;
  state.outlinerWindowEnd = -1;
  renderOutlinerWindow();
  sceneRenderer.invalidateSelectionGeometry();
  updateToolOptions();
  renderInspector();
  renderScene();
  updateSelectionLabels();
}

function clearSelection() {
  if (!state.selectedUids.size && !state.selectedUid) return;
  sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
  state.selectedUids.clear();
  state.selectedUid = null;
  state.selectionAnchorUid = null;
  state.vertexSnapSource = null;
  if (state.tool === 'knife') cancelKnifeSelection(false);
  refreshSelectionUi();
}

function selectItem(uid, { revealInOutliner = false, toggle = false, range = false } = {}) {
  if (!state.project.getNode(uid)) return;
  sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
  if (range && state.selectionAnchorUid) {
    const rows = state.outlinerRows || [];
    const start = rows.findIndex(row => row.node.uid === state.selectionAnchorUid);
    const end = rows.findIndex(row => row.node.uid === uid);
    if (start >= 0 && end >= 0) {
      const extended = new Set(state.selectedUids);
      rows.slice(Math.min(start, end), Math.max(start, end) + 1).forEach(row => extended.add(row.node.uid));
      state.selectedUids = extended;
    } else state.selectedUids.add(uid);
  } else if (toggle) {
    if (state.selectedUids.has(uid)) state.selectedUids.delete(uid);
    else state.selectedUids.add(uid);
    state.selectionAnchorUid = uid;
  } else {
    state.selectedUids = new Set([uid]);
    state.selectionAnchorUid = uid;
  }
  state.selectedUid = state.selectedUids.has(uid) ? uid : [...state.selectedUids].at(-1) || null;
  if (state.tool !== 'vertexSnap') state.vertexSnapSource = null;
  if (state.tool === 'knife' && state.knifeSelection?.uid !== state.selectedUid) {
    state.knifeSelection = null;
    state.knifeHover = null;
    state.knifePointer = null;
    updateToolOptions();
  }
  if (revealInOutliner && state.selectedUid) revealOutlinerItem(state.selectedUid);
  refreshSelectionUi();
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

function selectedNodeUids() {
  return [...state.selectedUids].filter(uidValue => state.project.getNode(uidValue));
}

function selectedElementUids() {
  const elements = new Set();
  for (const uidValue of selectedNodeUids()) {
    const node = state.project.getNode(uidValue);
    if (node?.type === 'group') state.project.getDescendantElementUids(uidValue).forEach(childUid => elements.add(childUid));
    else if (node) elements.add(node.uid);
  }
  return [...elements];
}

function selectedTopLevelNodes() {
  return topLevelSelectedUids().map(uidValue => state.project.getNode(uidValue)).filter(Boolean);
}

function deepestCommonSelectionGroup() {
  const paths = selectedTopLevelNodes().map(node => [
    ...state.project.getGroupChain(node.uid),
    ...(node.type === 'group' ? [node] : [])
  ]);
  if (!paths.length) return null;
  const shortest = Math.min(...paths.map(path => path.length));
  let common = null;
  for (let index = 0; index < shortest; index++) {
    const candidate = paths[0][index];
    if (!paths.every(path => path[index]?.uid === candidate.uid)) break;
    common = candidate;
  }
  return common;
}

function topLevelSelectedUids() {
  const chosen = new Set(selectedNodeUids());
  return [...chosen].filter(uidValue => !state.project.getGroupChain(uidValue).some(group => chosen.has(group.uid)));
}

function nodeContainer(uidValue) {
  const parent = state.project.getParentGroup(uidValue);
  return { parent, items: parent ? parent.children : state.project.outliner };
}

function insertNewNodeUid(uidValue) {
  const selectedIds = selectedNodeUids();
  const reference = state.project.getNode(state.selectedUid);
  if (!reference) {
    state.project.outliner.push(uidValue);
    return;
  }
  // A single selected group is an insertion target. In a multi-selection it is
  // treated like any other row, so creation follows the last selected row.
  if (selectedIds.length === 1 && reference.type === 'group') {
    reference.children.push(uidValue);
    state.collapsedGroups.delete(reference.uid);
    return;
  }
  const { items } = nodeContainer(reference.uid);
  const index = items.indexOf(reference.uid);
  items.splice(index < 0 ? items.length : index + 1, 0, uidValue);
}

function selectCreatedNode(uidValue) {
  state.selectedUid = uidValue;
  state.selectedUids = new Set([uidValue]);
  state.selectionAnchorUid = uidValue;
}

function addCube() {
  snapshot();
  const count = state.project.elements.filter(item => item.type === 'cube').length + 1;
  const cube = new Cube({ name: `cube_${count}`, position: [-3, 1, -3], size: [6, 6, 6], pivot: [0, 4, 0], color: '#a7d352' });
  state.project.elements.push(cube);
  insertNewNodeUid(cube.uid);
  selectCreatedNode(cube.uid);
  markDirty(); renderAll(); toast('已新增 Cube');
}

function addShape() {
  snapshot();
  const shape = new Shape({ name: 'cylinder_shape', origin: [0, 2, 0] });
  state.project.elements.push(shape);
  insertNewNodeUid(shape.uid);
  selectCreatedNode(shape.uid);
  markDirty(); renderAll(); toast('已新增程序化 Shape');
}

function addLocator() {
  snapshot();
  const count = state.project.elements.filter(item => item.type === 'locator').length + 1;
  const locator = new Locator({ name: `locator_${count}`, position: [0, 4, 0] });
  state.project.elements.push(locator);
  insertNewNodeUid(locator.uid);
  selectCreatedNode(locator.uid);
  markDirty(); renderAll(); toast('已新增 Locator');
}

function addGroup() {
  const previousRowPositions = captureOutlinerRowPositions();
  snapshot();
  const group = new Group({ name: `group_${state.project.groups.length + 1}`, children: [] });
  const hadMultipleSelection = selectedNodeUids().length > 1;
  const selectedIds = topLevelSelectedUids();
  state.project.groups.push(group);
  if (hadMultipleSelection && selectedIds.length) {
    const sourceContainers = selectedIds.map(uidValue => nodeContainer(uidValue));
    const sharedContainer = sourceContainers.every(container => container.items === sourceContainers[0].items)
      ? sourceContainers[0]
      : null;
    // When every selected row is already in the same directory, keep the new
    // group exactly where those rows lived. This makes grouping an in-place
    // wrap instead of unexpectedly sending the selection to the directory end.
    const sharedInsertionIndex = sharedContainer
      ? Math.min(...selectedIds.map(uidValue => sharedContainer.items.indexOf(uidValue)).filter(index => index >= 0))
      : -1;
    const chains = selectedIds.map(uidValue => state.project.getGroupChain(uidValue));
    let commonParent = null;
    const shortest = Math.min(...chains.map(chain => chain.length));
    for (let index = 0; index < shortest; index++) {
      const candidate = chains[0][index];
      if (chains.every(chain => chain[index]?.uid === candidate.uid)) commonParent = candidate;
      else break;
    }
    const order = new Map((state.outlinerRows || []).map((row, index) => [row.node.uid, index]));
    selectedIds.sort((left, right) => (order.get(left) ?? Infinity) - (order.get(right) ?? Infinity));
    for (const uidValue of selectedIds) {
      const { items } = nodeContainer(uidValue);
      const index = items.indexOf(uidValue);
      if (index >= 0) items.splice(index, 1);
    }
    group.children.push(...selectedIds);
    if (sharedContainer && sharedInsertionIndex >= 0) {
      sharedContainer.items.splice(sharedInsertionIndex, 0, group.uid);
    } else {
      (commonParent ? commonParent.children : state.project.outliner).push(group.uid);
    }
    state.collapsedGroups.delete(group.uid);
  } else {
    insertNewNodeUid(group.uid);
  }
  selectCreatedNode(group.uid);
  markDirty(); renderAll(); animateOutlinerReorder(previousRowPositions); toast('已新增組');
}

function deleteSelected() {
  const selectedIds = topLevelSelectedUids();
  if (!selectedIds.length) return;
  snapshot();
  selectedIds.forEach(uidValue => state.project.removeNode(uidValue));
  state.selectedUid = null;
  state.selectedUids.clear();
  state.selectionAnchorUid = null;
  markDirty(); renderAll(); toast(selectedIds.length > 1 ? `已刪除 ${selectedIds.length} 項` : '物件已刪除');
}

function clearOutlinerDropState({ keepDragging = false } = {}) {
  outliner.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach(item =>
    item.classList.remove('drop-before', 'drop-after', 'drop-inside'));
  if (!keepDragging) outliner.querySelectorAll('.is-dragging').forEach(item => item.classList.remove('is-dragging'));
}

function captureOutlinerRowPositions() {
  return new Map($$('.outliner-item[data-uid]', outliner).map(item => [item.dataset.uid, item.getBoundingClientRect().top]));
}

function animateOutlinerReorder(previousPositions) {
  requestAnimationFrame(() => {
    $$('.outliner-item[data-uid]', outliner).forEach(item => {
      const previousTop = previousPositions.get(item.dataset.uid);
      if (previousTop === undefined) return;
      const delta = previousTop - item.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) return;
      item.animate([
        { transform: `translateY(${delta}px)` },
        { transform: 'translateY(0)' }
      ], { duration: 170, easing: 'cubic-bezier(.2,.75,.25,1)' });
    });
  });
}

function removeOutlinerDragGhost() {
  outlinerDragGhost?.remove();
  outlinerDragGhost = null;
}

function createOutlinerDragGhost(uids) {
  removeOutlinerDragGhost();
  const nodes = uids.map(uidValue => state.project.getNode(uidValue)).filter(Boolean);
  const shown = nodes.slice(0, 4);
  const ghost = document.createElement('div');
  ghost.className = 'outliner-drag-ghost';
  ghost.style.width = `${Math.max(150, Math.min(280, outliner.clientWidth - 14))}px`;
  ghost.innerHTML = shown.map(node => `<div class="outliner-drag-ghost-row ${node.type === 'group' ? 'group' : ''}">
      <span class="kind">${outlinerKindMarkup(node)}</span>
      <span class="item-name">${escapeHtml(node.name)}</span>
    </div>`).join('')
    + (nodes.length > shown.length ? `<div class="outliner-drag-ghost-more">＋${nodes.length - shown.length}</div>` : '')
    + (nodes.length > 1 ? `<div class="outliner-drag-ghost-count">${nodes.length}</div>` : '');
  document.body.append(ghost);
  outlinerDragGhost = ghost;
  return ghost;
}

function moveSelectedNodes(targetUid = null, zone = 'after') {
  const moving = topLevelSelectedUids();
  if (!moving.length) return;
  const movingSet = new Set(moving);
  const target = targetUid && state.project.getNode(targetUid);
  if (target && movingSet.has(target.uid)) return;
  let destinationParent = null;
  let destination;
  let insertionIndex;
  if (target?.type === 'group' && zone === 'inside') {
    destinationParent = target;
    destination = target.children;
    insertionIndex = destination.length;
  } else if (target) {
    const container = nodeContainer(target.uid);
    destinationParent = container.parent;
    destination = container.items;
    const targetIndex = destination.indexOf(target.uid);
    insertionIndex = targetIndex + (zone === 'after' ? 1 : 0);
  } else {
    destination = state.project.outliner;
    insertionIndex = destination.length;
  }
  // A group can never be reparented into itself or one of its descendants.
  if (destinationParent && moving.some(uidValue => {
    const node = state.project.getNode(uidValue);
    return node?.type === 'group' && (destinationParent.uid === uidValue
      || state.project.getGroupChain(destinationParent.uid).some(group => group.uid === uidValue));
  })) return toast('不能把組拖進它自己的子級');

  const previousRowPositions = captureOutlinerRowPositions();
  snapshot();
  const order = new Map((state.outlinerRows || []).map((row, index) => [row.node.uid, index]));
  moving.sort((left, right) => (order.get(left) ?? Infinity) - (order.get(right) ?? Infinity));
  for (const uidValue of moving) {
    const container = nodeContainer(uidValue).items;
    const index = container.indexOf(uidValue);
    if (container === destination && index >= 0 && index < insertionIndex) insertionIndex--;
    if (index >= 0) container.splice(index, 1);
  }
  destination.splice(Math.max(0, insertionIndex), 0, ...moving);
  if (destinationParent) state.collapsedGroups.delete(destinationParent.uid);
  markDirty();
  renderAll();
  animateOutlinerReorder(previousRowPositions);
}

function renderScene() {
  sceneRenderer.render(state.project, state.selectedUid, { ...state, editorOverlayLines: buildKnifeOverlayLines() });
  updateLocatorOverlay();
  updateTransformGizmo();
  updateAxisWidget();
}

function updateLocatorOverlay() {
  const overlay = $('#locatorOverlay');
  const selectedElements = new Set(selectedElementUids());
  const rect = sceneCanvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (state.geometryOnly) {
    overlay.innerHTML = '';
    overlay.setAttribute('hidden', '');
    return;
  }
  const icons = state.project.elements
    .filter(element => element.type === 'locator')
    .flatMap(element => {
      const world = sceneRenderer.getWorldVertices(state.project, element.uid)[0]?.point;
      if (!world) return [];
      const point = sceneRenderer.projectPoint(world);
      if (!point || point.behind || point.depth < -1 || point.depth > 1
        || point.x < -9 || point.y < -9 || point.x > width + 9 || point.y > height + 9) return [];
      return [{ element, point, size: sceneRenderer.getLocatorScreenSize(world) }];
    })
    .sort((left, right) => right.point.depth - left.point.depth);
  overlay.innerHTML = icons.map(({ element, point, size }) => `<svg class="locator-screen-icon ${selectedElements.has(element.uid) ? 'selected' : ''}"
      data-locator-uid="${element.uid}" x="${point.x - size / 2}" y="${point.y - size / 2}" width="${size}" height="${size}"
      viewBox="0 0 197.49 189.08" preserveAspectRatio="xMidYMid meet" aria-label="${escapeHtml(element.name)}">${LOCATOR_ICON_SHAPES}</svg>`).join('');
  overlay.toggleAttribute('hidden', icons.length === 0);
}

function bakeCameraPan() {
  const frame = sceneRenderer.getCameraFrame();
  if (frame?.target) state.target = [...frame.target];
  state.panX = 0;
  state.panY = 0;
}

function cancelCameraFocus() {
  if (cameraFocusFrame !== null) cancelAnimationFrame(cameraFocusFrame);
  cameraFocusFrame = null;
}

function animateCameraFocus(target, duration = 250) {
  cancelCameraFocus();
  bakeCameraPan();
  const from = [...state.target];
  const to = [...target];
  const startedAt = performance.now();
  const tick = now => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = progress < .5
      ? 4 * progress ** 3
      : 1 - (-2 * progress + 2) ** 3 / 2;
    state.target = from.map((value, axis) => value + (to[axis] - value) * eased);
    renderScene();
    if (progress < 1) cameraFocusFrame = requestAnimationFrame(tick);
    else cameraFocusFrame = null;
  };
  cameraFocusFrame = requestAnimationFrame(tick);
}

function focusSelected() {
  const center = state.selectedUid && sceneRenderer.getGeometryCenter(state.project, state.selectedUid);
  if (!center) return toast('目前沒有可聚焦的物件');
  animateCameraFocus(center);
}

function focusSceneOrigin() {
  animateCameraFocus([0, 0, 0]);
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

function updateRotationModeButtons() {
  $$('[data-rotation-mode]').forEach(button => {
    const active = button.dataset.rotationMode === state.rotationMode;
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

function updateMultiTransformModeButtons() {
  $$('[data-multi-transform-mode]').forEach(button => {
    const active = button.dataset.multiTransformMode === state.multiTransformMode;
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

function inverseApplyGroupTransforms(point, groupChain = []) {
  let transformed = [...point];
  for (const group of groupChain) {
    const offset = transformed.map((value, axis) => value - group.pivot[axis]);
    const rotated = inverseRotateVector(offset, group.rotation || [0, 0, 0]);
    transformed = rotated.map((value, axis) => value + group.pivot[axis]);
  }
  return transformed;
}

function selectedWorldPoints() {
  return selectedElementUids().flatMap(uidValue => sceneRenderer.getWorldVertices(state.project, uidValue).map(entry => entry.point));
}

function selectionGeometryCenter() {
  let points = selectedWorldPoints();
  if (!points.length) points = selectedTopLevelNodes().map(getTransformPivot).filter(Boolean);
  if (!points.length) return null;
  return [0, 1, 2].map(axis => {
    const values = points.map(point => point[axis]);
    return (Math.min(...values) + Math.max(...values)) / 2;
  });
}

function getSelectionTransformContext() {
  const nodes = selectedTopLevelNodes();
  const multiple = nodes.length > 1;
  const commonGroup = multiple ? deepestCommonSelectionGroup() : null;
  const center = multiple ? selectionGeometryCenter() : null;
  return {
    nodes,
    multiple,
    commonGroup,
    center,
    pivot: multiple ? (commonGroup ? getTransformPivot(commonGroup) : center) : null
  };
}

function getTransformAxes(item) {
  const chain = state.project.getGroupChain(item.uid);
  const parentRotation = vector => applyGroupTransforms(vector, chain.map(group => ({ pivot: [0, 0, 0], rotation: group.rotation })));
  return [0, 1, 2].map(axis => {
    const unit = [0, 0, 0]; unit[axis] = 1;
    let direction = state.transformSpace === 'global' ? unit : parentRotation(unit);
    if (state.transformSpace === 'self' || (state.tool === 'resize' && item.type !== 'group')) {
      const rotation = item.rotation || [0, 0, 0];
      if (state.tool === 'rotate' && state.rotationMode === 'euler') {
        // The renderer uses Rz * Ry * Rx. Its Euler gimbal therefore has a
        // fixed Z axis, Y follows Z, and X follows Z then Y. Rotations later
        // in the Z -> Y -> X hierarchy never move an earlier axis.
        const stagedRotation = axis === 0 ? [0, rotation[1], rotation[2]]
          : axis === 1 ? [0, 0, rotation[2]]
          : [0, 0, 0];
        direction = parentRotation(rotateVector(unit, stagedRotation));
      } else {
        direction = parentRotation(rotateVector(unit, rotation));
      }
    }
    return normalize3(direction);
  });
}

function getSelectionTransformAxes(context, fallbackItem) {
  if (!context.multiple) return getTransformAxes(fallbackItem);
  if (context.commonGroup) return getTransformAxes(context.commonGroup);
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

function addScaled3(point, direction, amount) {
  return point.map((value, axis) => value + direction[axis] * amount);
}

function intersectRayPlane(ray, planePoint, planeNormal) {
  if (!ray) return null;
  const denominator = dot3(ray.direction, planeNormal);
  if (Math.abs(denominator) < 1e-6) return null;
  const distance = dot3(planePoint.map((value, axis) => value - ray.origin[axis]), planeNormal) / denominator;
  return addScaled3(ray.origin, ray.direction, distance);
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

function gizmoDepthAttributes(shape, pointGroups, priority = '') {
  const groups = (Array.isArray(pointGroups[0]) ? pointGroups : [pointGroups]).filter(group => group.length);
  const points = groups.flat();
  const averageDepth = points.reduce((sum, point) => sum + point.depth, 0) / Math.max(1, points.length);
  const encoded = groups.map(group => group.map(point =>
    `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.depth.toFixed(6)}`).join(';')).join('|');
  return `data-hit-shape="${shape}" data-hit-depth="${averageDepth.toFixed(6)}" data-hit-points="${encoded}"${priority ? ` data-hit-priority="${priority}"` : ''}`;
}

function gizmoControlLayer(control) {
  if (control.dataset.hitPriority === 'center') return 2;
  return control.dataset.kind?.startsWith('plane') ? 1 : 0;
}

function sortGizmoControlsByDepth(gizmo) {
  const controls = [...gizmo.children].filter(element => element.classList.contains('gizmo-control'));
  const anchor = [...gizmo.children].find(element => !element.classList.contains('gizmo-control')) || null;
  controls.sort((left, right) => {
    const leftLayer = gizmoControlLayer(left);
    const rightLayer = gizmoControlLayer(right);
    if (leftLayer !== rightLayer) return leftLayer - rightLayer;
    // OpenGL NDC depth grows away from the camera, so farther controls are
    // painted first and the nearer control remains visible on top.
    return Number(right.dataset.hitDepth || 1) - Number(left.dataset.hitDepth || 1);
  });
  controls.forEach(control => gizmo.insertBefore(control, anchor));
}

function parseGizmoDepthGroups(control) {
  return (control.dataset.hitPoints || '').split('|').map(group => group.split(';').map(point => {
    const values = point.split(',').map(Number);
    return values.length === 3 && values.every(Number.isFinite) ? values : null;
  }).filter(Boolean)).filter(group => group.length);
}

function triangleDepthAtPoint(point, first, second, third) {
  const denominator = (second[1] - third[1]) * (first[0] - third[0])
    + (third[0] - second[0]) * (first[1] - third[1]);
  if (Math.abs(denominator) < 1e-6) return null;
  const a = ((second[1] - third[1]) * (point[0] - third[0])
    + (third[0] - second[0]) * (point[1] - third[1])) / denominator;
  const b = ((third[1] - first[1]) * (point[0] - third[0])
    + (first[0] - third[0]) * (point[1] - third[1])) / denominator;
  const c = 1 - a - b;
  if (a < -.001 || b < -.001 || c < -.001) return null;
  return a * first[2] + b * second[2] + c * third[2];
}

function gizmoControlDepthAtPoint(control, x, y) {
  const groups = parseGizmoDepthGroups(control);
  const fallback = Number(control.dataset.hitDepth || 1);
  if (!groups.length) return fallback;
  if (control.dataset.hitShape === 'polygon' && groups[0].length >= 3) {
    const polygon = groups[0];
    for (let index = 1; index < polygon.length - 1; index++) {
      const depth = triangleDepthAtPoint([x, y], polygon[0], polygon[index], polygon[index + 1]);
      if (depth !== null) return depth;
    }
    return fallback;
  }
  let closest = { distance: Infinity, depth: fallback };
  for (const group of groups) {
    if (group.length === 1) continue;
    for (let index = 0; index < group.length - 1; index++) {
      const first = group[index], second = group[index + 1];
      const dx = second[0] - first[0], dy = second[1] - first[1];
      const lengthSquared = dx * dx + dy * dy;
      const amount = lengthSquared > 1e-6
        ? Math.max(0, Math.min(1, ((x - first[0]) * dx + (y - first[1]) * dy) / lengthSquared))
        : 0;
      const nearestX = first[0] + dx * amount, nearestY = first[1] + dy * amount;
      const distance = (x - nearestX) ** 2 + (y - nearestY) ** 2;
      if (distance < closest.distance) closest = {
        distance,
        depth: first[2] + (second[2] - first[2]) * amount
      };
    }
  }
  return closest.depth;
}

function resolveGizmoHandle(event) {
  const gizmo = $('#transformGizmo');
  const controls = [];
  const seen = new Set();
  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    const control = element.closest?.('.gizmo-control');
    if (!control || !gizmo.contains(control) || seen.has(control)) continue;
    seen.add(control); controls.push(control);
  }
  const fallback = event.target.closest?.('.gizmo-control');
  if (fallback && gizmo.contains(fallback) && !seen.has(fallback)) controls.push(fallback);
  if (!controls.length) return null;
  const frontLayer = Math.max(...controls.map(gizmoControlLayer));
  const frontControls = controls.filter(control => gizmoControlLayer(control) === frontLayer);
  const rect = gizmo.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  return frontControls.reduce((nearest, control) => {
    const depth = gizmoControlDepthAtPoint(control, x, y);
    if (!nearest || depth < nearest.depth - 1e-6) return { control, depth };
    if (Math.abs(depth - nearest.depth) <= 1e-6
      && control.dataset.kind === 'axis' && nearest.control.dataset.kind !== 'axis') return { control, depth };
    return nearest;
  }, null)?.control || fallback;
}

function updateGizmoDepthHover(event) {
  if (state.dragging?.type === 'transform') return;
  const gizmo = $('#transformGizmo');
  const handle = resolveGizmoHandle(event);
  gizmo.querySelectorAll('.depth-hover').forEach(control => control.classList.toggle('depth-hover', control === handle));
  handle?.classList.add('depth-hover');
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
  const center = projectViewportPoint(origin);
  const faces = base.map((point, index) => `<path class="gizmo-visible gizmo-head cone-face" d="${pointsPath([tip, point, base[(index + 1) % base.length]], true)}"/>`).join('');
  return `<g class="gizmo-control ${axisClass}" data-axis="${handle.axis}" data-kind="axis" ${gizmoDepthAttributes('segment', [center, tip])}>
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
  const center = projectViewportPoint(origin);
  return `<g class="gizmo-control ${axisClass}" data-axis="${handle.axis}" data-kind="axis" data-sign="${sign}" ${gizmoDepthAttributes('segment', [center, endpoint])}>
    <line class="gizmo-hit" x1="${handle.centerX}" y1="${handle.centerY}" x2="${endpoint.x}" y2="${endpoint.y}"/>
    <line class="gizmo-visible axis-stem" x1="${handle.centerX}" y1="${handle.centerY}" x2="${endpoint.x}" y2="${endpoint.y}"/>
    ${faces}<circle class="gizmo-hit-point" cx="${endpoint.x}" cy="${endpoint.y}" r="18"/>
  </g>`;
}

const GIZMO_PLANES = Object.freeze([
  { axes: [0, 1], key: 'xy' },
  { axes: [1, 2], key: 'yz' },
  { axes: [2, 0], key: 'zx' }
]);

function planeMarkup(handles, origin, plane, pixelWorld, signs = [1, 1]) {
  const [firstIndex, secondIndex] = plane.axes;
  const first = handles[firstIndex].vector.map(value => value * signs[0]);
  const second = handles[secondIndex].vector.map(value => value * signs[1]);
  const near = pixelWorld * 18;
  const far = pixelWorld * 39;
  const point = (firstDistance, secondDistance) => {
    let world = addScaled3(origin, first, firstDistance);
    world = addScaled3(world, second, secondDistance);
    return projectViewportPoint(world);
  };
  const corners = [point(near, near), point(far, near), point(far, far), point(near, far)];
  const path = pointsPath(corners, true);
  const axisKey = `plane-${firstIndex}${secondIndex}`;
  return `<g class="gizmo-control plane-${plane.key}" data-axis="${axisKey}" data-kind="plane" ${gizmoDepthAttributes('polygon', corners)}
      data-axes="${firstIndex},${secondIndex}" data-signs="${signs.join(',')}">
    <path class="gizmo-plane-hit" d="${path}"/>
    <path class="gizmo-visible plane-handle" d="${path}"/>
  </g>`;
}

function planeScaleCornerMarkup(handles, origin, plane, pixelWorld, signs) {
  const [firstIndex, secondIndex] = plane.axes;
  const first = handles[firstIndex].vector.map(value => value * signs[0]);
  const second = handles[secondIndex].vector.map(value => value * signs[1]);
  const inner = pixelWorld * 22;
  const outer = pixelWorld * 52;
  const point = (firstDistance, secondDistance) => {
    let world = addScaled3(origin, first, firstDistance);
    world = addScaled3(world, second, secondDistance);
    return projectViewportPoint(world);
  };
  const points = [point(outer, inner), point(outer, outer), point(inner, outer)];
  const path = pointsPath(points);
  const axisKey = `plane-uniform-${firstIndex}${secondIndex}`;
  return `<g class="gizmo-control plane-${plane.key}" data-axis="${axisKey}" data-kind="plane-uniform" ${gizmoDepthAttributes('polyline', points)}
      data-axes="${firstIndex},${secondIndex}" data-signs="${signs.join(',')}">
    <path class="gizmo-plane-corner-hit" d="${path}"/>
    <path class="gizmo-visible plane-scale-corner" d="${path}"/>
  </g>`;
}

function centerCubeMarkup(origin, axes, pixelWorld, { axisKey = 'uniform', kind = 'uniform', className = 'uniform-scale-control' } = {}) {
  const half = pixelWorld * 7.5;
  const corners = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    let point = addScaled3(origin, axes[0], x * half);
    point = addScaled3(point, axes[1], y * half);
    point = addScaled3(point, axes[2], z * half);
    corners.push(projectViewportPoint(point));
  }
  const faces = [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]
    .map(indices => ({ points: indices.map(index => corners[index]), depth: indices.reduce((sum, index) => sum + corners[index].depth, 0) / 4 }))
    .sort((left, right) => right.depth - left.depth)
    .map(face => `<path class="gizmo-visible center-cube-face" d="${pointsPath(face.points, true)}"/>`).join('');
  const center = projectViewportPoint(origin);
  return `<g class="gizmo-control ${className}" data-axis="${axisKey}" data-kind="${kind}" ${gizmoDepthAttributes('polygon', [center], 'center')}>
    <circle class="gizmo-hit-point" cx="${center.x}" cy="${center.y}" r="16"/>
    ${faces}
  </g>`;
}

function pivotMarkerMarkup(origin) {
  const center = projectViewportPoint(origin);
  const x = center.x, y = center.y, radius = 11;
  return `<g class="pivot-marker" aria-label="選中項樞軸點">
    <path class="pivot-marker-ring" d="M${x},${y - radius} L${x + radius},${y} L${x},${y + radius} L${x - radius},${y} Z"/>
    <path class="pivot-marker-cross" d="M${x - 15},${y} H${x + 15} M${x},${y - 15} V${y + 15}"/>
    <circle class="pivot-marker-core" cx="${x}" cy="${y}" r="3.5"/>
  </g>`;
}

function frontRingGeometry(origin, axis, radius, cameraFrame) {
  const [u, v] = axisBasis(axis);
  let path = '', drawing = false, group = [], groups = [];
  for (let step = 0; step <= 144; step++) {
    const angle = step / 144 * Math.PI * 2;
    let offset = u.map(value => value * Math.cos(angle) * radius);
    offset = offset.map((value, component) => value + v[component] * Math.sin(angle) * radius);
    const world = origin.map((value, component) => value + offset[component]);
    const toCamera = cameraFrame.projection === 'perspective'
      ? normalize3(cameraFrame.eye.map((value, component) => value - world[component]))
      : cameraFrame.forward.map(value => -value);
    if (dot3(offset, toCamera) < -.0001) {
      if (group.length) groups.push(group);
      group = []; drawing = false; continue;
    }
    const point = projectViewportPoint(world);
    path += `${drawing ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)} `;
    group.push(point);
    drawing = true;
  }
  if (group.length) groups.push(group);
  return { path: path.trim(), groups };
}

function cameraRingGeometry(origin, radius, cameraFrame) {
  const points = Array.from({ length: 97 }, (_, step) => {
    const angle = step / 96 * Math.PI * 2;
    let point = addScaled3(origin, cameraFrame.right, Math.cos(angle) * radius);
    point = addScaled3(point, cameraFrame.up, Math.sin(angle) * radius);
    return projectViewportPoint(point);
  });
  return { path: pointsPath(points, true), points };
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

function renderVertexSnapGizmo(gizmo, width, height) {
  const item = selected();
  const points = [];
  for (const vertex of sceneRenderer.getWorldVertices(state.project, item.uid)) {
    const projected = projectViewportPoint(vertex.point);
    if (projected.behind || projected.x < -12 || projected.y < -12 || projected.x > width + 12 || projected.y > height + 12) continue;
    points.push({ ...vertex, pointType: 'vertex', projected });
  }
  if (state.vertexSnapMode === 'move' && ['cube', 'group'].includes(item.type)) {
    const pivotPoint = getTransformPivot(item);
    const projected = projectViewportPoint(pivotPoint);
    if (!projected.behind && projected.x >= -14 && projected.y >= -14 && projected.x <= width + 14 && projected.y <= height + 14) {
      points.push({ uid: item.uid, point: pivotPoint, pointType: 'pivot', projected });
    }
  }
  points.sort((left, right) => right.projected.depth - left.projected.depth);
  state.vertexSnapPoints = points;
  gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const pointMarkup = points.map((entry, index) => {
    const sourceActive = state.vertexSnapSource?.uid === entry.uid
      && state.vertexSnapSource.pointType === entry.pointType
      && state.vertexSnapSource.point.every((value, axis) => Math.abs(value - entry.point[axis]) < 1e-5);
    const classes = ['gizmo-control', 'vertex-snap-control', 'source-candidate', sourceActive ? 'source-active' : ''].filter(Boolean).join(' ');
    if (entry.pointType === 'pivot') return `<g class="${classes} vertex-snap-pivot-control pivot-marker" data-kind="vertex" data-vertex-index="${index}" ${gizmoDepthAttributes('point', [entry.projected], 'front')}>
      <circle class="gizmo-hit-point" cx="${entry.projected.x}" cy="${entry.projected.y}" r="17"/>
      <path class="gizmo-visible pivot-marker-ring" d="M${entry.projected.x},${entry.projected.y - 11} L${entry.projected.x + 11},${entry.projected.y} L${entry.projected.x},${entry.projected.y + 11} L${entry.projected.x - 11},${entry.projected.y} Z"/>
      <path class="gizmo-visible pivot-marker-cross" d="M${entry.projected.x - 15},${entry.projected.y} H${entry.projected.x + 15} M${entry.projected.x},${entry.projected.y - 15} V${entry.projected.y + 15}"/>
      <circle class="gizmo-visible pivot-marker-core" cx="${entry.projected.x}" cy="${entry.projected.y}" r="3.5"/>
    </g>`;
    return `<g class="${classes}" data-kind="vertex" data-vertex-index="${index}" ${gizmoDepthAttributes('point', [entry.projected])}>
      <circle class="gizmo-hit-point" cx="${entry.projected.x}" cy="${entry.projected.y}" r="13"/>
      <circle class="gizmo-visible vertex-snap-point" cx="${entry.projected.x}" cy="${entry.projected.y}" r="5"/>
    </g>`;
  }).join('');
  let sourceMarkup = '';
  if (state.vertexSnapSource && state.vertexSnapSource.rootUid !== item.uid) {
    const source = projectViewportPoint(state.vertexSnapSource.point);
    if (!source.behind && state.vertexSnapSource.pointType === 'pivot') sourceMarkup = `<g class="pivot-marker vertex-snap-source-pivot">
      <path class="pivot-marker-ring" d="M${source.x},${source.y - 11} L${source.x + 11},${source.y} L${source.x},${source.y + 11} L${source.x - 11},${source.y} Z"/>
      <path class="pivot-marker-cross" d="M${source.x - 15},${source.y} H${source.x + 15} M${source.x},${source.y - 15} V${source.y + 15}"/>
      <circle class="pivot-marker-core" cx="${source.x}" cy="${source.y}" r="3.5"/>
    </g>`;
    else if (!source.behind) sourceMarkup = `<path class="vertex-snap-source-marker" d="M${source.x},${source.y - 9} L${source.x + 9},${source.y} L${source.x},${source.y + 9} L${source.x - 9},${source.y} Z"/>`;
  }
  gizmo.innerHTML = pointMarkup + sourceMarkup;
  sortGizmoControlsByDepth(gizmo);
  gizmo.removeAttribute('hidden');
}

function updateTransformGizmo() {
  const gizmo = $('#transformGizmo');
  const item = selected();
  const selectionContext = getSelectionTransformContext();
  if (!item || !['move', 'resize', 'rotate', 'pivot', 'vertexSnap'].includes(state.tool)
    || (state.tool === 'resize' && !selectionContext.multiple && !['cube', 'shape'].includes(item.type))) {
    gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; state.gizmoAxes = null; state.gizmoCenter = null; state.gizmoOrigin = null; return;
  }
  const rect = sceneCanvas.getBoundingClientRect();
  const width = rect.width, height = rect.height;
  if (state.tool === 'vertexSnap') {
    renderVertexSnapGizmo(gizmo, width, height);
    return;
  }
  if (state.tool === 'pivot' && selectionContext.multiple && !selectionContext.commonGroup) {
    gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; return;
  }
  const transformItem = state.tool === 'pivot' && selectionContext.multiple ? selectionContext.commonGroup : item;
  if (state.tool === 'pivot' && !['cube', 'group'].includes(transformItem?.type)) {
    gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; return;
  }
  const pivot = selectionContext.multiple ? selectionContext.pivot : getTransformPivot(item);
  const geometryCenter = selectionContext.multiple
    ? selectionContext.center || pivot
    : sceneRenderer.getGeometryCenter(state.project, item.uid) || pivot;
  const gizmoOrigin = ['rotate', 'pivot'].includes(state.tool) ? pivot : geometryCenter;
  const center = projectViewportPoint(gizmoOrigin);
  state.gizmoCenter = { x: center.x, y: center.y };
  state.gizmoOrigin = [...gizmoOrigin];
  const axes = getSelectionTransformAxes(selectionContext, item);
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
      let extent;
      if (selectionContext.multiple) {
        const projections = selectedWorldPoints().map(point => dot3(point.map((value, axis) => value - gizmoOrigin[axis]), axis));
        extent = projections.length ? Math.max(...projections.map(Math.abs)) : 0;
      } else extent = item.type === 'cube'
        ? Math.abs(item.size[index]) / 2
        : index === 1 ? Math.abs(item.parameters.height) / 2 : Math.abs(item.parameters.radius);
      positiveDistance = extent + pixelWorld * GIZMO_HEAD_GAP_PIXELS;
      negativeDistance = positiveDistance;
    }
    return { axis: index, vector: axis, screen, screenPerWorld: screenDelta.slice(0, 2), positiveDistance, negativeDistance,
      basisU: axes[(index + 1) % 3], basisV: axes[(index + 2) % 3],
      worldPerPixel: 1 / Math.max(pixelsPerUnit, .0001) };
  });
  state.gizmoAxes = handles.map(handle => ({ ...handle, centerX: center.x, centerY: center.y }));
  gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (state.tool === 'rotate') {
    const pixelsPerUnit = 1 / pixelWorld;
    const radius = 87 / pixelsPerUnit;
    const sphere = cameraRingGeometry(gizmoOrigin, radius, cameraFrame);
    const rings = handles.map(handle => {
      const ring = frontRingGeometry(gizmoOrigin, handle.vector, radius * .965, cameraFrame);
      return `<g class="gizmo-control axis-${classes[handle.axis]}" data-axis="${handle.axis}" data-kind="rotate" ${gizmoDepthAttributes('polyline', ring.groups)}>
        <path class="gizmo-hit rotate-hit" d="${ring.path}"/><path class="gizmo-visible rotate-ring" d="${ring.path}"/>
      </g>`;
    }).join('');
    gizmo.innerHTML = `<g class="gizmo-control sphere-control" data-axis="view" data-kind="rotate-view" ${gizmoDepthAttributes('polyline', sphere.points)}>
      <path class="gizmo-hit rotate-hit" d="${sphere.path}"/><path class="gizmo-visible rotation-sphere" d="${sphere.path}"/>
    </g>${rings}<circle class="gizmo-visible rotation-pivot" cx="${center.x}" cy="${center.y}" r="5"/>`;
  } else if (state.tool === 'move' || state.tool === 'pivot') {
    const planes = GIZMO_PLANES.map(plane => planeMarkup(handles, gizmoOrigin, plane, pixelWorld)).join('');
    gizmo.innerHTML = `${planes}${handles.map(handle => coneMarkup({ ...handle, centerX: center.x, centerY: center.y }, gizmoOrigin, `axis-${classes[handle.axis]}`, pixelWorld)).join('')}
      ${centerCubeMarkup(gizmoOrigin, axes, pixelWorld, { axisKey: 'free', kind: 'free', className: 'center-control' })}
      ${state.tool === 'pivot' ? pivotMarkerMarkup(gizmoOrigin) : ''}`;
  } else {
    const toCamera = cameraFrame.projection === 'perspective'
      ? normalize3(cameraFrame.eye.map((value, component) => value - gizmoOrigin[component]))
      : cameraFrame.forward.map(value => -value);
    const closestSigns = handles.map(handle => dot3(handle.vector, toCamera) >= 0 ? 1 : -1);
    const planes = GIZMO_PLANES.map(plane => planeMarkup(handles, gizmoOrigin, plane, pixelWorld,
      plane.axes.map(axisIndex => closestSigns[axisIndex]))).join('');
    const planeCorners = GIZMO_PLANES.map(plane => planeScaleCornerMarkup(handles, gizmoOrigin, plane, pixelWorld,
      plane.axes.map(axisIndex => closestSigns[axisIndex]))).join('');
    const axesMarkup = handles.flatMap(handle => [-1, 1].map(sign => prismMarkup({ ...handle, centerX: center.x, centerY: center.y }, gizmoOrigin, `axis-${classes[handle.axis]}`, pixelWorld, sign))).join('');
    gizmo.innerHTML = `${planes}${axesMarkup}${planeCorners}${centerCubeMarkup(gizmoOrigin, axes, pixelWorld)}`;
  }
  sortGizmoControlsByDepth(gizmo);
  if (state.dragging?.type === 'transform' && ['move', 'resize', 'pivot'].includes(state.dragging.tool)) {
    const guideAxes = state.dragging.kind.startsWith('plane')
      ? state.dragging.axisIndices
      : state.dragging.axisIndex === null ? [] : [state.dragging.axisIndex];
    const guides = guideAxes.map(axisIndex => infiniteGuideMarkup(state.gizmoAxes[axisIndex], width, height, `axis-${classes[axisIndex]}`)).join('');
    gizmo.innerHTML = guides + gizmo.innerHTML;
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

function updateTexturePreviewFrame(width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const preview = $('#texturePreview');
  preview.style.setProperty('--texture-aspect', `${safeWidth} / ${safeHeight}`);
  $('.texture-preview > span').textContent = `${safeWidth} × ${safeHeight}`;
}

function renderTexture() {
  textureCanvas.width = 1;
  textureCanvas.height = 1;
  textureCtx.imageSmoothingEnabled = false;
  textureCtx.fillStyle = '#fff';
  textureCtx.fillRect(0, 0, 1, 1);
  sceneRenderer.setTexture(textureCanvas);
  textureCtx.clearRect(0, 0, 1, 1);
  $('#texturePreview').style.setProperty('--texture-aspect', '1 / 1');
  $('.texture-preview > span').textContent = '無貼圖';
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

function textureUid(asset = {}) {
  return asset._uid || asset.uuid || asset.id || `texture_${crypto.randomUUID()}`;
}

function textureItemMarkup(asset, index) {
  return `<button class="texture-item ${asset._uid === state.activeTextureUid ? 'active' : ''}" draggable="true"
      data-texture-uid="${escapeAttribute(asset._uid)}" data-texture-index="${index}">
    <span class="texture-thumb" style="background-image:url(&quot;${escapeAttribute(asset.source || '')}&quot;);background-size:cover;image-rendering:pixelated"></span>
    <span><strong>${escapeHtml(asset.name || `texture_${index + 1}.png`)}</strong><small>${asset.uvWidth || '?'} × ${asset.uvHeight || '?'} · ${asset.kind || 'IMAGE'}</small></span><i>◉</i>
  </button>`;
}

function renderTextureList() {
  const list = $('#textureList');
  const ungrouped = state.textureAssets.filter(asset => !asset.groupId);
  const groups = state.textureGroups.map(group => {
    const assets = state.textureAssets.filter(asset => asset.groupId === group.id);
    return `<section class="texture-group" data-texture-group="${group.id}" draggable="true">
      <button class="texture-group-header" data-texture-group-toggle="${group.id}">${openIconMarkup(group.collapsed ? 'right' : 'down', 'texture-disclosure')}<strong>${escapeHtml(group.name)}</strong><small>${assets.length}</small></button>
      <div class="texture-group-items" ${group.collapsed ? 'hidden' : ''}>${assets.map(asset => textureItemMarkup(asset, state.textureAssets.indexOf(asset))).join('')}</div>
    </section>`;
  }).join('');
  list.innerHTML = ungrouped.map(asset => textureItemMarkup(asset, state.textureAssets.indexOf(asset))).join('') + groups;
}

function addTextureGroup() {
  const group = { id: `texture_group_${crypto.randomUUID()}`, name: `貼圖組 ${state.textureGroups.length + 1}`, collapsed: false };
  state.textureGroups.push(group);
  const active = state.textureAssets.find(asset => asset._uid === state.activeTextureUid);
  if (active) active.groupId = group.id;
  renderTextureList();
  toast('已新增貼圖組');
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
    updateTexturePreviewFrame(image.naturalWidth, image.naturalHeight);
    const asset = { _uid: textureUid(), name: file.name, source: url, uvWidth: image.naturalWidth, uvHeight: image.naturalHeight,
      kind: file.type.split('/')[1]?.toUpperCase() || 'IMAGE', groupId: null };
    state.textureAssets.unshift(asset);
    state.activeTextureUid = asset._uid;
    renderTextureList();
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
    updateTexturePreviewFrame(image.naturalWidth, image.naturalHeight);
    const activeName = $('.texture-item.active strong');
    if (activeName) activeName.textContent = name;
    renderScene();
  };
  image.src = source;
}

function installProjectTextures(assets) {
  state.textureGroups = [];
  state.textureAssets = assets.map(asset => ({ ...asset, _uid: textureUid(asset), groupId: asset.groupId || null }));
  state.activeTextureUid = null;
  if (!assets.length) {
    renderTextureList();
    renderTexture();
    renderScene();
    return;
  }
  renderTextureList();
  const defaultIndex = state.textureAssets.findIndex(asset => asset.useAsDefault);
  activateProjectTexture(defaultIndex >= 0 ? defaultIndex : 0);
}

function activateProjectTexture(index) {
  const asset = state.textureAssets[index];
  if (!asset) return;
  state.activeTextureUid = asset._uid;
  $$('.texture-item').forEach(item => item.classList.toggle('active', item.dataset.textureUid === asset._uid));
  loadTextureSource(asset.source, asset.name);
}

function setMode(mode) {
  state.mode = mode;
  if (mode !== 'animate' && state.timelinePlaying) stopTimeline();
  dockManager?.setMode(mode);
  $$('.mode-tab').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  updateToolVisibility();
  if (!TOOL_REGISTRY[state.tool]?.modes.includes(mode)) setTool(mode === 'paint' ? 'brush' : 'move');
  $('#viewLabel').textContent = mode === 'paint' ? '貼圖預覽' : mode === 'animate' ? '動畫預覽' : '實體著色';
  if (mode === 'paint') activateDock('palette');
  if (mode === 'animate') activateDock('timeline');
  toast({ edit: '編輯模式', paint: '繪畫模式', animate: '動畫模式' }[mode]);
}

function updateToolVisibility() {
  $$('.tool[data-tool]').forEach(button => {
    const definition = TOOL_REGISTRY[button.dataset.tool];
    button.hidden = !definition || !definition.modes.includes(state.mode);
  });
}

function setTool(tool) {
  if (!TOOL_REGISTRY[tool]?.modes.includes(state.mode)) return;
  if (tool !== 'vertexSnap') state.vertexSnapSource = null;
  if (tool !== 'knife') cancelKnifeSelection(false);
  state.tool = tool;
  sceneCanvas.classList.toggle('is-knife', tool === 'knife');
  $$('.tool').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  updateToolOptions();
  renderScene();
}

function updateToolOptions() {
  const lane = $('#toolOptionsLane');
  const labels = { move: '移動', resize: '縮放', rotate: '旋轉', pivot: '移動樞軸', vertexSnap: '頂點捕捉', knife: '刀具切割' };
  lane.hidden = !labels[state.tool];
  $('#transformSpaceControl').hidden = !['move', 'rotate', 'pivot'].includes(state.tool);
  $('#rotationModeControl').hidden = state.tool !== 'rotate' || state.transformSpace !== 'self';
  $('#multiTransformModeControl').hidden = selectedTopLevelNodes().length < 2 || !['move', 'rotate'].includes(state.tool);
  $('#scaleHandleModeControl').hidden = state.tool !== 'resize';
  $('#vertexSnapModeControl').hidden = state.tool !== 'vertexSnap';
  $('#vertexSnapRotationControl').hidden = state.tool !== 'vertexSnap' || state.vertexSnapMode !== 'rotate';
  $('#vertexSnapStatus').hidden = state.tool !== 'vertexSnap';
  $('#vertexSnapStatus').textContent = state.vertexSnapSource ? '再選目標頂點' : '先選來源頂點';
  $('#knifeStatus').hidden = state.tool !== 'knife';
  const knifePreview = getKnifePreviewLabel();
  $('#knifeStatus').textContent = knifePreview ? `預覽：${knifePreview}` : state.knifeSelection ? '選擇橫切或豎切' : '選擇切割點';
  if (!lane.hidden) $('#toolContext').textContent = labels[state.tool];
  updateTransformSpaceButtons();
  updateRotationModeButtons();
  updateScaleHandleModeButtons();
  updateMultiTransformModeButtons();
  $$('[data-vertex-snap-mode]').forEach(button => button.classList.toggle('active', button.dataset.vertexSnapMode === state.vertexSnapMode));
  $$('[data-vertex-rotation-mode]').forEach(button => button.classList.toggle('active', button.dataset.vertexRotationMode === state.vertexSnapRotationMode));
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
  state.selectedUids = new Set(state.selectedUid ? [state.selectedUid] : []);
  state.selectionAnchorUid = state.selectedUid;
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
  state.project = new CubeBricksProject({ name: 'untitled' });
  state.selectedUid = null; state.selectedUids.clear(); state.selectionAnchorUid = null;
  state.filePath = null; state.history.length = 0; state.future.length = 0;
  installProjectTextures([]);
  markDirty(); renderAll(); toast('已建立新項目');
}

const themePresets = {
  moss: { '--accent': '#b9f55a', '--selection-outline': '#d8f59b', '--bg': '#11130f', '--panel': '#1b1f18', '--viewport': '#20251e', '--panel-2': '#22271f', '--panel-3': '#292f25', '--text': '#e9eee3', '--muted': '#8f9b86', '--subtle': '#5f6959', '--line': 'rgba(226, 239, 213, .1)', '--line-strong': 'rgba(226, 239, 213, .18)', '--danger': '#ff7d68', '--accent-contrast': '#17200e', '--surface-tint': '#2b3327', '--dialog-tint': '#38432e', '--viewport-glow': '#53604d' },
  amber: { '--accent': '#e6a20d', '--selection-outline': '#fff0c8', '--bg': '#140904', '--panel': '#1c0d06', '--viewport': '#21120b', '--panel-2': '#241108', '--panel-3': '#2d160b', '--text': '#fff4d8', '--muted': '#c7a77a', '--subtle': '#765738', '--line': 'rgba(255, 224, 171, .11)', '--line-strong': 'rgba(255, 224, 171, .2)', '--danger': '#ff765f', '--accent-contrast': '#261306', '--surface-tint': '#3a1c0b', '--dialog-tint': '#4a260e', '--viewport-glow': '#5a3518' },
  ember: { '--accent': '#ff9d57', '--selection-outline': '#ffd0a6', '--bg': '#160f0e', '--panel': '#241917', '--viewport': '#291d1b', '--panel-2': '#2d201d', '--panel-3': '#362623', '--text': '#f3e7e0', '--muted': '#aa8d82', '--subtle': '#755d55', '--line': 'rgba(255, 220, 202, .1)', '--line-strong': 'rgba(255, 220, 202, .18)', '--danger': '#ff7565', '--accent-contrast': '#27110b', '--surface-tint': '#3c2420', '--dialog-tint': '#4a2d27', '--viewport-glow': '#5a3931' },
  slate: { '--accent': '#65d7e8', '--selection-outline': '#a7f0fa', '--bg': '#0d1115', '--panel': '#171e24', '--viewport': '#1b242b', '--panel-2': '#1d2830', '--panel-3': '#25323b', '--text': '#e4eef2', '--muted': '#8b9da7', '--subtle': '#5c6c75', '--line': 'rgba(211, 237, 245, .1)', '--line-strong': 'rgba(211, 237, 245, .18)', '--danger': '#ff7d68', '--accent-contrast': '#092126', '--surface-tint': '#263640', '--dialog-tint': '#304550', '--viewport-glow': '#405965' }
};

const themeVariableKeys = [...new Set(Object.values(themePresets).flatMap(preset => Object.keys(preset)))];

function setThemeVar(key, value, persist = true) {
  document.documentElement.style.setProperty(key, value);
  if (key === '--accent') document.documentElement.style.setProperty('--accent-rgb', hexToRgb(value).join(', '));
  if (key === '--selection-outline') sceneRenderer.setSelectionOutline(value);
  if (key === '--radius') $('#radiusOutput').textContent = value;
  if (key === '--ui-scale') {
    const scale = Math.max(1, Number.parseFloat(value) || 100) / 100;
    document.documentElement.style.fontSize = `${21 * scale}px`;
    $('#scaleOutput').textContent = value;
  }
  if (persist) saveTheme();
  renderScene();
}

function saveTheme() {
  const computed = getComputedStyle(document.documentElement);
  const theme = Object.fromEntries(themeVariableKeys.map(key => [key, computed.getPropertyValue(key).trim()]));
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

let contextMenuSource = null;

function closeContextMenu() {
  $('#contextMenu').hidden = true;
  contextMenuSource?.classList.remove('context-active');
  contextMenuSource = null;
}

function showContextMenu(event, { title = '', source = null, items = [] } = {}) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  const menu = $('#contextMenu');
  contextMenuSource = source;
  source?.classList.add('context-active');
  menu.innerHTML = `${title ? `<div class="context-menu-title">${escapeHtml(title)}</div>` : ''}`;
  items.forEach(item => {
    if (item.separator) {
      menu.insertAdjacentHTML('beforeend', '<div class="context-menu-separator" role="separator"></div>');
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'menuitem';
    if (item.danger) button.classList.add('danger');
    button.innerHTML = `${item.icon ? `<span>${item.icon}</span>` : ''}<span>${escapeHtml(item.label)}</span>`;
    button.addEventListener('click', () => {
      closeContextMenu();
      item.action?.();
    });
    menu.append(button);
  });
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX))}px`;
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY))}px`;
  menu.querySelector('button')?.focus({ preventScroll: true });
}

function setActiveTextureItem(item) {
  if (!item) return;
  const index = state.textureAssets.findIndex(asset => asset._uid === item.dataset.textureUid);
  if (index >= 0) activateProjectTexture(index);
}

function showElementContextMenu(event, uidValue, source = null) {
  if (!state.project.getNode(uidValue)) return;
  if (!state.selectedUids.has(uidValue)) selectItem(uidValue);
  const node = state.project.getNode(uidValue);
  const selectedNodes = selectedNodeUids().map(id => state.project.getNode(id)).filter(Boolean);
  const allVisible = selectedNodes.every(entry => entry.visible);
  showContextMenu(event, {
    title: selectedNodes.length > 1 ? `已選 ${selectedNodes.length} 項` : node.name,
    source,
    items: [
      { icon: '⌖', label: '聚焦此物件', action: focusSelected },
      { icon: allVisible ? '○' : '◉', label: allVisible ? '隱藏選中項' : '顯示選中項', action: () => {
        snapshot(); selectedNodes.forEach(entry => setNodeVisibility(entry, !allVisible)); markDirty(); renderAll();
      } },
      ...(node.type === 'group' ? [{
        icon: openIconMarkup(state.collapsedGroups.has(node.uid) ? 'down' : 'up', 'context-open-icon'),
        label: state.collapsedGroups.has(node.uid) ? '展開組' : '折疊組',
        action: () => {
          state.collapsedGroups.has(node.uid) ? state.collapsedGroups.delete(node.uid) : state.collapsedGroups.add(node.uid);
          renderOutliner();
        }
      }] : []),
      ...(selectedNodes.length > 1 ? [{ icon: '▰', label: '將選中項建立為組', action: addGroup }] : []),
      { separator: true },
      { icon: '×', label: '刪除選中項', danger: true, action: deleteSelected }
    ]
  });
}

function bindContextMenus() {
  $('#viewport').addEventListener('contextmenu', event => {
    if (state.tool === 'knife' && state.knifeSelection) {
      event.preventDefault();
      event.stopPropagation();
      cancelKnifeSelection();
      return;
    }
    if (state.tool === 'vertexSnap' && state.vertexSnapSource) {
      event.preventDefault();
      event.stopPropagation();
      state.vertexSnapSource = null;
      updateToolOptions();
      renderScene();
      toast('已取消來源頂點');
      return;
    }
    const rect = sceneCanvas.getBoundingClientRect();
    const hitUid = sceneRenderer.pick(state.project, event.clientX - rect.left, event.clientY - rect.top, state.geometryOnly);
    if (hitUid) {
      showElementContextMenu(event, hitUid);
      return;
    }
    showContextMenu(event, {
      title: selected()?.name || state.project.name,
      items: [
        { icon: '⌖', label: '聚焦選中物件', action: focusSelected },
        { icon: '◎', label: '回到場景中心', action: focusSceneOrigin },
        { separator: true },
        { icon: '#', label: state.grid ? '隱藏網格' : '顯示網格', action: () => configRegistry.set(ConfigKey.SHOW_GRID, !state.grid, { source: 'viewport-context-menu' }) },
        { icon: '▧', label: state.wire ? '隱藏邊界線框' : '顯示邊界線框', action: () => configRegistry.set(ConfigKey.SHOW_WIREFRAME, !state.wire, { source: 'viewport-context-menu' }) }
      ]
    });
  });
  outliner.addEventListener('contextmenu', event => {
    const item = event.target.closest('.outliner-item');
    if (!item) { event.preventDefault(); event.stopPropagation(); return; }
    const uidValue = item.dataset.uid;
    const source = outliner.querySelector(`[data-uid="${uidValue}"]`);
    showElementContextMenu(event, uidValue, source);
  });
  $('#textureList').addEventListener('contextmenu', event => {
    const item = event.target.closest('.texture-item');
    const groupNode = event.target.closest('.texture-group');
    if (item) setActiveTextureItem(item);
    if (item) {
      const asset = state.textureAssets.find(entry => entry._uid === item.dataset.textureUid);
      return showContextMenu(event, { title: asset?.name || '貼圖', source: item, items: [
        { icon: '◉', label: '設為目前貼圖', action: () => setActiveTextureItem(item) },
        { icon: '▰', label: '移到新貼圖組', action: addTextureGroup },
        { separator: true },
        { icon: '×', label: '刪除貼圖', danger: true, action: () => {
          state.textureAssets = state.textureAssets.filter(entry => entry._uid !== asset?._uid);
          if (state.activeTextureUid === asset?._uid) state.activeTextureUid = null;
          renderTextureList(); renderTexture(); renderScene();
        } }
      ] });
    }
    if (groupNode) {
      const group = state.textureGroups.find(entry => entry.id === groupNode.dataset.textureGroup);
      return showContextMenu(event, { title: group?.name || '貼圖組', source: groupNode, items: [
        { icon: openIconMarkup(group?.collapsed ? 'down' : 'up', 'context-open-icon'), label: group?.collapsed ? '展開組' : '折疊組', action: () => { group.collapsed = !group.collapsed; renderTextureList(); } },
        { icon: '×', label: '解散貼圖組', action: () => {
          state.textureAssets.forEach(asset => { if (asset.groupId === group.id) asset.groupId = null; });
          state.textureGroups = state.textureGroups.filter(entry => entry.id !== group.id); renderTextureList();
        } }
      ] });
    }
    event.preventDefault();
  });
  $('#texturePreview').addEventListener('contextmenu', event => showContextMenu(event, { title: '貼圖預覽', source: $('#texturePreview'), items: [
    { icon: '◒', label: '在繪畫模式打開', action: () => setMode('paint') },
    { icon: '＋', label: '導入新貼圖', action: () => textureInput.click() }
  ] }));
  $('#paletteRows').addEventListener('contextmenu', event => {
    const rowNode = event.target.closest('.palette-row-card');
    if (!rowNode) return;
    const index = paletteRows.findIndex(row => row.id === rowNode.dataset.paletteId);
    const row = paletteRows[index];
    showContextMenu(event, { title: row.name, source: rowNode, items: [
      { icon: '◫', label: row.gradient ? '改用離散色卡' : '啟用連續漸變', action: () => { row.gradient = !row.gradient; renderPalette(); } },
      { icon: '＋', label: '新增色卡行', action: addPaletteRow }
    ] });
  });
  inspector.addEventListener('contextmenu', event => {
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const item = selected();
    if (!item) return;
    showContextMenu(event, { title: item.name, source: event.target.closest('.field-section'), items: [
      { icon: '⌖', label: '聚焦此物件', action: focusSelected },
      { icon: item.visible ? '◉' : '○', label: item.visible ? '隱藏' : '顯示', action: () => { snapshot(); setNodeVisibility(item, !item.visible); markDirty(); renderAll(); } }
    ] });
  });
  $('.workspace').addEventListener('contextmenu', event => {
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    showContextMenu(event, { title: 'CubeBricks', items: [
      { icon: '⌖', label: '聚焦選中物件', action: focusSelected },
      { icon: '◎', label: '回到場景中心', action: focusSceneOrigin }
    ] });
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#contextMenu')) closeContextMenu(); });
  window.addEventListener('blur', closeContextMenu);
}

function bindEvents() {
  // Chromium may promote a pointer-focused button to :focus-visible when a
  // modifier key is pressed later. Only Tab explicitly enters keyboard focus
  // navigation, so Shift used for snapping never resurrects a stale outline.
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') document.body.classList.add('keyboard-navigation');
  }, true);
  document.addEventListener('pointerdown', () => {
    document.body.classList.remove('keyboard-navigation');
  }, true);
  bindContextMenus();
  $$('.mode-tab').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $$('.tool').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
  $$('.dock-tab').forEach(button => button.addEventListener('click', () => activateDock(button.dataset.dock)));
  $('[data-action="addCube"]').addEventListener('click', addCube);
  $('[data-action="addShape"]').addEventListener('click', addShape);
  $('[data-action="addLocator"]').addEventListener('click', addLocator);
  $('[data-action="addGroup"]').addEventListener('click', addGroup);
  $('.outliner-create-actions [data-action="deleteSelected"]').addEventListener('click', deleteSelected);
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
    updateToolOptions();
    renderScene();
  }));
  $$('[data-rotation-mode]').forEach(button => button.addEventListener('click', () => {
    state.rotationMode = button.dataset.rotationMode;
    updateRotationModeButtons();
    renderScene();
  }));
  $$('[data-multi-transform-mode]').forEach(button => button.addEventListener('click', () => {
    state.multiTransformMode = button.dataset.multiTransformMode;
    updateMultiTransformModeButtons();
    renderScene();
  }));
  $$('[data-scale-handle-mode]').forEach(button => button.addEventListener('click', () => {
    state.scaleHandleMode = button.dataset.scaleHandleMode;
    updateScaleHandleModeButtons();
    renderScene();
  }));
  $$('[data-vertex-snap-mode]').forEach(button => button.addEventListener('click', () => {
    state.vertexSnapMode = button.dataset.vertexSnapMode;
    state.vertexSnapSource = null;
    updateToolOptions();
    renderScene();
  }));
  $$('[data-vertex-rotation-mode]').forEach(button => button.addEventListener('click', () => {
    state.vertexSnapRotationMode = button.dataset.vertexRotationMode;
    state.vertexSnapSource = null;
    updateToolOptions();
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
  $('[data-action="playTimeline"]').addEventListener('click', playTimeline);
  $('[data-action="stopTimeline"]').addEventListener('click', stopTimeline);
  $('[data-action="addPaletteRow"]').addEventListener('click', addPaletteRow);
  $('#outlinerSearch').addEventListener('input', renderOutliner);
  outliner.addEventListener('scroll', scheduleOutlinerWindow, { passive: true });
  outliner.addEventListener('click', event => {
    const button = event.target.closest('[data-uid]');
    if (!button) { clearSelection(); return; }
    const visibility = event.target.closest('[data-toggle-visible]');
    if (visibility) {
      const node = state.project.getNode(visibility.dataset.toggleVisible);
      snapshot(); setNodeVisibility(node, !node.visible); markDirty(); renderAll(); return;
    }
    const disclosure = event.target.closest('[data-disclosure]');
    if (disclosure?.dataset.disclosure) {
      const uidValue = disclosure.dataset.disclosure;
      state.collapsedGroups.has(uidValue) ? state.collapsedGroups.delete(uidValue) : state.collapsedGroups.add(uidValue);
      renderOutliner(); return;
    }
    selectItem(button.dataset.uid, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
  });
  outliner.addEventListener('dragstart', event => {
    const item = event.target.closest('.outliner-item');
    if (!item) return;
    if (!state.selectedUids.has(item.dataset.uid)) {
      sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
      state.selectedUid = item.dataset.uid;
      state.selectedUids = new Set([item.dataset.uid]);
      state.selectionAnchorUid = item.dataset.uid;
      outliner.querySelectorAll('.outliner-item.active').forEach(row => row.classList.remove('active'));
      item.classList.add('active');
      sceneRenderer.invalidateSelectionGeometry();
      renderInspector(); renderScene(); updateSelectionLabels();
    }
    state.outlinerDragUids = topLevelSelectedUids();
    state.outlinerDragUids.forEach(uidValue =>
      outliner.querySelector(`.outliner-item[data-uid="${CSS.escape(uidValue)}"]`)?.classList.add('is-dragging'));
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/x-cubebricks-outliner', state.outlinerDragUids.join(','));
    const ghost = createOutlinerDragGhost(state.outlinerDragUids);
    event.dataTransfer.setDragImage(ghost, 24, 17);
  });
  outliner.addEventListener('dragover', event => {
    if (!state.outlinerDragUids?.length) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearOutlinerDropState({ keepDragging: true });
    const item = event.target.closest('.outliner-item');
    if (!item) return;
    const node = state.project.getNode(item.dataset.uid);
    const rect = item.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    const zone = node?.type === 'group' && ratio > .27 && ratio < .73 ? 'inside' : ratio < .5 ? 'before' : 'after';
    item.classList.add(`drop-${zone}`);
    item.dataset.dropZone = zone;
  });
  outliner.addEventListener('drop', event => {
    if (!state.outlinerDragUids?.length) return;
    event.preventDefault();
    const item = event.target.closest('.outliner-item');
    const targetUid = item?.dataset.uid || null;
    const zone = item?.dataset.dropZone || 'after';
    clearOutlinerDropState();
    removeOutlinerDragGhost();
    moveSelectedNodes(targetUid, zone);
    state.outlinerDragUids = null;
  });
  outliner.addEventListener('dragend', () => {
    clearOutlinerDropState();
    removeOutlinerDragGhost();
    state.outlinerDragUids = null;
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
  $('[data-action="addTextureGroup"]').addEventListener('click', addTextureGroup);
  $('#textureList').addEventListener('click', event => {
    const groupToggle = event.target.closest('[data-texture-group-toggle]');
    if (groupToggle) {
      const group = state.textureGroups.find(entry => entry.id === groupToggle.dataset.textureGroupToggle);
      if (group) { group.collapsed = !group.collapsed; renderTextureList(); }
      return;
    }
    const item = event.target.closest('.texture-item'); if (!item) return;
    setActiveTextureItem(item);
  });
  $('#textureList').addEventListener('dragstart', event => {
    const item = event.target.closest('.texture-item');
    const group = !item && event.target.closest('.texture-group');
    if (!item && !group) return;
    state.textureDrag = item ? { type: 'asset', id: item.dataset.textureUid } : { type: 'group', id: group.dataset.textureGroup };
    (item || group).classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/x-cubebricks-texture', `${state.textureDrag.type}:${state.textureDrag.id}`);
  });
  $('#textureList').addEventListener('dragover', event => {
    if (!state.textureDrag) return;
    event.preventDefault();
    $('#textureList').querySelectorAll('.drop-before,.drop-after,.drop-inside').forEach(node => node.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    const item = event.target.closest('.texture-item');
    const group = !item && event.target.closest('.texture-group');
    if (item && state.textureDrag.type === 'asset') {
      const zone = event.clientY < item.getBoundingClientRect().top + item.offsetHeight / 2 ? 'before' : 'after';
      item.classList.add(`drop-${zone}`); item.dataset.dropZone = zone;
    } else if (group) group.classList.add('drop-inside');
  });
  $('#textureList').addEventListener('drop', event => {
    if (!state.textureDrag) return;
    event.preventDefault();
    const item = event.target.closest('.texture-item');
    const groupNode = !item && event.target.closest('.texture-group');
    if (state.textureDrag.type === 'asset') {
      const asset = state.textureAssets.find(entry => entry._uid === state.textureDrag.id);
      if (asset && item && item.dataset.textureUid !== asset._uid) {
        const target = state.textureAssets.find(entry => entry._uid === item.dataset.textureUid);
        state.textureAssets = state.textureAssets.filter(entry => entry !== asset);
        const targetIndex = state.textureAssets.indexOf(target);
        state.textureAssets.splice(targetIndex + (item.dataset.dropZone === 'after' ? 1 : 0), 0, asset);
        asset.groupId = target.groupId || null;
      } else if (asset && groupNode) asset.groupId = groupNode.dataset.textureGroup;
      else if (asset) asset.groupId = null;
    } else if (state.textureDrag.type === 'group' && groupNode && groupNode.dataset.textureGroup !== state.textureDrag.id) {
      const moving = state.textureGroups.find(entry => entry.id === state.textureDrag.id);
      const target = state.textureGroups.find(entry => entry.id === groupNode.dataset.textureGroup);
      state.textureGroups = state.textureGroups.filter(entry => entry !== moving);
      state.textureGroups.splice(state.textureGroups.indexOf(target) + 1, 0, moving);
    }
    state.textureDrag = null;
    renderTextureList();
  });
  $('#textureList').addEventListener('dragend', () => { state.textureDrag = null; renderTextureList(); });
  $$('[data-view-axis]').forEach(button => button.addEventListener('click', () => {
    cancelCameraFocus();
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
    const handle = resolveGizmoHandle(event);
    if (!handle) return;
    event.preventDefault(); event.stopPropagation();
    if (handle.dataset.kind === 'vertex') {
      useVertexSnapPoint(state.vertexSnapPoints?.[Number(handle.dataset.vertexIndex)]);
      return;
    }
    const axisKey = handle.dataset.axis;
    const axisIndex = /^[0-2]$/.test(axisKey) ? Number(axisKey) : null;
    const axisIndices = handle.dataset.axes
      ? handle.dataset.axes.split(',').map(Number).filter(index => index >= 0 && index <= 2)
      : axisIndex === null ? [] : [axisIndex];
    const axisSigns = handle.dataset.signs
      ? handle.dataset.signs.split(',').map(Number)
      : axisIndex === null ? [] : [Number(handle.dataset.sign || 1)];
    startTransformDrag(event, axisIndex, event.currentTarget, handle.dataset.kind || 'free',
      Number(handle.dataset.sign || 1), handle, axisKey, axisIndices, axisSigns);
  });
  $('#transformGizmo').addEventListener('pointermove', event => { updateGizmoDepthHover(event); onPointerMove(event); });
  $('#transformGizmo').addEventListener('pointerleave', () => {
    $('#transformGizmo').querySelectorAll('.depth-hover').forEach(control => control.classList.remove('depth-hover'));
  });
  $('#transformGizmo').addEventListener('pointerup', endPointerDrag);
  $('#transformGizmo').addEventListener('pointercancel', endPointerDrag);
  sceneCanvas.addEventListener('pointerdown', onPointerDown);
  sceneCanvas.addEventListener('pointermove', onPointerMove);
  sceneCanvas.addEventListener('pointerleave', () => {
    if (state.tool !== 'knife' || state.dragging) return;
    state.knifeHover = null;
    renderScene();
  });
  sceneCanvas.addEventListener('pointerup', endPointerDrag);
  sceneCanvas.addEventListener('pointercancel', endPointerDrag);
  sceneCanvas.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
  sceneCanvas.addEventListener('wheel', event => { event.preventDefault(); cancelCameraFocus(); state.zoom = Math.max(.002, Math.min(100, state.zoom * (event.deltaY > 0 ? .9 : 1.1))); renderScene(); }, { passive: false });
  window.addEventListener('resize', renderScene);
  window.addEventListener('keydown', event => {
    if (event.target.matches('input,select')) return;
    if (event.key === 'Escape') setRenderModeMenu(false);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(event.shiftKey); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if (event.key === 'Delete') deleteSelected();
    if (event.key.toLowerCase() === 'f') { cancelCameraFocus(); state.zoom = 1.12; state.panX = 0; state.panY = 0; renderScene(); }
    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      event.shiftKey ? focusSceneOrigin() : focusSelected();
    }
    const shortcuts = { '1': 'move', '2': 'resize', '3': 'rotate', '4': 'pivot', '5': 'vertexSnap', '6': 'knife' }; if (shortcuts[event.key]) setTool(shortcuts[event.key]);
    if (state.tool === 'knife' && state.knifePointer && ['Shift', 'Control'].includes(event.key)) refreshKnifeFromModifierEvent(event);
  });
  window.addEventListener('keyup', event => {
    if (state.tool === 'knife' && state.knifePointer && ['Shift', 'Control'].includes(event.key)) refreshKnifeFromModifierEvent(event);
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
  if (state.tool === 'knife') {
    event.preventDefault();
    useKnifePoint(event);
    return;
  }
  const hitUid = sceneRenderer.pick(state.project, x, y, state.geometryOnly);
  if (hitUid) selectItem(hitUid, {
    revealInOutliner: true,
    toggle: event.ctrlKey || event.metaKey,
    range: event.shiftKey
  });
  else clearSelection();
}

function startCameraDrag(event, captureTarget) {
  event.preventDefault();
  cancelCameraFocus();
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

function translateItemByLocalDelta(item, delta) {
  if (item.type === 'cube') {
    item.position = item.position.map((value, axis) => value + delta[axis]);
    item.pivot = item.pivot.map((value, axis) => value + delta[axis]);
  } else if (item.type === 'shape') item.origin = item.origin.map((value, axis) => value + delta[axis]);
  else if (item.type === 'locator') item.position = item.position.map((value, axis) => value + delta[axis]);
  else if (item.type === 'group') {
    const members = captureGroupMembers(item);
    item.pivot = item.pivot.map((value, axis) => value + delta[axis]);
    members.forEach(member => {
      if (member.node.type === 'cube') {
        member.node.position = member.position.map((value, axis) => value + delta[axis]);
        member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      } else if (member.node.type === 'shape') member.node.origin = member.position.map((value, axis) => value + delta[axis]);
      else if (member.node.type === 'locator') member.node.position = member.position.map((value, axis) => value + delta[axis]);
      else member.node.pivot = member.position.map((value, axis) => value + delta[axis]);
    });
  }
}

function worldVectorToParentLocal(item, vector) {
  let local = [...vector];
  state.project.getGroupChain(item.uid).forEach(group => { local = inverseRotateVector(local, group.rotation || [0, 0, 0]); });
  return local;
}

function worldPointToParentLocal(item, worldPoint) {
  let local = [...worldPoint];
  for (const group of state.project.getGroupChain(item.uid)) {
    const offset = local.map((value, axis) => value - group.pivot[axis]);
    local = inverseRotateVector(offset, group.rotation || [0, 0, 0]).map((value, axis) => value + group.pivot[axis]);
  }
  return local;
}

function worldPointToCubeLocal(cube, worldPoint) {
  let local = worldPointToParentLocal(cube, worldPoint);
  const offset = local.map((value, axis) => value - cube.pivot[axis]);
  return inverseRotateVector(offset, cube.rotation || [0, 0, 0]).map((value, axis) => value + cube.pivot[axis]);
}

function quaternionFromVectors(from, to) {
  const first = normalize3(from), second = normalize3(to);
  const cosine = Math.max(-1, Math.min(1, dot3(first, second)));
  if (cosine < -0.999999) {
    const reference = Math.abs(first[0]) < .8 ? [1, 0, 0] : [0, 1, 0];
    return quaternionFromAxisAngle(normalize3(cross3(first, reference)), 180);
  }
  const axis = cross3(first, second);
  const quaternion = [...axis, 1 + cosine];
  const length = Math.hypot(...quaternion) || 1;
  return quaternion.map(value => value / length);
}

function vertexRotationTurn(from, to, mode) {
  if (mode === 'pivot') return quaternionFromVectors(from, to);
  let axisIndex = { x: 0, y: 1, z: 2 }[mode];
  if (mode === 'longest') {
    const cross = cross3(from, to);
    axisIndex = [0, 1, 2].reduce((best, axis) => Math.abs(cross[axis]) > Math.abs(cross[best]) ? axis : best, 0);
  }
  const axis = [0, 0, 0]; axis[axisIndex] = 1;
  const first = from.map((value, index) => index === axisIndex ? 0 : value);
  const second = to.map((value, index) => index === axisIndex ? 0 : value);
  if (Math.hypot(...first) < 1e-6 || Math.hypot(...second) < 1e-6) return null;
  const angle = Math.atan2(dot3(axis, cross3(first, second)), dot3(first, second)) * 180 / Math.PI;
  return quaternionFromAxisAngle(axis, angle);
}

function useVertexSnapPoint(pointEntry) {
  const currentItem = selected();
  if (!currentItem || !pointEntry) return;
  if (!state.vertexSnapSource) {
    state.vertexSnapSource = { rootUid: currentItem.uid, uid: pointEntry.uid, pointType: pointEntry.pointType, point: [...pointEntry.point] };
    updateToolOptions();
    renderScene();
    return;
  }
  const sourceItem = state.project.getNode(state.vertexSnapSource.rootUid);
  if (!sourceItem) {
    state.vertexSnapSource = null;
    updateToolOptions();
    return;
  }
  if (state.vertexSnapMode === 'scale' && sourceItem.type !== 'cube') return toast('縮放捕捉目前只適用於 Cube');
  if (state.vertexSnapMode === 'rotate' && !sourceItem.rotation) return toast('這個物件不能旋轉捕捉');
  snapshot();
  if (state.vertexSnapMode === 'move') {
    if (state.vertexSnapSource.pointType === 'pivot' && ['cube', 'group'].includes(sourceItem.type)) {
      setPivotPreservingGeometry(state.project, sourceItem, worldPointToParentLocal(sourceItem, pointEntry.point));
    } else {
      const worldDelta = pointEntry.point.map((value, axis) => value - state.vertexSnapSource.point[axis]);
      translateItemByLocalDelta(sourceItem, worldVectorToParentLocal(sourceItem, worldDelta));
    }
  } else if (state.vertexSnapMode === 'scale') {
    freezeCubeUvs(sourceItem);
    const sourcePoint = worldPointToCubeLocal(sourceItem, state.vertexSnapSource.point);
    const targetPoint = worldPointToCubeLocal(sourceItem, pointEntry.point);
    const nextPosition = [...sourceItem.position], nextSize = [...sourceItem.size];
    for (let axis = 0; axis < 3; axis++) {
      const start = sourceItem.position[axis], end = start + sourceItem.size[axis];
      if (Math.abs(sourcePoint[axis] - start) <= Math.abs(sourcePoint[axis] - end)) {
        nextPosition[axis] = targetPoint[axis];
        nextSize[axis] = end - targetPoint[axis];
      } else nextSize[axis] = targetPoint[axis] - start;
      if (!state.allowNegativeSize && nextSize[axis] < 0) {
        nextPosition[axis] += nextSize[axis];
        nextSize[axis] = Math.abs(nextSize[axis]);
      }
    }
    sourceItem.position = nextPosition;
    sourceItem.size = nextSize;
  } else {
    const pivot = sourceItem.pivot || sourceItem.origin || sourceItem.position;
    const sourcePoint = worldPointToParentLocal(sourceItem, state.vertexSnapSource.point);
    const targetPoint = worldPointToParentLocal(sourceItem, pointEntry.point);
    const from = sourcePoint.map((value, axis) => value - pivot[axis]);
    const to = targetPoint.map((value, axis) => value - pivot[axis]);
    const turn = Math.hypot(...from) > 1e-6 && Math.hypot(...to) > 1e-6
      ? vertexRotationTurn(from, to, state.vertexSnapRotationMode)
      : null;
    if (!turn) {
      state.history.pop();
      return toast('所選頂點無法建立旋轉方向');
    }
    sourceItem.rotation = eulerFromQuaternion(quaternionMultiply(turn, quaternionFromEuler(sourceItem.rotation || [0, 0, 0])));
  }
  const completedMode = state.vertexSnapMode;
  const movedPivotOnly = completedMode === 'move' && state.vertexSnapSource.pointType === 'pivot';
  state.vertexSnapSource = null;
  markDirty();
  sceneRenderer.invalidateGeometry();
  renderAll();
  toast(movedPivotOnly ? '已將樞軸移至目標頂點（幾何保持不動）'
    : { move: '已移動至目標頂點', scale: '已縮放至目標頂點', rotate: '已旋轉對齊目標頂點' }[completedMode]);
}

function clamp(value, minimum, maximum) {
  return Math.max(Math.min(minimum, maximum), Math.min(Math.max(minimum, maximum), value));
}

function cubeLocalPointToWorld(cube, localPoint) {
  const offset = localPoint.map((value, axis) => value - cube.pivot[axis]);
  const rotated = rotateVector(offset, cube.rotation || [0, 0, 0]).map((value, axis) => value + cube.pivot[axis]);
  return applyGroupTransforms(rotated, state.project.getGroupChain(cube.uid));
}

function getKnifeCandidate(event) {
  const rect = sceneCanvas.getBoundingClientRect();
  const hit = sceneRenderer.pickDetailed(state.project, event.clientX - rect.left, event.clientY - rect.top, true);
  const cube = hit && state.project.getNode(hit.uid);
  const faceAxes = hit && getKnifeFaceAxes(hit.faceName);
  if (!hit || cube?.type !== 'cube' || !faceAxes) return null;
  const localPoint = worldPointToCubeLocal(cube, hit.point);
  for (const axis of [faceAxes.horizontal, faceAxes.vertical]) {
    localPoint[axis] = clamp(snapValue(localPoint[axis], event), cube.position[axis], cube.position[axis] + cube.size[axis]);
  }
  return { uid: cube.uid, faceName: hit.faceName, localPoint, worldPoint: cubeLocalPointToWorld(cube, localPoint) };
}

function getKnifePreviewAxis() {
  if (!state.knifeSelection || !state.knifeHover
    || state.knifeSelection.uid !== state.knifeHover.uid
    || state.knifeSelection.faceName !== state.knifeHover.faceName) return null;
  const cube = state.project.getNode(state.knifeSelection.uid);
  return chooseKnifeCutAxis(state.knifeSelection.localPoint, state.knifeHover.localPoint,
    state.knifeSelection.faceName, cube);
}

function getKnifePreviewLabel(axis = getKnifePreviewAxis()) {
  const faceAxes = state.knifeSelection && getKnifeFaceAxes(state.knifeSelection.faceName);
  if (axis === null || !faceAxes) return null;
  return axis === faceAxes.horizontal ? '豎切' : '橫切';
}

function updateKnifeHover(event) {
  state.knifePointer = {
    clientX: event.clientX,
    clientY: event.clientY,
    shiftKey: Boolean(event.shiftKey),
    ctrlKey: Boolean(event.ctrlKey || event.metaKey)
  };
  const candidate = getKnifeCandidate(event);
  state.knifeHover = state.knifeSelection && candidate
    && (candidate.uid !== state.knifeSelection.uid || candidate.faceName !== state.knifeSelection.faceName)
    ? null
    : candidate;
  updateToolOptions();
  renderScene();
}

function refreshKnifeFromModifierEvent(event) {
  updateKnifeHover({
    ...state.knifePointer,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey || event.metaKey
  });
}

function cancelKnifeSelection(notify = true) {
  const hadSelection = Boolean(state.knifeSelection);
  state.knifeSelection = null;
  state.knifeHover = null;
  state.knifePointer = null;
  updateToolOptions();
  if (state.tool === 'knife') renderScene();
  if (notify && hadSelection) toast('已取消切割點');
}

function completeKnifeCut(cube, axis, coordinate) {
  snapshot();
  freezeCubeUvs(cube);
  const second = splitCubeAt(cube, axis, coordinate);
  if (!second) {
    state.history.pop();
    return toast('切割位置必須位於 Cube 內部');
  }
  state.project.elements.push(second);
  const parent = state.project.getParentGroup(cube.uid);
  const container = parent ? parent.children : state.project.outliner;
  const index = container.indexOf(cube.uid);
  container.splice(index < 0 ? container.length : index + 1, 0, second.uid);
  const cutLabel = getKnifePreviewLabel(axis);
  state.knifeSelection = null;
  state.knifeHover = null;
  state.knifePointer = null;
  markDirty();
  renderAll();
  toast(`已${cutLabel || '完成切割'} ${cube.name}（${'XYZ'[axis]} 軸）`);
}

function useKnifePoint(event) {
  const candidate = getKnifeCandidate(event);
  if (!candidate) return toast(state.knifeSelection ? '第二點必須位於同一個 Cube 面上' : '刀具目前只能切割 Cube');
  const cube = state.project.getNode(candidate.uid);
  if (!state.knifeSelection) {
    if (cube.uid !== state.selectedUid) selectItem(cube.uid, { revealInOutliner: true });
    state.knifeSelection = candidate;
    state.knifeHover = candidate;
    updateToolOptions();
    renderScene();
    toast('已選擇切割點；再選橫切或豎切方向');
    return;
  }
  if (candidate.uid !== state.knifeSelection.uid || candidate.faceName !== state.knifeSelection.faceName) {
    return toast('第二點必須位於同一個 Cube 面上');
  }
  state.knifeHover = candidate;
  const axis = getKnifePreviewAxis();
  if (axis === null) return toast('這個吸附點無法建立有效切面');
  completeKnifeCut(cube, axis, state.knifeSelection.localPoint[axis]);
}

function cssLineColor(variable, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  const rgb = /^#[0-9a-f]{6}$/i.test(value) ? hexToRgb(value) : fallback;
  return [...rgb.map(channel => channel / 255), 1];
}

function offsetKnifePoint(cube, localPoint, faceName) {
  const axes = getKnifeFaceAxes(faceName);
  const point = [...localPoint];
  const center = cube.position[axes.normal] + cube.size[axes.normal] / 2;
  const fallbackSign = ['east', 'up', 'south'].includes(faceName) ? 1 : -1;
  point[axes.normal] += (Math.sign(point[axes.normal] - center) || fallbackSign) * .012;
  return point;
}

function pushKnifeLocalLine(lines, cube, faceName, start, end, color) {
  lines.push({
    start: cubeLocalPointToWorld(cube, offsetKnifePoint(cube, start, faceName)),
    end: cubeLocalPointToWorld(cube, offsetKnifePoint(cube, end, faceName)),
    color
  });
}

function pushKnifeCutLoop(lines, cube, cutAxis, coordinate, color) {
  const [firstAxis, secondAxis] = [0, 1, 2].filter(axis => axis !== cutAxis);
  const inflate = cube.inflate || 0;
  const direction = cube.size.map(value => value < 0 ? -1 : 1);
  const surfaceStart = cube.position.map((value, axis) => value - direction[axis] * inflate);
  const surfaceEnd = cube.position.map((value, axis) => value + cube.size[axis] + direction[axis] * inflate);
  const minimum = surfaceStart.map((value, axis) => Math.min(value, surfaceEnd[axis]));
  const maximum = surfaceStart.map((value, axis) => Math.max(value, surfaceEnd[axis]));
  const point = (first, second) => {
    const result = [0, 0, 0];
    result[cutAxis] = coordinate;
    result[firstAxis] = first;
    result[secondAxis] = second;
    return result;
  };
  const corners = [
    point(minimum[firstAxis], minimum[secondAxis]),
    point(maximum[firstAxis], minimum[secondAxis]),
    point(maximum[firstAxis], maximum[secondAxis]),
    point(minimum[firstAxis], maximum[secondAxis])
  ];
  const edges = [
    [0, 1, secondAxis, -1],
    [1, 2, firstAxis, 1],
    [2, 3, secondAxis, 1],
    [3, 0, firstAxis, -1]
  ];
  for (const [startIndex, endIndex, normalAxis, normalSign] of edges) {
    const start = [...corners[startIndex]], end = [...corners[endIndex]];
    start[normalAxis] += normalSign * .012;
    end[normalAxis] += normalSign * .012;
    lines.push({ start: cubeLocalPointToWorld(cube, start), end: cubeLocalPointToWorld(cube, end), color });
  }
}

function pushKnifeCross(lines, candidate, color) {
  if (!candidate) return;
  const cube = state.project.getNode(candidate.uid);
  const axes = cube && getKnifeFaceAxes(candidate.faceName);
  if (!cube || !axes) return;
  const shortest = Math.min(Math.abs(cube.size[axes.horizontal]), Math.abs(cube.size[axes.vertical]));
  const radius = Math.max(.18, Math.min(.52, shortest * .06 || .3));
  const thickness = Math.max(.012, Math.min(.026, radius * .05));
  for (const axis of [axes.horizontal, axes.vertical]) {
    const thicknessAxis = axis === axes.horizontal ? axes.vertical : axes.horizontal;
    for (const offset of [-thickness, 0, thickness]) {
      const start = [...candidate.localPoint], end = [...candidate.localPoint];
      start[axis] = clamp(start[axis] - radius, cube.position[axis], cube.position[axis] + cube.size[axis]);
      end[axis] = clamp(end[axis] + radius, cube.position[axis], cube.position[axis] + cube.size[axis]);
      start[thicknessAxis] = end[thicknessAxis] = clamp(candidate.localPoint[thicknessAxis] + offset,
        cube.position[thicknessAxis], cube.position[thicknessAxis] + cube.size[thicknessAxis]);
      pushKnifeLocalLine(lines, cube, candidate.faceName, start, end, color);
    }
  }
}

function buildKnifeOverlayLines() {
  if (state.tool !== 'knife') return [];
  const lines = [];
  const accent = cssLineColor('--accent', [230, 162, 13]);
  const selectedColor = cssLineColor('--selection-outline', [255, 240, 200]);
  if (state.knifeSelection) pushKnifeCross(lines, state.knifeSelection, selectedColor);
  else if (state.knifeHover) pushKnifeCross(lines, state.knifeHover, accent);
  const axis = getKnifePreviewAxis();
  if (axis === null || !state.knifeSelection) return lines;
  const cube = state.project.getNode(state.knifeSelection.uid);
  pushKnifeCutLoop(lines, cube, axis, state.knifeSelection.localPoint[axis], accent);
  return lines;
}

function nodeTransformAnchor(node) {
  if (node.type === 'cube' || node.type === 'group') return node.pivot;
  if (node.type === 'shape') return node.origin;
  return node.position;
}

function captureTransformTarget(node) {
  return {
    node,
    chain: state.project.getGroupChain(node.uid),
    anchor: [...nodeTransformAnchor(node)],
    position: node.position ? [...node.position] : node.origin ? [...node.origin] : node.pivot ? [...node.pivot] : [0, 0, 0],
    pivot: node.pivot ? [...node.pivot] : null,
    rotation: [...(node.rotation || [0, 0, 0])],
    size: node.size ? [...node.size] : null,
    radius: node.parameters?.radius,
    height: node.parameters?.height,
    groupMembers: node.type === 'group' ? captureGroupMembers(node) : []
  };
}

function translateCapturedTarget(target, delta) {
  const { node } = target;
  if (node.type === 'cube') {
    node.position = target.position.map((value, axis) => value + delta[axis]);
    node.pivot = target.pivot.map((value, axis) => value + delta[axis]);
  } else if (node.type === 'shape') node.origin = target.position.map((value, axis) => value + delta[axis]);
  else if (node.type === 'locator') node.position = target.position.map((value, axis) => value + delta[axis]);
  else if (node.type === 'group') {
    node.pivot = target.position.map((value, axis) => value + delta[axis]);
    target.groupMembers.forEach(member => {
      if (member.node.type === 'cube') {
        member.node.position = member.position.map((value, axis) => value + delta[axis]);
        member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      } else if (member.node.type === 'shape') member.node.origin = member.position.map((value, axis) => value + delta[axis]);
      else if (member.node.type === 'locator') member.node.position = member.position.map((value, axis) => value + delta[axis]);
      else member.node.pivot = member.position.map((value, axis) => value + delta[axis]);
    });
  }
}

function localDirectionFromWorld(direction, chain) {
  let local = [...direction];
  chain.forEach(group => { local = inverseRotateVector(local, group.rotation || [0, 0, 0]); });
  return normalize3(local);
}

function localDeltaFromWorld(target, worldDelta) {
  const worldAnchor = applyGroupTransforms(target.anchor, target.chain);
  const nextWorld = worldAnchor.map((value, axis) => value + worldDelta[axis]);
  const nextLocal = inverseApplyGroupTransforms(nextWorld, target.chain);
  return nextLocal.map((value, axis) => value - target.anchor[axis]);
}

function rotatePointAroundAxis(point, pivot, axis, degrees) {
  const direction = normalize3(axis);
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const offset = point.map((value, index) => value - pivot[index]);
  const crossed = cross3(direction, offset);
  const aligned = dot3(direction, offset) * (1 - cosine);
  return offset.map((value, index) => pivot[index] + value * cosine + crossed[index] * sine + direction[index] * aligned);
}

function applyTargetRotation(target, worldAxis, degrees, { separate = false, selfRelative = false, axisIndex = null, euler = false } = {}) {
  const { node } = target;
  if (euler && separate && axisIndex !== null) {
    node.rotation = [...target.rotation];
    node.rotation[axisIndex] = target.rotation[axisIndex] + degrees;
    return;
  }
  const localAxis = selfRelative && axisIndex !== null
    ? [0, 1, 2].map(index => index === axisIndex ? 1 : 0)
    : localDirectionFromWorld(worldAxis, target.chain);
  const turn = quaternionFromAxisAngle(localAxis, degrees);
  const current = quaternionFromEuler(target.rotation);
  node.rotation = eulerFromQuaternion(separate && selfRelative
    ? quaternionMultiply(current, turn)
    : quaternionMultiply(turn, current));
}

function startTransformDrag(event, axisIndex, captureTarget, kind = 'free', sign = 1, handleElement = null,
  axisKey = axisIndex === null ? 'free' : String(axisIndex), axisIndices = axisIndex === null ? [] : [axisIndex], axisSigns = [sign]) {
  if (event.button !== 0) return;
  const selectionContext = getSelectionTransformContext();
  let item = selected();
  if (state.tool === 'pivot' && selectionContext.multiple) item = selectionContext.commonGroup;
  if (!item || !['move', 'resize', 'rotate', 'pivot'].includes(state.tool)) return;
  const targetNodes = state.tool === 'resize'
    ? selectedElementUids().map(uidValue => state.project.getNode(uidValue)).filter(Boolean)
    : selectionContext.nodes;
  const targets = selectionContext.multiple && ['move', 'rotate', 'resize'].includes(state.tool)
    ? targetNodes.map(captureTransformTarget)
    : [captureTransformTarget(item)];
  const rect = sceneCanvas.getBoundingClientRect();
  let handle = axisIndex === null ? null : state.gizmoAxes?.[axisIndex];
  const referenceHandle = handle || state.gizmoAxes?.[axisIndices[0]] || null;
  if (kind === 'rotate-view') {
    const cameraFrame = sceneRenderer.getCameraFrame();
    handle = {
      vector: [...cameraFrame.forward], screen: [1, 0, 0], worldPerPixel: cameraFrame.worldPerPixel,
      centerX: state.gizmoCenter.x, centerY: state.gizmoCenter.y
    };
  }
  const chain = state.project.getGroupChain(item.uid);
  const cameraFrame = sceneRenderer.getCameraFrame();
  const freeMovePlane = kind === 'free' && ['move', 'pivot'].includes(state.tool)
    ? { point: [...state.gizmoOrigin], normal: [...cameraFrame.forward] }
    : null;
  const freeMoveStart = freeMovePlane
    ? intersectRayPlane(sceneRenderer.getScreenRay(event.clientX - rect.left, event.clientY - rect.top), freeMovePlane.point, freeMovePlane.normal)
    : null;
  let storedAxis = handle ? handle.vector.map(value => value * sign) : null;
  const planeAxes = kind.startsWith('plane') ? axisIndices.map((index, pairIndex) => {
    const source = state.gizmoAxes[index];
    const axisSign = axisSigns[pairIndex] || 1;
    let stored = source.vector.map(value => value * axisSign);
    chain.forEach(group => { stored = inverseRotateVector(stored, group.rotation || [0, 0, 0]); });
    if (state.tool === 'resize' && item.type !== 'group') stored = inverseRotateVector(stored, item.rotation || [0, 0, 0]);
    return {
      index,
      sign: axisSign,
      worldAxis: source.vector.map(value => value * axisSign),
      storedAxis: stored,
      screenPerWorld: source.screenPerWorld.map(value => value * axisSign),
      worldPerPixel: source.worldPerPixel
    };
  }) : [];
  const planeDragPlane = planeAxes.length === 2
    ? { point: [...state.gizmoOrigin], normal: normalize3(cross3(planeAxes[0].worldAxis, planeAxes[1].worldAxis)) }
    : null;
  const planeDragStart = planeDragPlane
    ? intersectRayPlane(sceneRenderer.getScreenRay(event.clientX - rect.left, event.clientY - rect.top),
      planeDragPlane.point, planeDragPlane.normal)
    : null;
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
  const gizmoCenter = referenceHandle
    ? { x: referenceHandle.centerX + rect.left, y: referenceHandle.centerY + rect.top }
    : { x: state.gizmoCenter.x + rect.left, y: state.gizmoCenter.y + rect.top };
  state.dragging = {
    type: 'transform', tool: state.tool, pointerId: event.pointerId,
    snapshotTaken: false,
    x: event.clientX, y: event.clientY, item, axisIndex, axisIndices, axisSigns, axisKey,
    axis: handle ? { ...handle, screen: handle.screen.map(value => value * sign) } : null,
    planeAxes, planeDragPlane, planeDragStart,
    referenceWorldPerPixel: referenceHandle?.worldPerPixel, freeMovePlane, freeMoveStart,
    kind, sign, rotationAxis, rotationScreenSign, handleElement, gizmoCenter: handle ? gizmoCenter : null,
    rotationMode: state.transformSpace === 'self' ? state.rotationMode : 'pose',
    startAngle: kind.startsWith('rotate') && handle ? Math.atan2(event.clientY - (handle.centerY + rect.top), event.clientX - (handle.centerX + rect.left)) : 0,
    rect, storedAxis, chain, selectionContext, targets, multiTransformMode: state.multiTransformMode,
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
  if (state.tool === 'knife' && !state.dragging) {
    updateKnifeHover(event);
    return;
  }
  if (!state.dragging) return;
  const dx = event.clientX - state.dragging.x;
  const dy = event.clientY - state.dragging.y;
  if (state.dragging.type === 'transform') {
    if (Math.hypot(dx, dy) < .5) return;
    if (!state.dragging.snapshotTaken) {
      snapshot();
      state.dragging.snapshotTaken = true;
    }
    if (state.dragging.tool === 'resize' && !state.dragging.uvFrozen) {
      state.dragging.targets.filter(target => target.node.type === 'cube').forEach(target => freezeCubeUvs(target.node));
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
    sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
  }
  sceneRenderer.endTransformGhost();
  $('#transformTooltip').hidden = true;
  sceneCanvas.classList.remove('is-orbiting', 'is-panning', 'is-move', 'is-resize', 'is-rotate', 'is-pivot');
  renderScene();
}

function getPlaneDragDistances(drag, event, dx, dy) {
  const [first, second] = drag.planeAxes;
  if (!first || !second) return [];
  const pointer = drag.planeDragPlane && intersectRayPlane(
    sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
    drag.planeDragPlane.point,
    drag.planeDragPlane.normal
  );
  if (pointer && drag.planeDragStart) {
    const worldDelta = pointer.map((value, axis) => value - drag.planeDragStart[axis]);
    return [first, second].map(axis => dot3(worldDelta, axis.worldAxis));
  }
  const [ax, ay] = first.screenPerWorld;
  const [bx, by] = second.screenPerWorld;
  const pointerX = dx, pointerY = -dy;
  const determinant = ax * by - ay * bx;
  if (Math.abs(determinant) > .0001) {
    return [
      (pointerX * by - pointerY * bx) / determinant,
      (ax * pointerY - ay * pointerX) / determinant
    ];
  }
  return [first, second].map(axis => {
    const direction = normalize3([axis.screenPerWorld[0], axis.screenPerWorld[1], 0]);
    return (pointerX * direction[0] + pointerY * direction[1]) * axis.worldPerPixel;
  });
}

function getPlaneUniformDistance(drag, dx, dy) {
  const [first, second] = drag.planeAxes;
  if (!first || !second) return 0;
  const combined = [
    first.screenPerWorld[0] + second.screenPerWorld[0],
    first.screenPerWorld[1] + second.screenPerWorld[1]
  ];
  const lengthSquared = dot3([combined[0], combined[1], 0], [combined[0], combined[1], 0]);
  if (lengthSquared < .0001) return 0;
  return (dx * combined[0] + -dy * combined[1]) / lengthSquared;
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
  const fallbackScale = drag.axis?.worldPerPixel || drag.referenceWorldPerPixel || (state.projection === 'perspective'
    ? 2 * (42 / state.zoom) * Math.tan(Math.PI / 8) / drag.rect.height
    : 36 / (drag.rect.height * state.zoom));
  if (drag.tool === 'pivot') {
    let delta;
    if (drag.kind === 'plane') {
      const distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
      delta = [0, 0, 0];
      drag.planeAxes.forEach((axis, index) => {
        delta = delta.map((value, component) => value + axis.storedAxis[component] * distances[index]);
      });
    } else if (drag.axis) {
      const distance = snapValue(axisDelta, event);
      delta = drag.storedAxis.map(value => value * distance);
    } else {
      const frame = sceneRenderer.getCameraFrame();
      const pointer = intersectRayPlane(
        sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
        drag.freeMovePlane.point,
        drag.freeMovePlane.normal
      );
      delta = pointer && drag.freeMoveStart
        ? pointer.map((value, axis) => value - drag.freeMoveStart[axis])
        : [0, 1, 2].map(axis => frame.right[axis] * dx * fallbackScale + frame.up[axis] * -dy * fallbackScale);
      drag.chain.forEach(group => { delta = inverseRotateVector(delta, group.rotation || [0, 0, 0]); });
    }
    const nextPivot = drag.axis || drag.kind === 'plane'
      ? drag.pivot.map((value, axis) => value + delta[axis])
      : drag.pivot.map((value, axis) => snapValue(value + delta[axis], event));
    setPivotPreservingGeometry(state.project, item, nextPivot);
    drag.tooltipText = `樞軸 ${nextPivot.map(formatNumber).join(' / ')}`;
  }
  if (drag.tool === 'move' && drag.targets.length > 1) {
    let distances = [];
    let commonWorldDelta;
    if (drag.kind === 'plane') {
      distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
      commonWorldDelta = [0, 0, 0];
      drag.planeAxes.forEach((axis, index) => {
        commonWorldDelta = commonWorldDelta.map((value, component) => value + axis.worldAxis[component] * distances[index]);
      });
      drag.tooltipText = `距離 ${drag.axisIndices.map(index => 'XYZ'[index]).join('')} ${distances.map(formatSigned).join(' / ')} px`;
    } else if (drag.axis) {
      distances = [snapValue(axisDelta, event)];
      const direction = drag.axis.vector.map(value => value * drag.sign);
      commonWorldDelta = direction.map(value => value * distances[0]);
      drag.tooltipText = `距離 ${formatSigned(distances[0])} px`;
    } else {
      const frame = sceneRenderer.getCameraFrame();
      const pointer = intersectRayPlane(
        sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
        drag.freeMovePlane.point,
        drag.freeMovePlane.normal
      );
      commonWorldDelta = pointer && drag.freeMoveStart
        ? pointer.map((value, axis) => value - drag.freeMoveStart[axis])
        : [0, 1, 2].map(axis => frame.right[axis] * dx * fallbackScale + frame.up[axis] * -dy * fallbackScale);
      commonWorldDelta = commonWorldDelta.map(value => snapValue(value, event));
      drag.tooltipText = `距離 ${formatSigned(Math.hypot(...commonWorldDelta))} px`;
    }
    for (const target of drag.targets) {
      let worldDelta = commonWorldDelta;
      if (drag.multiTransformMode === 'separate' && drag.axis) {
        const targetAxes = getTransformAxes(target.node);
        if (drag.kind === 'plane') {
          worldDelta = [0, 0, 0];
          drag.axisIndices.forEach((axisIndex, index) => {
            const signValue = drag.axisSigns[index] || 1;
            worldDelta = worldDelta.map((value, component) => value + targetAxes[axisIndex][component] * signValue * distances[index]);
          });
        } else {
          worldDelta = targetAxes[drag.axisIndex].map(value => value * drag.sign * distances[0]);
        }
      }
      translateCapturedTarget(target, localDeltaFromWorld(target, worldDelta));
    }
    return;
  }
  if (drag.tool === 'move') {
    let delta;
    if (drag.kind === 'plane') {
      const distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
      delta = [0, 0, 0];
      drag.planeAxes.forEach((axis, index) => {
        delta = delta.map((value, component) => value + axis.storedAxis[component] * distances[index]);
      });
      drag.tooltipText = `距離 ${drag.axisIndices.map(index => 'XYZ'[index]).join('')} ${distances.map(formatSigned).join(' / ')} px`;
    } else if (drag.axis) {
      const snappedDistance = snapValue(axisDelta, event);
      delta = drag.storedAxis.map(value => value * snappedDistance);
    }
    else {
      const frame = sceneRenderer.getCameraFrame();
      const pointer = intersectRayPlane(
        sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
        drag.freeMovePlane.point,
        drag.freeMovePlane.normal
      );
      const worldDelta = pointer && drag.freeMoveStart
        ? pointer.map((value, axis) => value - drag.freeMoveStart[axis])
        : [0, 1, 2].map(axis => frame.right[axis] * dx * fallbackScale + frame.up[axis] * -dy * fallbackScale);
      delta = [...worldDelta];
      drag.chain.forEach(group => { delta = inverseRotateVector(delta, group.rotation || [0, 0, 0]); });
    }
    const next = drag.axis || drag.kind === 'plane'
      ? drag.position.map((value, axis) => value + delta[axis])
      : drag.position.map((value, axis) => snapValue(value + delta[axis], event));
    if (drag.kind !== 'plane') drag.tooltipText = `距離 ${formatSigned(Math.hypot(...next.map((value, axis) => value - drag.position[axis])))} px`;
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
  if (drag.tool === 'resize' && drag.selectionContext.multiple) {
    const planeDistances = drag.kind === 'plane'
      ? getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event))
      : [];
    for (const target of drag.targets) {
      const targetItem = target.node;
      if (targetItem.type === 'cube') {
        const size = [...target.size];
        const position = [...target.position];
        if (drag.kind === 'plane-uniform') {
          const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
          for (const targetAxis of drag.axisIndices) {
            const proposed = target.size[targetAxis] + distance * 2;
            size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
            position[targetAxis] = target.position[targetAxis] - (size[targetAxis] - target.size[targetAxis]) / 2;
          }
        } else if (drag.kind === 'uniform') {
          const factor = 1 - dy * .01;
          for (let axis = 0; axis < 3; axis++) {
            const proposed = snapValue(target.size[axis] * factor, event);
            size[axis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
            position[axis] = target.position[axis] - (size[axis] - target.size[axis]) / 2;
          }
        } else if (drag.kind === 'plane') {
          drag.axisIndices.forEach((targetAxis, index) => {
            const proposed = target.size[targetAxis] + planeDistances[index];
            size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
            if ((drag.axisSigns[index] || 1) < 0) position[targetAxis] = target.position[targetAxis] + size[targetAxis] - target.size[targetAxis];
          });
        } else {
          const targetAxis = drag.axis ? drag.axisIndex : 0;
          const requestedChange = drag.axis ? snapValue(axisDelta, event) : snapValue(dx * fallbackScale, event);
          const proposed = target.size[targetAxis] + requestedChange;
          size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          if (drag.axis && drag.sign < 0) position[targetAxis] = target.position[targetAxis] + size[targetAxis] - target.size[targetAxis];
        }
        targetItem.position = position;
        targetItem.size = size;
      } else if (targetItem.type === 'shape') {
        if (drag.kind === 'plane-uniform') {
          const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
          if (drag.axisIndices.includes(1)) targetItem.parameters.height = Math.max(0, snapValue(target.height + distance * 2, event));
          if (drag.axisIndices.some(index => index !== 1)) targetItem.parameters.radius = Math.max(0, snapValue(target.radius + distance, event));
        } else if (drag.kind === 'uniform') {
          const factor = Math.max(0, 1 - dy * .01);
          targetItem.parameters.radius = Math.max(0, snapValue(target.radius * factor, event));
          targetItem.parameters.height = Math.max(0, snapValue(target.height * factor, event));
        } else if (drag.kind === 'plane') {
          const radialChanges = [];
          drag.axisIndices.forEach((targetAxis, index) => {
            if (targetAxis === 1) targetItem.parameters.height = Math.max(0, snapValue(target.height + planeDistances[index], event));
            else radialChanges.push(planeDistances[index]);
          });
          if (radialChanges.length) targetItem.parameters.radius = Math.max(0, snapValue(target.radius + radialChanges.reduce((sum, value) => sum + value, 0) / radialChanges.length, event));
        } else if (drag.axisIndex === 1) targetItem.parameters.height = Math.max(0, snapValue(target.height + axisDelta, event));
        else targetItem.parameters.radius = Math.max(0, snapValue(target.radius + (axisDelta ?? dx * fallbackScale), event));
      }
    }
    drag.tooltipText = drag.kind === 'uniform' ? `等比縮放 ${drag.targets.length} 項` : `縮放 ${drag.targets.length} 項`;
    return;
  }
  if (drag.tool === 'resize') {
    if (item.type === 'cube') {
      const size = [...drag.size];
      if (drag.kind === 'plane-uniform') {
        const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
        const position = [...drag.position];
        for (const targetAxis of drag.axisIndices) {
          const proposed = drag.size[targetAxis] + distance * 2;
          size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          const appliedChange = size[targetAxis] - drag.size[targetAxis];
          position[targetAxis] = drag.position[targetAxis] - appliedChange / 2;
        }
        item.position = position;
        drag.tooltipText = `平面等距 ${drag.axisIndices.map(index => `${'XYZ'[index]} ${formatNumber(size[index])}`).join(' / ')} px`;
      } else if (drag.kind === 'uniform') {
        const factor = 1 - dy * .01;
        const changes = [];
        for (let axis = 0; axis < 3; axis++) {
          const proposed = snapValue(drag.size[axis] * factor, event);
          size[axis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          changes[axis] = size[axis] - drag.size[axis];
        }
        item.position = drag.position.map((value, axis) => value - changes[axis] / 2);
        drag.tooltipText = `等比尺寸 ${size.map(formatNumber).join(' × ')} px`;
      } else if (drag.kind === 'plane') {
        const distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
        let position = [...drag.position];
        drag.planeAxes.forEach((planeAxis, index) => {
          const targetAxis = planeAxis.index;
          const proposed = drag.size[targetAxis] + distances[index];
          size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          const appliedChange = size[targetAxis] - drag.size[targetAxis];
          if (planeAxis.sign < 0) position = position.map((value, component) => value + planeAxis.storedAxis[component] * appliedChange);
        });
        item.position = position;
        drag.tooltipText = `尺寸 ${drag.axisIndices.map(index => `${'XYZ'[index]} ${formatNumber(size[index])}`).join(' / ')} px`;
      } else {
        const targetAxis = drag.axis ? drag.axisIndex : 0;
        const requestedChange = drag.axis ? snapValue(axisDelta, event) : snapValue(dx * fallbackScale, event);
        const proposedSize = drag.size[targetAxis] + requestedChange;
        size[targetAxis] = state.allowNegativeSize ? proposedSize : Math.max(0, proposedSize);
        const appliedChange = size[targetAxis] - drag.size[targetAxis];
        if (drag.axis && drag.sign < 0) item.position = drag.position.map((value, component) => value + drag.storedAxis[component] * appliedChange);
        drag.tooltipText = `尺寸 ${'XYZ'[targetAxis]} ${formatNumber(size[targetAxis])} px`;
      }
      item.size = size;
    }
    if (item.type === 'shape') {
      if (drag.kind === 'plane-uniform') {
        const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
        if (drag.axisIndices.includes(1)) item.parameters.height = Math.max(0, snapValue(drag.height + distance * 2, event));
        if (drag.axisIndices.some(index => index !== 1)) item.parameters.radius = Math.max(0, snapValue(drag.radius + distance, event));
        drag.tooltipText = `平面等距 半徑 ${formatNumber(item.parameters.radius)} / 高度 ${formatNumber(item.parameters.height)} px`;
      } else if (drag.kind === 'uniform') {
        const factor = Math.max(0, 1 - dy * .01);
        item.parameters.radius = Math.max(0, snapValue(drag.radius * factor, event));
        item.parameters.height = Math.max(0, snapValue(drag.height * factor, event));
        drag.tooltipText = `等比尺寸 半徑 ${formatNumber(item.parameters.radius)} / 高度 ${formatNumber(item.parameters.height)} px`;
      } else if (drag.kind === 'plane') {
        const distances = getPlaneDragDistances(drag, dx, dy).map(value => snapValue(value, event));
        const radialChanges = [];
        drag.planeAxes.forEach((planeAxis, index) => {
          if (planeAxis.index === 1) item.parameters.height = Math.max(0, snapValue(drag.height + distances[index], event));
          else radialChanges.push(distances[index]);
        });
        if (radialChanges.length) item.parameters.radius = Math.max(0, snapValue(drag.radius + radialChanges.reduce((sum, value) => sum + value, 0) / radialChanges.length, event));
        drag.tooltipText = `尺寸 半徑 ${formatNumber(item.parameters.radius)} / 高度 ${formatNumber(item.parameters.height)} px`;
      } else {
        if (drag.axisIndex === 1) item.parameters.height = Math.max(0, snapValue(drag.height + axisDelta, event));
        else item.parameters.radius = Math.max(0, snapValue(drag.radius + (axisDelta ?? dx * fallbackScale), event));
        drag.tooltipText = `${drag.axisIndex === 1 ? '高度' : '半徑'} ${formatNumber(drag.axisIndex === 1 ? item.parameters.height : item.parameters.radius)} px`;
      }
    }
  }
  if (drag.tool === 'rotate' && drag.targets.length > 1) {
    const angleStep = getAngleSnapStep(event);
    const angle = drag.axis ? axisDelta : (dx - dy) * .4;
    const snappedDelta = snapAngle(angle, angleStep);
    const commonAxis = drag.axis
      ? drag.axis.vector.map(value => value * drag.sign)
      : [0, 1, 0];
    const commonPivot = drag.selectionContext.pivot || drag.selectionContext.center || state.gizmoOrigin;
    for (const target of drag.targets) {
      const separate = drag.multiTransformMode === 'separate';
      const targetAxis = separate && drag.kind === 'rotate'
        ? getTransformAxes(target.node)[drag.axisIndex]
        : commonAxis;
      if (!separate) {
        const worldAnchor = applyGroupTransforms(target.anchor, target.chain);
        const nextWorldAnchor = rotatePointAroundAxis(worldAnchor, commonPivot, targetAxis, snappedDelta);
        const nextLocalAnchor = inverseApplyGroupTransforms(nextWorldAnchor, target.chain);
        translateCapturedTarget(target, nextLocalAnchor.map((value, axis) => value - target.anchor[axis]));
      }
      applyTargetRotation(target, targetAxis, snappedDelta, {
        separate,
        selfRelative: separate && drag.kind === 'rotate' && state.transformSpace === 'self',
        axisIndex: drag.axisIndex,
        euler: separate && drag.rotationMode === 'euler' && drag.kind === 'rotate'
      });
    }
    drag.tooltipText = `角度 ${formatSigned(snappedDelta)}°`;
    return;
  }
  if (drag.tool === 'rotate') {
    const angleStep = getAngleSnapStep(event);
    const angle = drag.axis ? axisDelta : (dx - dy) * .4;
    if (drag.axis) {
      const snappedDelta = snapAngle(angle, angleStep);
      if (drag.rotationMode === 'euler' && drag.kind === 'rotate') {
        item.rotation = [...drag.rotation];
        item.rotation[drag.axisIndex] = drag.rotation[drag.axisIndex] + snappedDelta;
      } else {
        const turn = quaternionFromAxisAngle(drag.rotationAxis, snappedDelta);
        const current = quaternionFromEuler(drag.rotation);
        item.rotation = eulerFromQuaternion(state.transformSpace === 'self' && drag.kind !== 'rotate-view'
          ? quaternionMultiply(current, turn)
          : quaternionMultiply(turn, current));
      }
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
function getAngleSnapStep(event = {}) {
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.shiftKey && ctrl) return .05;
  if (event.shiftKey) return .5;
  if (ctrl) return 15;
  return 2.5;
}
function snapAngle(value, step) { return Math.round(value / step) * step; }
function formatNumber(value) { return Number(value.toFixed(4)).toString(); }
function formatSigned(value) { const rounded = formatNumber(value); return value > 0 ? `+${rounded}` : rounded; }

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function escapeAttribute(value) { return escapeHtml(value).replaceAll('"', '&quot;'); }
function round(value) { return Math.round(value * 10000) / 10000; }
function hexToRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

initializeDockSystem();
initializeConfigRegistry();
loadTheme();
sceneRenderer.setSelectionOutline(getComputedStyle(document.documentElement).getPropertyValue('--selection-outline').trim());
renderTexture();
renderPalette();
bindEvents();
updateToolVisibility();
renderAll();
markDirty(false);
