import { Shape, addModifier, addOperator, bakeModifier, setPivotPreservingGeometry, setNodeName, setNodeUnnamed } from '../model.js';
import { formatRules, constrainNode } from '../common/core/format-constraints.js';
import { modifierRegistry } from '../common/config/modifiers.js';
import { operatorRegistry } from '../common/config/operators.js';
import { shapeRegistry } from '../shapes/builtins.js';
import { paintSymmetryRelationCache } from '../paint/symmetry-relations.js';

export function createInspectorController({
  state, $, $$, inspector, sceneRenderer, topLevelSelectedUids, selected, round,
  setTool, invalidateAllRenderGeometry, renderAll, updateToolVisibility, toast,
  openIconMarkup, escapeHtml, escapeAttribute, renderPaintColorPicker,
  polyhedronEdgeLength, formatNumber, freezeCubeUvs, openColorPickerPopup,
  snapshot, markDirty, invalidateSelectionRenderGeometry, renderScene,
  syncInspectorValues, translateModifierAnchors, setCurveHandle,
  bakeCurveNodeTangent, updateSelectionLabels, setMode, schedulePaintSymmetryBuild,
  deleteSelected, isUvCapable
}) {
let subdivisionSession = null;

function inspectorBatchNodes() {
  const nodes = topLevelSelectedUids().map(uidValue => state.project.getNode(uidValue)).filter(Boolean);
  return nodes.length ? nodes : [selected()].filter(Boolean);
}

function sharedVectorValues(nodes, field, fallback) {
  if (nodes.length <= 1) return [...fallback];
  return [0, 1, 2].map(axis => {
    const first = nodes[0]?.[field]?.[axis];
    if (!Number.isFinite(first) || !nodes.every(node => Number.isFinite(node?.[field]?.[axis]) && Math.abs(node[field][axis] - first) < 1e-9)) return null;
    return first;
  });
}

function sharedNumberValue(nodes, field, fallback) {
  if (nodes.length <= 1) return Number(fallback) || 0;
  const first = nodes[0]?.[field];
  if (!Number.isFinite(first) || !nodes.every(node => Number.isFinite(node?.[field]) && Math.abs(node[field] - first) < 1e-9)) return null;
  return first;
}

function numberInputAttributes(value) {
  return value === null
    ? 'value="" placeholder="-" data-mixed="true"'
    : `value="${round(value)}"`;
}

function isBezierElement(item) {
  return item?.type === 'bezier2d' || item?.type === 'bezier3d';
}

function isShapeElement(item) {
  return item instanceof Shape;
}

function isProceduralShape(item) {
  return Boolean(item && item.type !== 'cube' && typeof item.toCubes === 'function' && typeof item.toBaseCubes === 'function');
}

function subdivisionOwner(item) {
  return item?.subdivisionOwnerUid ? state.project.getNode(item.subdivisionOwnerUid) : null;
}

function subdivisionPatch(owner, cube, index) {
  const base = owner.toBaseCubes?.()[index];
  if (!base) return null;
  const patch = {};
  for (const field of ['position', 'size', 'pivot', 'rotation']) {
    const delta = cube[field].map((value, axis) => Number(value) - Number(base[field][axis]));
    if (delta.some(value => Math.abs(value) > 1e-8)) patch[`${field}Delta`] = delta;
  }
  const inflateDelta = Number(cube.inflate || 0) - Number(base.inflate || 0);
  if (Math.abs(inflateDelta) > 1e-8) patch.inflateDelta = inflateDelta;
  for (const field of ['name', 'unnamed', 'uvMode', 'uvNormalized', 'uv', 'mirrorUv', 'faces', 'autoUv', 'exported', 'locked', 'shade', 'visible', 'color']) {
    if (JSON.stringify(cube[field]) !== JSON.stringify(base[field])) patch[field] = structuredClone(cube[field]);
  }
  return Object.keys(patch).length ? patch : null;
}

function syncSubdivisionEdits() {
  if (!subdivisionSession) return;
  const owner = state.project.getNode(subdivisionSession.ownerUid);
  if (!owner?.toBaseCubes) return;
  const edits = {};
  subdivisionSession.cubes.forEach((cube, index) => {
    const patch = subdivisionPatch(owner, cube, index);
    if (patch) edits[index] = patch;
  });
  owner.subdivisionEdits = edits;
}

function enterSubdivisionEdit(owner) {
  if (!isProceduralShape(owner)) return;
  if (state.mode === 'paint') return toast('繪畫模式可直接在 Shape 上繪畫，不使用細分編輯');
  if (subdivisionSession?.ownerUid === owner.uid) return;
  if (subdivisionSession) exitSubdivisionEdit(false);
  const cubes = owner.toCubes().map((cube, index) => {
    cube.uid = `${owner.uid}::subdivision::${index}`;
    cube.subdivisionOwnerUid = owner.uid;
    cube.subdivisionIndex = index;
    return cube;
  });
  if (!cubes.length) return toast('這個 Shape 目前沒有可編輯的 Cube');
  subdivisionSession = { ownerUid: owner.uid, cubes };
  if (state.tool === 'knife') setTool('move');
  state.project.elements.push(...cubes);
  state.project.invalidateHierarchyIndex();
  sceneRenderer.invalidateLockState();
  state.selectedUid = cubes[0].uid;
  state.selectedUids = new Set([cubes[0].uid]);
  state.selectionAnchorUid = cubes[0].uid;
  state.selectedUvFaces = new Set();
  invalidateAllRenderGeometry();
  renderAll('all');
  updateToolVisibility();
  toast('已進入細分編輯；其他物件已虛化');
}

function exitSubdivisionEdit(render = true) {
  if (!subdivisionSession) return;
  syncSubdivisionEdits();
  const ownerUid = subdivisionSession.ownerUid;
  const transientUids = new Set(subdivisionSession.cubes.map(cube => cube.uid));
  state.project.elements = state.project.elements.filter(element => !transientUids.has(element.uid));
  state.project.invalidateHierarchyIndex();
  sceneRenderer.invalidateLockState();
  subdivisionSession = null;
  state.selectedUid = state.project.getNode(ownerUid) ? ownerUid : null;
  state.selectedUids = new Set(state.selectedUid ? [state.selectedUid] : []);
  state.selectionAnchorUid = state.selectedUid;
  state.selectedUvFaces = new Set();
  invalidateAllRenderGeometry();
  updateToolVisibility();
  if (render) renderAll('all');
}

function discardSubdivisionEdits(target) {
  if (!isProceduralShape(target) || target.preserveSubdivisionEdits) return;
  target.subdivisionEdits = {};
}

function curveNodeInspectorMarkup(item, index) {
  const node = item.nodes[index];
  if (!node) return '';
  const displayedRotation = node.autoTangent ? item.resolvedNodeState(index).rotation : node.rotation;
  return `<div class="field-section curve-node-card active" data-curve-node-card="${index}">
    <div class="field-title"><span>節點 ${index + 1}</span><span>${item.dimension === 2 ? '2D' : '3D'}</span></div>
    ${vectorField('位置', `curve-node:${index}:position`, node.position)}
    ${vectorField('旋轉', `curve-node:${index}:rotation`, displayedRotation)}
    <div class="option-row"><span>自動切線</span><label class="switch"><input type="checkbox" data-curve-node-auto="${index}" ${node.autoTangent ? 'checked' : ''}/><i></i></label></div>
    ${item.dimension === 3 ? `<div class="option-row"><span>滾動角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-curve-node-roll="${index}" value="${round(node.roll || 0)}" /></div></div>` : ''}
    <div class="option-row"><span>貝塞爾手柄</span><label class="switch"><input type="checkbox" data-curve-node-toggle="${index}" ${node.handlesEnabled ? 'checked' : ''}/><i></i></label></div>
    ${node.handlesEnabled ? `<div class="option-row"><span>對稱手柄</span><label class="switch"><input type="checkbox" data-curve-node-symmetric="${index}" ${node.symmetricHandles ? 'checked' : ''}/><i></i></label></div>` : ''}
    ${node.handlesEnabled ? `${vectorField('前手柄', `curve-node:${index}:handleIn`, node.handleIn)}${vectorField('後手柄', `curve-node:${index}:handleOut`, node.handleOut)}` : ''}
    <button type="button" class="curve-node-remove" data-remove-curve-node="${index}" ${item.nodes.length <= 2 ? 'disabled' : ''}>刪除節點</button>
  </div>`;
}

function modifierVectorField(label, modifier, property, values) {
  return `<div class="vector-field modifier-vector-field"><span>${label}</span><div class="axis-inputs">${['X', 'Y', 'Z'].map((axis, index) =>
    `<label><b>${axis}</b><input type="number" step="0.1" data-modifier-vector="${property}" data-modifier-uid="${modifier.uid}" data-axis="${index}" value="${round(values[index])}" /></label>`).join('')}</div></div>`;
}

function symmetryModifierMarkup(owner, modifier) {
  const radial = modifier.mode === 'radial' || modifier.mode === 'mandala';
  const editingAnchor = state.selectedModifierUid === modifier.uid;
  return `<div class="modifier-settings">
    <div class="option-row"><span>鏡像模式</span><select data-modifier-field="mode" data-modifier-uid="${modifier.uid}">
      <option value="axes" ${modifier.mode === 'axes' ? 'selected' : ''}>XYZ 鏡像</option>
      <option value="radial" ${modifier.mode === 'radial' ? 'selected' : ''}>徑向旋轉</option>
      <option value="mandala" ${modifier.mode === 'mandala' ? 'selected' : ''}>曼陀羅</option>
    </select></div>
    ${modifier.mode === 'axes' ? `<div class="option-row group-mirror-axes"><span>啟用軸</span>
      ${['x', 'y', 'z'].map(axis => `<label class="axis-${axis}"><input type="checkbox" data-modifier-axis="${axis}" data-modifier-uid="${modifier.uid}" ${modifier.axes[axis] ? 'checked' : ''}/><b>${axis.toUpperCase()}</b></label>`).join('')}
    </div>` : ''}
    ${radial ? `
      <div class="option-row"><span>${modifier.mode === 'mandala' ? '對稱軸數量' : '複製數量'}</span><div class="number-wrap" style="width:68px"><input type="number" min="1" max="256" step="1" data-modifier-field="copies" data-modifier-uid="${modifier.uid}" value="${modifier.copies}" /></div></div>
      <div class="option-row"><span>角度分布</span><select data-modifier-field="distribution" data-modifier-uid="${modifier.uid}"><option value="full" ${modifier.distribution === 'full' ? 'selected' : ''}>360° 均分</option><option value="range" ${modifier.distribution === 'range' ? 'selected' : ''}>限制範圍</option></select></div>
      ${modifier.distribution === 'range' ? `
        <div class="option-row"><span>起始角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-modifier-field="rangeStart" data-modifier-uid="${modifier.uid}" value="${round(modifier.rangeStart)}" /></div></div>
        <div class="option-row"><span>結束角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-modifier-field="rangeEnd" data-modifier-uid="${modifier.uid}" value="${round(modifier.rangeEnd)}" /></div></div>` : ''}` : ''}
    <div class="option-row"><span>導出時建立父組</span><label class="switch"><input type="checkbox" data-modifier-field="wrapParent" data-modifier-uid="${modifier.uid}" ${modifier.wrapParent ? 'checked' : ''}/><i></i></label></div>
    <div class="option-row"><span>忽視重複 Cube</span><label class="switch"><input type="checkbox" data-modifier-field="ignoreDuplicateCubes" data-modifier-uid="${modifier.uid}" ${modifier.ignoreDuplicateCubes ? 'checked' : ''}/><i></i></label></div>
    <div class="field-title"><span>內嵌軸點</span><button type="button" class="modifier-anchor-edit ${editingAnchor ? 'active' : ''}" data-edit-modifier-anchor="${modifier.uid}">${editingAnchor ? '結束軸點編輯' : '在主視圖編輯'}</button></div>
    <p class="modifier-anchor-note">不進入場景層級；可在主視圖點擊標記後移動或旋轉。</p>
    ${modifierVectorField('位置', modifier, 'anchor.position', modifier.anchor.position)}
    ${modifierVectorField('旋轉', modifier, 'anchor.rotation', modifier.anchor.rotation)}
  </div>`;
}

function modifierPanelMarkup(owner) {
  const modifiers = owner.modifiers || [];
  const available = modifierRegistry.listFor(owner.type).filter(definition =>
    definition.allowMultiple !== false || !modifiers.some(modifier => modifier.type === definition.id));
  const cards = modifiers.map((modifier, index) => {
    const definition = modifierRegistry.get(modifier.type);
    const collapsed = state.collapsedModifiers.has(modifier.uid);
    return `<section class="modifier-card ${modifier.enabled ? '' : 'disabled'}" data-modifier-card="${modifier.uid}">
      <div class="modifier-card-heading">
        <button type="button" class="modifier-collapse" data-modifier-collapse="${modifier.uid}" title="展開或折疊">${openIconMarkup(collapsed ? 'right' : 'down')}</button>
        <label class="switch" title="啟用修改器"><input type="checkbox" data-modifier-enabled="${modifier.uid}" ${modifier.enabled ? 'checked' : ''}/><i></i></label>
        <strong>${escapeHtml(definition?.label || modifier.type)}</strong>
        <button type="button" data-modifier-bake="${modifier.uid}" title="只烘焙這個修改器" ${modifier.enabled ? '' : 'disabled'}>烘焙</button>
        <button type="button" data-modifier-move="up" data-modifier-uid="${modifier.uid}" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-modifier-move="down" data-modifier-uid="${modifier.uid}" ${index === modifiers.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="danger" data-modifier-remove="${modifier.uid}">×</button>
      </div>
      ${collapsed ? '' : modifier.type === 'symmetry' ? symmetryModifierMarkup(owner, modifier) : ''}
    </section>`;
  }).join('');
  return `<div class="field-section modifier-page">
    <div class="modifier-add-row"><select data-modifier-add-type>${available.map(definition => `<option value="${definition.id}">${escapeHtml(definition.label)}</option>`).join('')}</select><button type="button" data-action="addModifier" ${available.length ? '' : 'disabled'}>＋ 新增修改器</button></div>
    ${cards || '<p class="modifier-empty">這個物件目前沒有修改器。</p>'}
  </div>`;
}

function operatorVectorField(label, operator, property, values) {
  return `<div class="vector-field modifier-vector-field"><span>${label}</span><div class="axis-inputs">${['X', 'Y', 'Z'].map((axis, index) =>
    `<label><b>${axis}</b><input type="number" step="0.1" data-operator-vector="${property}" data-operator-uid="${operator.uid}" data-axis="${index}" value="${round(values[index])}" /></label>`).join('')}</div></div>`;
}

function paintSymmetryOperatorMarkup(operator) {
  const radial = operator.mode === 'radial' || operator.mode === 'mandala';
  const cache = paintSymmetryRelationCache.get(operator.uid);
  const status = cache?.building ? '正在建立面關聯…' : cache ? `已建立 ${cache.relationCount || 0} 組關聯` : '等待首次繪製時建立';
  return `<div class="modifier-settings">
    <div class="option-row"><span>對稱模式</span><select data-operator-field="mode" data-operator-uid="${operator.uid}">
      <option value="axes" ${operator.mode === 'axes' ? 'selected' : ''}>XYZ 鏡像</option>
      <option value="radial" ${operator.mode === 'radial' ? 'selected' : ''}>徑向旋轉</option>
      <option value="mandala" ${operator.mode === 'mandala' ? 'selected' : ''}>曼陀羅</option>
    </select></div>
    ${operator.mode === 'axes' ? `<div class="option-row group-mirror-axes"><span>啟用軸</span>${['x', 'y', 'z'].map(axis => `<label class="axis-${axis}"><input type="checkbox" data-operator-axis="${axis}" data-operator-uid="${operator.uid}" ${operator.axes?.[axis] ? 'checked' : ''}/><b>${axis.toUpperCase()}</b></label>`).join('')}</div>` : ''}
    ${radial ? `<div class="option-row"><span>${operator.mode === 'mandala' ? '對稱軸數量' : '複製數量'}</span><div class="number-wrap" style="width:68px"><input type="number" min="1" max="256" step="1" data-operator-field="copies" data-operator-uid="${operator.uid}" value="${operator.copies}" /></div></div>
      <div class="option-row"><span>角度分布</span><select data-operator-field="distribution" data-operator-uid="${operator.uid}"><option value="full" ${operator.distribution === 'full' ? 'selected' : ''}>360° 均分</option><option value="range" ${operator.distribution === 'range' ? 'selected' : ''}>限制範圍</option></select></div>
      ${operator.distribution === 'range' ? `<div class="option-row"><span>起始角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-operator-field="rangeStart" data-operator-uid="${operator.uid}" value="${round(operator.rangeStart)}" /></div></div><div class="option-row"><span>結束角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-operator-field="rangeEnd" data-operator-uid="${operator.uid}" value="${round(operator.rangeEnd)}" /></div></div>` : ''}` : ''}
    <div class="field-title"><span>作用軸點</span><button type="button" class="modifier-anchor-edit ${state.selectedModifierUid === operator.uid ? 'active' : ''}" data-edit-operator-anchor="${operator.uid}">${state.selectedModifierUid === operator.uid ? '結束軸點編輯' : '在主視圖編輯'}</button></div>
    <p class="modifier-anchor-note">${status}</p>
    ${operatorVectorField('位置', operator, 'anchor.position', operator.anchor.position)}
    ${operatorVectorField('旋轉', operator, 'anchor.rotation', operator.anchor.rotation)}
    <p class="modifier-anchor-note">操作器只處理即時繪畫輸入，不生成物件，也沒有烘焙。</p>
  </div>`;
}

function operatorPanelMarkup(owner) {
  const operators = owner.operators || [];
  const available = operatorRegistry.listFor(owner.type).filter(definition =>
    definition.allowMultiple !== false || !operators.some(operator => operator.type === definition.id));
  const cards = operators.map((operator, index) => {
    if (operator.enabled && operator.type === 'paint_symmetry' && !paintSymmetryRelationCache.has(operator.uid)) {
      schedulePaintSymmetryBuild(owner, operator);
    }
    const definition = operatorRegistry.get(operator.type);
    const collapsed = state.collapsedOperators.has(operator.uid);
    return `<section class="modifier-card ${operator.enabled ? '' : 'disabled'}" data-operator-card="${operator.uid}">
      <div class="modifier-card-heading">
        <button type="button" class="modifier-collapse" data-operator-collapse="${operator.uid}" title="展開或折疊">${openIconMarkup(collapsed ? 'right' : 'down')}</button>
        <label class="switch" title="啟用操作器"><input type="checkbox" data-operator-enabled="${operator.uid}" ${operator.enabled ? 'checked' : ''}/><i></i></label>
        <strong>${escapeHtml(definition?.label || operator.type)}</strong>
        <button type="button" data-operator-move="up" data-operator-uid="${operator.uid}" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-operator-move="down" data-operator-uid="${operator.uid}" ${index === operators.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="danger" data-operator-remove="${operator.uid}">×</button>
      </div>
      ${collapsed ? '' : operator.type === 'paint_symmetry' ? paintSymmetryOperatorMarkup(operator) : ''}
    </section>`;
  }).join('');
  return `<div class="field-section modifier-page">
    <div class="modifier-add-row"><select data-operator-add-type>${available.map(definition => `<option value="${definition.id}">${escapeHtml(definition.label)}</option>`).join('')}</select><button type="button" data-action="addOperator" ${available.length ? '' : 'disabled'}>＋ 新增操作器</button></div>
    ${cards || '<p class="modifier-empty">這個物件目前沒有操作器。</p>'}
  </div>`;
}



function renderInspector() {
  if (state.mode === 'paint') {
    renderPaintColorPicker();
    return;
  }
  $('#inspectorHeading').textContent = '物件屬性';
  $('#inspectorMetaStrip').hidden = false;
  const item = selected();
  if (!item) {
    inspector.innerHTML = state.selectedGenerated
      ? '<div class="field-section"><p style="color:var(--muted);font-size:.7rem">已選中修改器生成結果；可作頂點捕捉參考，但不能直接編輯。請選擇來源物件或烘焙修改器。</p></div>'
      : '<div class="field-section"><p style="color:var(--muted);font-size:.7rem">選擇一個 Cube、Shape、節點、貝塞爾、Locator 或組來編輯。</p></div>';
    return;
  }
  if (isBezierElement(item) && Number.isInteger(state.selectedCurveNodeIndex) && item.nodes[state.selectedCurveNodeIndex]) {
    inspector.innerHTML = `<nav class="inspector-tabs"><button type="button" class="active">節點</button></nav>${curveNodeInspectorMarkup(item, state.selectedCurveNodeIndex)}`;
    bindInspector();
    return;
  }
  const items = inspectorBatchNodes();
  const rotation = item.rotation || [0, 0, 0];
  const editOwner = subdivisionOwner(item);
  const typeLabel = editOwner ? 'Shape 細分 Cube' : isShapeElement(item)
    ? shapeRegistry.get(item.shapeType)?.label || `未安裝的 Shape：${item.shapeType}`
    : item.type === 'locator' ? 'Locator'
    : item.type === 'node' ? '節點' : item.type === 'bezier2d' ? '二維貝塞爾'
      : item.type === 'bezier3d' ? '三維貝塞爾' : item.type === 'group' ? '組' : '立方體';
  const details = item.type === 'cube' ? `
      <div class="field-title"><span>幾何</span><button data-action="resetTransform">重置</button></div>
      ${vectorField('位置', 'position', item.position, items)}
      ${vectorField('尺寸', 'size', item.size, items)}
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${scalarField('膨脹', 'inflate', item.inflate, items)}`
    : isShapeElement(item) && !shapeRegistry.get(item.shapeType) ? `
      <div class="field-title"><span>${escapeHtml(typeLabel)}</span></div>
      <p class="shape-pack-missing">這個 Shape 所屬的外部包未載入；參數與細分資料仍會保留，安裝對應包後可恢復顯示。</p>`
    : isShapeElement(item) && shapeRegistry.get(item.shapeType)?.external ? `
      <div class="field-title"><span>${escapeHtml(typeLabel)}</span><span>${escapeHtml(shapeRegistry.get(item.shapeType).pack || '')}</span></div>
      ${vectorField('位置', 'origin', item.origin, items)}
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${(shapeRegistry.get(item.shapeType).fields || []).map(field => `<div class="option-row"><span>${escapeHtml(field.label || field.key)}</span><div class="number-wrap" style="width:68px"><input type="number" data-parameter="${escapeAttribute(field.key)}" data-operation-id="shape.${escapeAttribute(item.shapeType)}.parameter.${escapeAttribute(field.key.toLowerCase())}" data-min="${Number.isFinite(field.min) ? field.min : -1000000}" step="${Number(field.step) || .1}" value="${Number(item.parameters[field.key]) || 0}" /></div></div>`).join('')}
      <div class="option-row"><span>生成 Cube</span><strong style="color:var(--accent)">${item.toCubes().length} 個</strong></div>`
    : isShapeElement(item) ? item.shapeType !== 'polygon_prism' ? `
      <div class="field-title"><span>${item.shapeType === 'truncated_icosahedron' ? '足球（截角二十面體）' : '正十二面體'}</span><span>${item.shapeType === 'truncated_icosahedron' ? 'TRUNCATED ICOSAHEDRON' : 'REGULAR DODECAHEDRON'}</span></div>
      ${vectorField('位置', 'origin', item.origin, items)}
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${parameterField('半徑', 'radius', item.parameters.radius, .1, items)}
      <div class="option-row"><span>單邊邊長</span><strong style="color:var(--accent)">${formatNumber(polyhedronEdgeLength(item, item.parameters.radius))} px</strong></div>
      <div class="option-row"><span>尺寸擬合</span><select data-shape-snap-mode><option value="edge" ${item.parameters.snapMode !== 'radius' ? 'selected' : ''}>擬合單邊邊長</option><option value="radius" ${item.parameters.snapMode === 'radius' ? 'selected' : ''}>擬合整體半徑</option></select></div>
      <div class="option-row"><span>生成 Cube</span><strong style="color:var(--accent)">${item.toCubes().length} 個</strong></div>` : `
      <div class="field-title"><span>多邊形柱體</span><span>POLYGON PRISM</span></div>
      ${vectorField('位置', 'origin', item.origin, items)}
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${parameterField('半徑', 'radius', item.parameters.radius, .1, items)}
      ${parameterField('高度', 'height', item.parameters.height, .1, items)}
      ${parameterField('邊數', 'sides', item.parameters.sides, 1, items)}
      <div class="option-row"><span>啟用內半徑</span><label class="switch"><input type="checkbox" data-shape-inner-radius ${item.parameters.innerRadiusEnabled ? 'checked' : ''}/><i></i></label></div>
      ${item.parameters.innerRadiusEnabled ? `
        <div class="option-row"><span>內半徑模式</span><select data-shape-inner-radius-mode><option value="radius" ${item.parameters.innerRadiusMode !== 'depth' ? 'selected' : ''}>實際內半徑</option><option value="depth" ${item.parameters.innerRadiusMode === 'depth' ? 'selected' : ''}>Cube 向內延伸</option></select></div>
        ${parameterField(item.parameters.innerRadiusMode === 'depth' ? '向內延伸距離' : '實際內半徑', 'innerRadius', item.parameters.innerRadius, .1, items)}` : ''}
      <div class="option-row"><span>尺寸擬合</span><select data-shape-snap-mode><option value="edge" ${item.parameters.snapMode !== 'radius' ? 'selected' : ''}>擬合多邊形邊長</option><option value="radius" ${item.parameters.snapMode === 'radius' ? 'selected' : ''}>擬合整體半徑</option></select></div>
      <div class="option-row"><span>生成 Cube</span><strong style="color:var(--accent)">${item.toCubes().length} 個</strong></div>`
    : item.type === 'locator' ? `
      <div class="field-title"><span>Locator 變換</span><button data-action="resetTransform">重置</button></div>
      ${vectorField('位置', 'position', item.position, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}`
    : item.type === 'node' ? `
      <div class="field-title"><span>節點</span><span>只可移動／旋轉</span></div>
      ${vectorField('位置', 'position', item.position, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      <div class="option-row"><span>貝塞爾手柄</span><label class="switch"><input type="checkbox" data-field="handlesEnabled" ${item.handlesEnabled ? 'checked' : ''}/><i></i></label></div>
      ${item.handlesEnabled ? `<div class="option-row"><span>對稱手柄</span><label class="switch"><input type="checkbox" data-field="symmetricHandles" ${item.symmetricHandles ? 'checked' : ''}/><i></i></label></div>` : ''}
      ${item.handlesEnabled ? `${vectorField('前手柄', 'handleIn', item.handleIn, items)}${vectorField('後手柄', 'handleOut', item.handleOut, items)}` : ''}`
    : isBezierElement(item) ? `
      <div class="field-title"><span>${item.dimension === 2 ? '二維' : '三維'}貝塞爾</span><span>${item.nodes.length} 節點</span></div>
      ${vectorField('位置', 'origin', item.origin, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${parameterField('Cube 柱粗細', 'thickness', item.parameters.thickness, .1, items)}
      <div class="option-row"><span>分段方式</span><select data-curve-segmentation><option value="distance" ${item.parameters.segmentationMode === 'distance' ? 'selected' : ''}>按距離</option><option value="angle" ${item.parameters.segmentationMode === 'angle' ? 'selected' : ''}>按角度</option></select></div>
      ${item.parameters.segmentationMode === 'angle'
        ? parameterField('角度步長', 'angleStep', item.parameters.angleStep, .1, items)
        : parameterField('距離步長', 'segmentLength', item.parameters.segmentLength, .1, items)}
      <div class="option-row"><span>生成 Cube</span><strong style="color:var(--accent)">${item.toCubes().length} 個</strong></div>`
    : `
      <div class="field-title"><span>組屬性</span></div>
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${scalarField('膨脹', 'inflate', item.inflate, items)}
      <div class="option-row"><span>直接子項</span><strong style="color:var(--accent)">${item.children.length}</strong></div>`;
  const appearanceCapable = item.type === 'cube' || isShapeElement(item) || isBezierElement(item) || item.type === 'group';
  const pages = [
    { id: 'basic', label: '基礎' },
    ...(appearanceCapable ? [{ id: 'appearance', label: '外觀' }] : []),
    ...(isUvCapable(item) ? [{ id: 'uv', label: 'UV' }] : []),
    ...(modifierRegistry.listFor(item.type).length || item.modifiers?.length ? [{ id: 'modifiers', label: '修改器' }] : []),
    ...(operatorRegistry.listFor(item.type).length || item.operators?.length ? [{ id: 'operators', label: '操作器' }] : [])
  ];
  if (!pages.some(page => page.id === state.inspectorPage)) state.inspectorPage = 'basic';
  const tabs = `<nav class="inspector-tabs" aria-label="物件屬性分類">${pages.map(page => `<button type="button" data-inspector-page="${page.id}" class="${state.inspectorPage === page.id ? 'active' : ''}">${page.label}</button>`).join('')}</nav>`;
  const basicPage = `<div class="field-section">
      <div class="field-title"><span>基本</span><span>${items.length > 1 ? `多選 ${items.length}` : typeLabel}</span></div>
      <input class="name-field" data-field="name" value="${escapeAttribute(item.name)}" aria-label="名稱" />
      <div class="option-row"><span>系統命名</span><label class="switch"><input type="checkbox" data-field="unnamed" ${item.unnamed ? 'checked' : ''}/><i></i></label></div>
      <div class="option-row"><span>可見</span><label class="switch"><input type="checkbox" data-field="visible" ${item.visible ? 'checked' : ''}/><i></i></label></div>
    </div>
    <div class="field-section">
      ${details}
    </div>
    ${isProceduralShape(item) ? `<div class="field-section subdivision-controls">
      <div class="field-title"><span>細分編輯</span><span>${Object.keys(item.subdivisionEdits || {}).length} 個覆寫</span></div>
      <div class="option-row"><span>操作時保留已有細分編輯</span><label class="switch"><input type="checkbox" data-field="preserveSubdivisionEdits" ${item.preserveSubdivisionEdits ? 'checked' : ''}/><i></i></label></div>
      <button type="button" data-action="enterSubdivisionEdit">進入細分編輯</button>
    </div>` : ''}
    ${editOwner ? `<div class="field-section subdivision-controls active">
      <div class="field-title"><span>${escapeHtml(editOwner.name)}</span><span>細分 ${item.subdivisionIndex + 1}</span></div>
      <p>正在非破壞地編輯 Shape 生成的 Cube。</p>
      <button type="button" data-action="exitSubdivisionEdit">完成細分編輯</button>
    </div>` : ''}
    ${editOwner ? '' : `<div class="field-section"><button class="danger-button" data-action="deleteSelected">${items.length > 1 ? '刪除選中項' : `刪除${item.type === 'group' ? '組及其內容' : '物件'}`}</button></div>`}`;
  const appearancePage = `<div class="field-section">
      <div class="field-title"><span>外觀</span><span>預覽色</span></div>
      ${item.color ? `<div class="option-row"><span>顯示色</span><button type="button" data-element-color-popup class="element-color-chip" style="background:${escapeAttribute(item.color)}" title="選擇顏色"></button></div>` : ''}
      <div class="option-row"><span>面陰影</span><label class="switch"><input type="checkbox" data-field="shade" ${item.shade !== false ? 'checked' : ''}/><i></i></label></div>
    </div>`;
  const rules = formatRules(state.project);
  const uvPage = `<div class="field-section">
      <div class="field-title"><span>UV</span><span>${item.uvMode === 'face' ? 'PER FACE' : 'BOX'}</span></div>
      <div class="option-row"><span>UV 模式</span><select data-field="uvMode" ${!rules.allowBoxUv || !rules.allowFaceUv ? 'disabled' : ''}><option value="box" ${item.uvMode !== 'face' ? 'selected' : ''} ${!rules.allowBoxUv ? 'disabled' : ''}>箱型 UV</option><option value="face" ${item.uvMode === 'face' ? 'selected' : ''} ${!rules.allowFaceUv ? 'disabled' : ''}>逐面 UV</option></select></div>
      <div class="option-row"><span>UV 歸一化</span><label class="switch"><input type="checkbox" data-field="uvNormalized" ${item.uvNormalized !== false ? 'checked' : ''}/><i></i></label></div>
    </div>`;
  const content = state.inspectorPage === 'appearance' ? appearancePage
    : state.inspectorPage === 'uv' ? uvPage
      : state.inspectorPage === 'modifiers' ? modifierPanelMarkup(item)
        : state.inspectorPage === 'operators' ? operatorPanelMarkup(item)
        : basicPage;
  inspector.innerHTML = `${tabs}${content}`;
  bindInspector();
}

function vectorField(label, field, values, nodes = [selected()]) {
  const displayed = sharedVectorValues(nodes, field, values);
  const rules = formatRules(state.project);
  const step = field === 'size' && rules.integerCubeSize ? '1' : field === 'rotation' && rules.rotationStep ? String(rules.rotationStep) : '0.0001';
  const disabled = field === 'rotation' && rules.moddedEntity && nodes[0]?.type === 'cube' ? 'disabled title="Cube 不能旋轉；請旋轉其所屬的組"' : '';
  return `<div class="vector-field"><span>${label}</span>${displayed.map((value, index) => `<label class="number-wrap"><b>${'XYZ'[index]}</b><input type="number" step="${step}" data-vector="${field}" data-axis="${index}" ${numberInputAttributes(value)} ${disabled} /></label>`).join('')}</div>`;
}

function scalarField(label, field, value, nodes = [selected()]) {
  const displayed = sharedNumberValue(nodes, field, value);
  return `<div class="vector-field scalar-field"><span>${label}</span><label class="number-wrap"><input type="number" step="0.1" data-field="${field}" ${numberInputAttributes(displayed)} /></label></div>`;
}

function parameterField(label, key, value, step, nodes = [selected()]) {
  const displayed = nodes.length <= 1 ? value : (() => {
    const first = nodes[0]?.parameters?.[key];
    return Number.isFinite(first) && nodes.every(node => Number.isFinite(node?.parameters?.[key]) && Math.abs(node.parameters[key] - first) < 1e-9) ? first : null;
  })();
  const minimum = key === 'sides' ? 3 : key === 'innerRadius' ? 0 : key === 'cubeSize' || key === 'segmentLength' ? .0625 : .1;
  return `<div class="option-row"><span>${label}</span><div class="number-wrap" style="width:68px"><input type="number" min="${minimum}" step="${step}" data-parameter="${key}" ${numberInputAttributes(displayed)} /></div></div>`;
}

function setNodeVisibility(node, visible, cascadeGroup = true) {
  if (!node) return;
  node.visible = visible;
  if (node.type !== 'group' || !cascadeGroup) return;
  for (const childUid of node.children) setNodeVisibility(state.project.getNode(childUid), visible, true);
}

function setNodeAutoUv(node, enabled) {
  if (!node) return;
  if (node.uvMode === 'box') enabled = true;
  node.autoUv = enabled;
  if (node.type === 'cube') {
    if (enabled) {
      for (const face of Object.values(node.faces || {})) delete face.uv;
    } else freezeCubeUvs(node);
    return;
  }
  if (node.type === 'group') {
    for (const uidValue of state.project.getDescendantElementUids(node.uid)) {
      const child = state.project.getNode(uidValue);
      if (child?.type === 'cube') setNodeAutoUv(child, enabled);
      else if (isShapeElement(child) || isBezierElement(child)) child.autoUv = enabled;
    }
  }
}

function setNodeFlag(node, key, value) {
  if (!node) return;
  if ((key === 'uvMode' || key === 'uvNormalized') && !isUvCapable(node)) return;
  const rules = formatRules(state.project);
  if (key === 'uvMode') {
    if (value === 'box' && !rules.allowBoxUv || value === 'face' && !rules.allowFaceUv) return;
    if (value === 'box') node.autoUv = true;
  }
  if (key === 'visible') return setNodeVisibility(node, value);
  if (key === 'autoUv') return setNodeAutoUv(node, value);
  if (key === 'shade' && node.type === 'locator') return;
  node[key] = value;
  if (key === 'uvMode' && node.type === 'cube') constrainNode(node, rules);
  if (node.type === 'group') {
    for (const childUid of node.children) setNodeFlag(state.project.getNode(childUid), key, value);
  }
}

function bindInspector() {
  const item = selected();
  if (!item) return;
  const items = inspectorBatchNodes();
  $('[data-element-color-popup]', inspector)?.addEventListener('click', () => openColorPickerPopup(item.color, color => {
    snapshot('core.element.color'); items.filter(node => typeof node.color === 'string').forEach(node => { node.color = color; });
    markDirty(); renderAll('selection');
  }));
  $$('[data-field]', inspector).forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.field;
      if (input.type === 'number' && input.value === '') return;
      snapshot(`core.element.field.${key.toLowerCase()}`);
      const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
      const targets = key === 'name' ? [item]
        : key === 'shade' ? items.filter(node => node.type === 'cube' || isShapeElement(node) || isBezierElement(node) || node.type === 'group')
        : key === 'inflate' ? items.filter(node => ['cube', 'group'].includes(node.type))
        : key === 'uvMode' || key === 'uvNormalized' ? items.filter(isUvCapable)
        : key === 'color' ? items.filter(node => typeof node.color === 'string')
        : items.filter(node => key in node);
      for (const target of targets) {
        if (key === 'name') setNodeName(state.project, target, value);
        else if (key === 'unnamed') setNodeUnnamed(state.project, target, value);
        else if (['visible', 'shade', 'autoUv', 'uvMode', 'uvNormalized', 'exported', 'locked'].includes(key)) setNodeFlag(target, key, value);
        else {
          target[key] = value;
          if (key === 'symmetricHandles' && value && target.type === 'node') {
            setCurveHandle(target, 'handleOut', target.handleOut, false);
          }
        }
      }
      if (key === 'locked') sceneRenderer.invalidateLockState();
      markDirty();
      renderAll('selection');
    });
  });
  $$('[data-vector]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      if (!snapshotTaken) {
        const vectorName = input.dataset.vector.startsWith('curve-node:')
          ? input.dataset.vector.split(':')[2] : input.dataset.vector;
        snapshot(`core.element.vector.${vectorName.toLowerCase()}`);
        snapshotTaken = true;
      }
      delete input.dataset.mixed;
      const field = input.dataset.vector;
      const axis = Number(input.dataset.axis);
      if (field.startsWith('curve-node:') && isBezierElement(item)) {
        const [, indexText, property] = field.split(':');
        const node = item.nodes[Number(indexText)];
        if (!node || !Array.isArray(node[property])) return;
        discardSubdivisionEdits(item);
        if (property === 'rotation' && node.autoTangent) bakeCurveNodeTangent(item, Number(indexText));
        const planarVector = property === 'position' || property === 'handleIn' || property === 'handleOut';
        const lockedPlanarAxis = item.dimension === 2
          && ((planarVector && axis === 1) || (property === 'rotation' && axis !== 1));
        const nextVector = [...node[property]];
        nextVector[axis] = lockedPlanarAxis ? 0 : value;
        if (property === 'handleIn' || property === 'handleOut') setCurveHandle(node, property, nextVector, item.dimension === 2);
        else node[property] = nextVector;
        if (item.dimension === 2 && planarVector) node[property][1] = 0;
        if (item.dimension === 2 && property === 'rotation') {
          node.rotation[0] = 0;
          node.rotation[2] = 0;
        }
        if (property === 'rotation') node.autoTangent = false;
        if (lockedPlanarAxis) input.value = '0';
        markDirty(); invalidateSelectionRenderGeometry(); renderScene();
        return;
      }
      for (const target of items.filter(node => Array.isArray(node[field]))) {
        const rules = formatRules(state.project);
        const requested = target.type === 'cube' && field === 'size' && rules.integerCubeSize ? Math.round(value) : value;
        const nextValue = target.type === 'cube' && field === 'size' && !state.allowNegativeSize
          ? Math.max(0, requested)
          : requested;
        if (target.type === 'cube' && field === 'position') {
          const delta = nextValue - target.position[axis];
          target.position[axis] = nextValue;
          target.pivot[axis] += delta;
          translateModifierAnchors(target, [0, 1, 2].map(index => index === axis ? delta : 0));
        } else if (field === 'pivot' && (['cube', 'group'].includes(target.type) || isShapeElement(target))) {
          const nextPivot = [...target.pivot];
          nextPivot[axis] = nextValue;
          setPivotPreservingGeometry(state.project, target, nextPivot);
        } else if ((field === 'handleIn' || field === 'handleOut') && target.type === 'node') {
          const nextHandle = [...target[field]];
          nextHandle[axis] = nextValue;
          setCurveHandle(target, field, nextHandle, false);
        } else {
          const delta = nextValue - target[field][axis];
          target[field][axis] = nextValue;
          if (field === 'origin' && isShapeElement(target)) target.pivot[axis] += delta;
          if (field === 'position' || field === 'origin') {
            translateModifierAnchors(target, [0, 1, 2].map(index => index === axis ? delta : 0));
          }
        }
        if (field === 'rotation' || field === 'size') constrainNode(target, rules);
      }
      const displayedValue = item.type === 'cube' && field === 'size' && !state.allowNegativeSize ? Math.max(0, value) : value;
      if (displayedValue !== value) input.value = String(displayedValue);
      markDirty(); invalidateSelectionRenderGeometry(); syncInspectorValues(); renderScene();
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
      if (!snapshotTaken) { snapshot(input.dataset.operationId || `core.shape.parameter.${input.dataset.parameter.toLowerCase()}`); snapshotTaken = true; }
      delete input.dataset.mixed;
      const key = input.dataset.parameter;
      const nextValue = input.dataset.min !== undefined ? Math.max(Number(input.dataset.min), value)
        : key === 'sides' ? Math.max(3, Math.round(value))
          : Math.max(key === 'innerRadius' ? 0 : key === 'cubeSize' || key === 'segmentLength' ? .0625 : .1, value);
      for (const target of items.filter(node => node.parameters && key in node.parameters)) {
        discardSubdivisionEdits(target);
        target.parameters[key] = nextValue;
      }
      markDirty(); invalidateSelectionRenderGeometry(); syncInspectorValues(); renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  $$('[data-inspector-page]', inspector).forEach(button => button.addEventListener('click', () => {
    state.inspectorPage = button.dataset.inspectorPage;
    renderInspector();
    renderScene();
  }));
  const modifierByUid = uidValue => item.modifiers?.find(modifier => modifier.uid === uidValue);
  $('[data-action="addModifier"]', inspector)?.addEventListener('click', () => {
    const type = $('[data-modifier-add-type]', inspector)?.value;
    if (!type) return;
    snapshot(`modifier.${type}.add`);
    const modifier = addModifier(item, type);
    if (!modifier) return;
    state.selectedModifierUid = modifier.uid;
    state.selectedCurveNodeIndex = null;
    sceneRenderer.invalidateMirrorGeometry();
    markDirty(); renderInspector(); renderScene(); updateSelectionLabels();
  });
  $$('[data-modifier-collapse]', inspector).forEach(button => button.addEventListener('click', () => {
    const uidValue = button.dataset.modifierCollapse;
    state.collapsedModifiers.has(uidValue) ? state.collapsedModifiers.delete(uidValue) : state.collapsedModifiers.add(uidValue);
    renderInspector();
  }));
  $$('[data-modifier-enabled]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const modifier = modifierByUid(toggle.dataset.modifierEnabled);
    if (!modifier) return;
    snapshot(`modifier.${modifier.type}.toggle`); modifier.enabled = toggle.checked;
    if (!modifier.enabled && state.selectedModifierUid === modifier.uid) state.selectedModifierUid = null;
    sceneRenderer.invalidateMirrorGeometry(); markDirty(); renderInspector(); renderScene(); updateSelectionLabels();
  }));
  $$('[data-modifier-remove]', inspector).forEach(button => button.addEventListener('click', () => {
    snapshot(`modifier.${item.modifiers?.find(modifier => modifier.uid === button.dataset.modifierRemove)?.type || 'symmetry'}.remove`);
    item.modifiers = (item.modifiers || []).filter(modifier => modifier.uid !== button.dataset.modifierRemove);
    if (state.selectedModifierUid === button.dataset.modifierRemove) state.selectedModifierUid = null;
    state.collapsedModifiers.delete(button.dataset.modifierRemove);
    sceneRenderer.invalidateMirrorGeometry(); markDirty(); renderInspector(); renderScene(); updateSelectionLabels();
  }));
  $$('[data-modifier-bake]', inspector).forEach(button => button.addEventListener('click', () => {
    const modifierUid = button.dataset.modifierBake;
    snapshot(`modifier.${item.modifiers?.find(modifier => modifier.uid === modifierUid)?.type || 'symmetry'}.bake`);
    const result = bakeModifier(state.project, item, modifierUid);
    if (!result) return toast('這個修改器目前無法烘焙');
    state.selectedModifierUid = null;
    state.collapsedModifiers.delete(modifierUid);
    state.selectedUid = result.rootUid;
    state.selectedUids = new Set([result.rootUid]);
    state.selectionAnchorUid = result.rootUid;
    sceneRenderer.invalidateMirrorGeometry();
    invalidateAllRenderGeometry();
    markDirty(); renderAll(); toast('已烘焙選中的修改器');
  }));
  $$('[data-edit-modifier-anchor]', inspector).forEach(button => button.addEventListener('click', () => {
    const modifier = modifierByUid(button.dataset.editModifierAnchor);
    if (!modifier?.enabled) return;
    state.selectedModifierUid = state.selectedModifierUid === modifier.uid ? null : modifier.uid;
    state.selectedCurveNodeIndex = null;
    if (state.selectedModifierUid && !['move', 'rotate', 'pivot'].includes(state.tool)) {
      setTool('move');
      return;
    }
    renderInspector(); renderScene(); updateSelectionLabels();
  }));
  $$('[data-modifier-move]', inspector).forEach(button => button.addEventListener('click', () => {
    const index = item.modifiers?.findIndex(modifier => modifier.uid === button.dataset.modifierUid) ?? -1;
    const target = index + (button.dataset.modifierMove === 'up' ? -1 : 1);
    if (index < 0 || target < 0 || target >= item.modifiers.length) return;
    snapshot(`modifier.${item.modifiers[index].type}.move`); [item.modifiers[index], item.modifiers[target]] = [item.modifiers[target], item.modifiers[index]];
    sceneRenderer.invalidateMirrorGeometry(); markDirty(); renderInspector(); renderScene();
  }));
  $$('[data-modifier-axis]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const modifier = modifierByUid(toggle.dataset.modifierUid);
    if (!modifier) return;
    snapshot(`modifier.${modifier.type}.change`); modifier.axes[toggle.dataset.modifierAxis] = toggle.checked;
    sceneRenderer.invalidateMirrorGeometry(); markDirty(); renderScene();
  }));
  $$('[data-modifier-field]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const modifier = modifierByUid(input.dataset.modifierUid);
      if (!modifier || (input.type === 'number' && !input.value.trim())) return;
      const key = input.dataset.modifierField;
      let value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
      if (key === 'copies') value = Math.max(1, Math.min(256, Math.round(value) || 1));
      if ((input.type === 'number' && !Number.isFinite(value)) || modifier[key] === value) return;
      if (!snapshotTaken) { snapshot(`modifier.${modifier.type}.change`); snapshotTaken = true; }
      modifier[key] = value;
      sceneRenderer.invalidateMirrorGeometry(); markDirty();
      if (key === 'mode' || key === 'distribution') renderInspector();
      renderScene();
    };
    input.addEventListener(input.type === 'number' ? 'input' : 'change', apply);
    if (input.type === 'number') {
      input.addEventListener('change', apply);
      input.addEventListener('blur', () => { snapshotTaken = false; });
    }
  });
  $$('[data-modifier-vector]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const modifier = modifierByUid(input.dataset.modifierUid);
      if (input.value.trim() === '') return;
      const value = Number(input.value);
      if (!modifier || !Number.isFinite(value)) return;
      const [scope, property] = input.dataset.modifierVector.split('.');
      const axis = Number(input.dataset.axis);
      if (modifier[scope][property][axis] === value) return;
      if (!snapshotTaken) { snapshot(`modifier.${modifier.type}.transform`); snapshotTaken = true; }
      modifier[scope][property][axis] = value;
      sceneRenderer.invalidateMirrorGeometry(); markDirty(); renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  const operatorByUid = uidValue => item.operators?.find(operator => operator.uid === uidValue);
  $$('[data-edit-operator-anchor]', inspector).forEach(button => button.addEventListener('click', () => {
    const operator = operatorByUid(button.dataset.editOperatorAnchor);
    if (!operator?.enabled) return;
    state.selectedModifierUid = state.selectedModifierUid === operator.uid ? null : operator.uid;
    state.selectedCurveNodeIndex = null;
    if (state.selectedModifierUid) {
      if (state.mode !== 'edit') setMode('edit');
      if (!['move', 'rotate', 'pivot'].includes(state.tool)) setTool('move');
    }
    renderInspector(); renderScene(); updateSelectionLabels();
  }));
  const invalidatePaintOperator = operator => {
    if (operator) paintSymmetryRelationCache.delete(operator.uid);
    markDirty();
    if (operator?.enabled) schedulePaintSymmetryBuild(item, operator);
  };
  $('[data-action="addOperator"]', inspector)?.addEventListener('click', () => {
    const type = $('[data-operator-add-type]', inspector)?.value;
    if (!type) return;
    snapshot(`operator.${type}.add`);
    const operator = addOperator(item, type);
    if (!operator) return;
    invalidatePaintOperator(operator);
    renderInspector(); renderScene(); updateSelectionLabels();
  });
  $$('[data-operator-collapse]', inspector).forEach(button => button.addEventListener('click', () => {
    const uidValue = button.dataset.operatorCollapse;
    state.collapsedOperators.has(uidValue) ? state.collapsedOperators.delete(uidValue) : state.collapsedOperators.add(uidValue);
    renderInspector();
  }));
  $$('[data-operator-enabled]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const operator = operatorByUid(toggle.dataset.operatorEnabled);
    if (!operator) return;
    snapshot(`operator.${operator.type}.toggle`); operator.enabled = toggle.checked;
    if (!operator.enabled && state.selectedModifierUid === operator.uid) state.selectedModifierUid = null;
    invalidatePaintOperator(operator); renderInspector(); renderScene();
  }));
  $$('[data-operator-remove]', inspector).forEach(button => button.addEventListener('click', () => {
    const uidValue = button.dataset.operatorRemove;
    snapshot(`operator.${item.operators?.find(operator => operator.uid === uidValue)?.type || 'paint_symmetry'}.remove`); item.operators = (item.operators || []).filter(operator => operator.uid !== uidValue);
    if (state.selectedModifierUid === uidValue) state.selectedModifierUid = null;
    state.collapsedOperators.delete(uidValue); paintSymmetryRelationCache.delete(uidValue);
    markDirty(); renderInspector(); renderScene();
  }));
  $$('[data-operator-move]', inspector).forEach(button => button.addEventListener('click', () => {
    const index = item.operators?.findIndex(operator => operator.uid === button.dataset.operatorUid) ?? -1;
    const target = index + (button.dataset.operatorMove === 'up' ? -1 : 1);
    if (index < 0 || target < 0 || target >= item.operators.length) return;
    snapshot(`operator.${item.operators[index].type}.move`); [item.operators[index], item.operators[target]] = [item.operators[target], item.operators[index]];
    invalidatePaintOperator(item.operators[target]); renderInspector();
  }));
  $$('[data-operator-axis]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const operator = operatorByUid(toggle.dataset.operatorUid);
    if (!operator) return;
    snapshot(`operator.${operator.type}.change`); operator.axes[toggle.dataset.operatorAxis] = toggle.checked;
    invalidatePaintOperator(operator);
    renderScene();
  }));
  $$('[data-operator-field]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const operator = operatorByUid(input.dataset.operatorUid);
      if (!operator || (input.type === 'number' && input.value.trim() === '')) return;
      const key = input.dataset.operatorField;
      let value = input.type === 'number' ? Number(input.value) : input.value;
      if (key === 'copies') value = Math.max(1, Math.min(256, Math.round(value) || 1));
      if ((input.type === 'number' && !Number.isFinite(value)) || operator[key] === value) return;
      if (!snapshotTaken) { snapshot(`operator.${operator.type}.change`); snapshotTaken = true; }
      operator[key] = value; invalidatePaintOperator(operator);
      if (key === 'mode' || key === 'distribution') renderInspector();
      renderScene();
    };
    input.addEventListener(input.type === 'number' ? 'input' : 'change', apply);
    if (input.type === 'number') {
      input.addEventListener('change', apply);
      input.addEventListener('blur', () => { snapshotTaken = false; });
    }
  });
  $$('[data-operator-vector]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const operator = operatorByUid(input.dataset.operatorUid);
      if (input.value.trim() === '') return;
      const value = Number(input.value);
      if (!operator || !Number.isFinite(value)) return;
      const [scope, property] = input.dataset.operatorVector.split('.');
      const axis = Number(input.dataset.axis);
      if (operator[scope][property][axis] === value) return;
      if (!snapshotTaken) { snapshot(`operator.${operator.type}.transform`); snapshotTaken = true; }
      operator[scope][property][axis] = value;
      invalidatePaintOperator(operator);
      renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  $('[data-shape-snap-mode]', inspector)?.addEventListener('change', event => {
    snapshot('core.shape.snap_mode');
    for (const target of items.filter(isShapeElement)) target.parameters.snapMode = event.target.value === 'radius' ? 'radius' : 'edge';
    markDirty(); renderAll('selection');
  });
  $('[data-shape-inner-radius]', inspector)?.addEventListener('change', event => {
    snapshot('core.shape.inner_radius');
    for (const target of items.filter(isShapeElement)) {
      discardSubdivisionEdits(target);
      target.parameters.innerRadiusEnabled = event.target.checked;
    }
    markDirty(); renderAll('selection');
  });
  $('[data-shape-inner-radius-mode]', inspector)?.addEventListener('change', event => {
    snapshot('core.shape.inner_radius_mode');
    for (const target of items.filter(isShapeElement)) {
      discardSubdivisionEdits(target);
      target.parameters.innerRadiusMode = event.target.value === 'depth' ? 'depth' : 'radius';
    }
    markDirty(); renderAll('selection');
  });
  $('[data-curve-segmentation]', inspector)?.addEventListener('change', event => {
    snapshot('core.curve.segmentation');
    for (const target of items.filter(isBezierElement)) {
      discardSubdivisionEdits(target);
      target.parameters.segmentationMode = event.target.value;
    }
    markDirty(); renderAll('selection');
  });
  $$('[data-select-curve-node]', inspector).forEach(button => button.addEventListener('click', () => {
    state.selectedModifierUid = null;
    state.selectedCurveNodeIndex = Number(button.dataset.selectCurveNode);
    renderInspector(); renderScene(); updateSelectionLabels();
  }));
  $$('[data-curve-node-toggle]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const node = item.nodes?.[Number(toggle.dataset.curveNodeToggle)];
    if (!node) return;
    snapshot('core.curve.handle'); discardSubdivisionEdits(item); node.handlesEnabled = toggle.checked; markDirty(); renderAll('selection');
  }));
  $$('[data-curve-node-symmetric]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const node = item.nodes?.[Number(toggle.dataset.curveNodeSymmetric)];
    if (!node) return;
    snapshot('core.curve.handle');
    discardSubdivisionEdits(item);
    node.symmetricHandles = toggle.checked;
    if (toggle.checked) setCurveHandle(node, 'handleOut', node.handleOut, item.dimension === 2);
    markDirty(); renderAll('selection');
  }));
  $$('[data-curve-node-auto]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const index = Number(toggle.dataset.curveNodeAuto);
    const node = item.nodes?.[index];
    if (!node) return;
    snapshot('core.curve.tangent');
    discardSubdivisionEdits(item);
    if (!toggle.checked && node.autoTangent) bakeCurveNodeTangent(item, index);
    else node.autoTangent = toggle.checked;
    markDirty(); renderAll('selection');
  }));
  $$('[data-curve-node-roll]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const node = item.nodes?.[Number(input.dataset.curveNodeRoll)];
      const value = Number(input.value);
      if (!node || !Number.isFinite(value) || item.dimension !== 3) return;
      if (!snapshotTaken) { snapshot('core.curve.roll'); snapshotTaken = true; }
      discardSubdivisionEdits(item);
      node.roll = value;
      markDirty(); invalidateSelectionRenderGeometry(); renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  $$('[data-remove-curve-node]', inspector).forEach(button => button.addEventListener('click', () => {
    if (!isBezierElement(item) || item.nodes.length <= 2) return;
    snapshot('core.curve.node_remove');
    discardSubdivisionEdits(item);
    item.nodes.splice(Number(button.dataset.removeCurveNode), 1);
    state.selectedCurveNodeIndex = Math.min(item.nodes.length - 1, state.selectedCurveNodeIndex ?? 0);
    markDirty(); renderAll('selection');
  }));
  $('[data-action="deleteSelected"]', inspector)?.addEventListener('click', deleteSelected);
  $('[data-action="enterSubdivisionEdit"]', inspector)?.addEventListener('click', () => enterSubdivisionEdit(item));
  $('[data-action="exitSubdivisionEdit"]', inspector)?.addEventListener('click', () => exitSubdivisionEdit());
  $('[data-action="resetTransform"]', inspector)?.addEventListener('click', () => {
    snapshot('core.element.reset_rotation');
    for (const target of items) {
      if (target.type !== 'group' && Array.isArray(target.rotation)) target.rotation = [0, 0, 0];
    }
    markDirty(); renderAll('selection');
  });
}
return {
  get subdivisionSession() { return subdivisionSession; },
  set subdivisionSession(value) { subdivisionSession = value; },
  inspectorBatchNodes, sharedVectorValues, isBezierElement, isShapeElement,
  isProceduralShape, subdivisionOwner, subdivisionPatch, syncSubdivisionEdits,
  enterSubdivisionEdit, exitSubdivisionEdit, discardSubdivisionEdits,
  renderInspector, setNodeVisibility, setNodeFlag
};
}
