import { Shape, setPivotPreservingGeometry, setNodeName, setNodeUnnamed, translateNode } from '../model.js';
import { actualTransformValue, applyTransform, displayedTransformVector, restoreTransform, supportsAppliedTransform } from '../common/core/applied-transform.js';
import { formatRules, constrainNode, captureFormatGeometry, restoreFormatGeometry, keepFormatEditWithinLimit } from '../common/core/format-constraints.js';
import { proceduralShapeSupported } from '../common/core/procedural-format.js';
import { modifierRegistry } from '../common/config/modifiers.js';
import { operatorRegistry } from '../common/config/operators.js';
import { shapeRegistry } from '../shapes/builtins.js';
import { createSubdivisionController } from './inspector/subdivision.js';
import { createInspectorStackPanels } from './inspector/stack-panels.js';

export function createInspectorController({
  state, $, $$, inspector, sceneRenderer, topLevelSelectedUids, selected, round,
  setTool, invalidateAllRenderGeometry, renderAll, updateToolVisibility, toast,
  openIconMarkup, escapeHtml, escapeAttribute, renderPaintColorPicker,
  polyhedronEdgeLength, formatNumber, freezeCubeUvs, openColorPickerPopup,
  snapshot, markDirty, invalidateSelectionRenderGeometry, renderScene,
  syncInspectorValues, translateModifierAnchors, setCurveHandle,
  bakeCurveNodeTangent, updateSelectionLabels, setMode, schedulePaintSymmetryBuild,
  deleteSelected, isUvCapable, centerSelectedPivots
}) {
  const subdivision = createSubdivisionController({
    state, sceneRenderer, setTool, renderAll, updateToolVisibility,
    invalidateAllRenderGeometry, toast
  });
  const {
    isProceduralShape, subdivisionOwner, subdivisionPatch,
    syncSubdivisionEdits, enterSubdivisionEdit, exitSubdivisionEdit, discardSubdivisionEdits
  } = subdivision;
  const { modifierVectorField, modifierPanelMarkup, operatorPanelMarkup, bindStackPanels } = createInspectorStackPanels({
    state, $, $$, sceneRenderer, round, openIconMarkup, escapeHtml,
    schedulePaintSymmetryBuild, snapshot, markDirty, renderInspector, renderScene,
    updateSelectionLabels, toast, renderAll, setTool, syncInspectorValues, setMode
  });

  function inspectorBatchNodes() {
    const nodes = topLevelSelectedUids().map(uidValue => state.project.getNode(uidValue)).filter(Boolean);
    return nodes.length ? nodes : [selected()].filter(Boolean);
  }

  function sharedVectorValues(nodes, field, fallback) {
    if (field.startsWith('curve-node:')) return [...fallback];
    if (nodes.length <= 1) return displayedTransformVector(nodes[0], field);
    return [0, 1, 2].map(axis => {
      const first = displayedTransformVector(nodes[0], field)[axis];
      if (!Number.isFinite(first) || !nodes.every(node => Math.abs(displayedTransformVector(node, field)[axis] - first) < 1e-9)) return null;
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

  function curveNodeInspectorMarkup(item, index) {
    const node = item.nodes[index];
    if (!node) return '';
    const resolved = node.autoTangent ? item.resolvedNodeState(index) : null;
    const displayedRotation = resolved?.rotation || node.rotation;
    return `<div class="field-section curve-node-card active" data-curve-node-card="${index}">
    <div class="field-title"><span>節點 ${index + 1}</span><span>${item.dimension === 2 ? '2D' : '3D'}</span></div>
    ${vectorField('位置', `curve-node:${index}:position`, node.position)}
    ${vectorField('旋轉', `curve-node:${index}:rotation`, displayedRotation)}
    ${item.variant === 'envelope' ? `<div class="option-row"><span>自訂半徑</span><label class="switch"><input type="checkbox" data-curve-node-radius-enabled="${index}" ${node.radius !== null ? 'checked' : ''}/><i></i></label></div>
    ${node.radius !== null ? `<div class="option-row"><span>節點半徑</span><div class="number-wrap" style="width:68px"><input type="number" min="0" step="0.1" data-curve-node-radius="${index}" value="${round(node.radius)}" /></div></div>` : ''}` : ''}
    <div class="option-row"><span>自動切線</span><label class="switch"><input type="checkbox" data-curve-node-auto="${index}" ${node.autoTangent ? 'checked' : ''}/><i></i></label></div>
    ${item.dimension === 3 ? `<div class="option-row"><span>滾動角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-curve-node-roll="${index}" value="${round(node.roll || 0)}" /></div></div>` : ''}
    <div class="option-row"><span>貝塞爾手柄</span><label class="switch"><input type="checkbox" data-curve-node-toggle="${index}" ${node.handlesEnabled ? 'checked' : ''}/><i></i></label></div>
    ${node.handlesEnabled ? `<div class="option-row"><span>對稱手柄</span><label class="switch"><input type="checkbox" data-curve-node-symmetric="${index}" ${node.symmetricHandles ? 'checked' : ''}/><i></i></label></div>` : ''}
    ${node.handlesEnabled ? `${vectorField('前手柄', `curve-node:${index}:handleIn`, resolved?.localHandleIn || node.handleIn)}${vectorField('後手柄', `curve-node:${index}:handleOut`, resolved?.localHandleOut || node.handleOut)}` : ''}
    <button type="button" class="curve-node-remove" data-remove-curve-node="${index}" ${item.nodes.length <= 2 ? 'disabled' : ''}>刪除節點</button>
  </div>`;
  }

  function renderPaintOperatorInspector() {
    const root = $('#paintOperatorInspector');
    const item = selected();
    root.innerHTML = item ? operatorPanelMarkup(item)
      : '<div class="field-section"><p class="modifier-empty">選擇一個物件以設定操作器。</p></div>';
    if (item) bindInspector(root);
  }

  function renderInspector() {
    if (state.mode === 'paint') {
      renderPaintColorPicker();
      renderPaintOperatorInspector();
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
    const selectedCopyModifier = (item.modifiers || []).find(modifier => modifier.type === 'element_copy'
      && modifier.uid === state.selectedModifierUid);
    const selectedCopyNode = selectedCopyModifier?.nodes?.find(node => node.uid === state.selectedModifierNodeUid);
    if (selectedCopyNode) {
      inspector.innerHTML = `<nav class="inspector-tabs"><button type="button" class="active">拷貝節點</button></nav>
      <div class="field-section">
        ${modifierVectorField('位置', selectedCopyModifier, `nodes.${selectedCopyNode.uid}.position`, selectedCopyNode.position)}
        ${modifierVectorField('旋轉', selectedCopyModifier, `nodes.${selectedCopyNode.uid}.rotation`, selectedCopyNode.rotation)}
        <button type="button" data-copy-node-add="${selectedCopyModifier.uid}">＋ 新增節點</button>
        <button type="button" class="danger" data-copy-node-remove="${selectedCopyNode.uid}" data-modifier-uid="${selectedCopyModifier.uid}">刪除節點</button>
      </div>`;
      bindInspector();
      return;
    }
    const items = inspectorBatchNodes();
    const rotation = item.rotation || [0, 0, 0];
    const editOwner = subdivisionOwner(item);
    const typeLabel = editOwner ? 'Shape 細分 Cube' : isShapeElement(item)
      ? shapeRegistry.get(item.shapeType)?.label || `未安裝的 Shape：${item.shapeType}`
      : item.type === 'locator' ? 'Locator'
        : item.type === 'node' ? '節點' : item.type === 'bezier2d' ? `二維${item.variant === 'envelope' ? '包絡' : ''}貝塞爾`
          : item.type === 'bezier3d' ? `三維${item.variant === 'envelope' ? '包絡' : ''}貝塞爾` : item.type === 'group' ? '組' : '立方體';
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
      ${item.variant === 'envelope'
                    ? `${parameterField('預設半徑', 'radius', item.parameters.radius, .1, items)}
          <div class="option-row"><span>包絡方向</span><select data-curve-head-direction><option value="start" ${item.parameters.headAtStart !== false ? 'selected' : ''}>起點 → 終點</option><option value="end" ${item.parameters.headAtStart === false ? 'selected' : ''}>終點 → 起點</option></select></div>
          <div class="option-row"><span>烘焙為嵌套組</span><label class="switch"><input type="checkbox" data-curve-nested-bake ${item.parameters.nestedBake ? 'checked' : ''}/><i></i></label></div>`
                    : parameterField('Cube 柱粗細', 'thickness', item.parameters.thickness, .1, items)}
      <div class="option-row"><span>分段方式</span><select data-curve-segmentation><option value="distance" ${item.parameters.segmentationMode === 'distance' ? 'selected' : ''}>按距離</option><option value="angle" ${item.parameters.segmentationMode === 'angle' ? 'selected' : ''}>按角度</option></select></div>
      ${item.parameters.segmentationMode === 'angle'
                    ? parameterField('角度步長', 'angleStep', item.parameters.angleStep, .1, items)
                    : parameterField('距離步長', 'segmentLength', item.parameters.segmentLength, .1, items)}
      <div class="option-row"><span>生成 Cube</span><strong style="color:var(--accent)">${item.toCubes().length} 個</strong></div>`
                  : `
      <div class="field-title"><span>組屬性</span></div>
      ${vectorField('位置', 'transformPosition', item.pivot, items)}
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${scalarField('膨脹', 'inflate', item.inflate, items)}
      <div class="option-row"><span>直接子項</span><strong style="color:var(--accent)">${item.children.length}</strong></div>`;
    const appearanceCapable = item.type === 'cube' || isShapeElement(item) || isBezierElement(item) || item.type === 'group';
    const pages = [
      { id: 'basic', label: '基礎' },
      ...(appearanceCapable ? [{ id: 'appearance', label: '外觀' }] : []),
      ...(isUvCapable(item) ? [{ id: 'uv', label: 'UV' }] : []),
      ...(modifierRegistry.listFor(item.type, formatRules(state.project)).length || item.modifiers?.length ? [{ id: 'modifiers', label: '修改器' }] : []),
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
      ${supportsAppliedTransform(item) ? `<div class="applied-transform-actions">
        <button type="button" data-transform-action="apply" data-transform-kind="position">應用位移</button>
        <button type="button" data-transform-action="restore" data-transform-kind="position" ${items.some(node => node.appliedTransform?.position) ? '' : 'disabled'}>還原位移</button>
        <button type="button" data-transform-action="apply" data-transform-kind="rotation">應用旋轉</button>
        <button type="button" data-transform-action="restore" data-transform-kind="rotation" ${items.some(node => node.appliedTransform?.rotation) ? '' : 'disabled'}>還原旋轉</button>
      </div>` : ''}
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
    const unsupported = typeof item.toCubes === 'function' && !proceduralShapeSupported(item, state.project)
      ? '<div class="field-section"><p>当前模型格式暂不支持此 Shape</p><p>请切换到 Java 1.21.11+ 或其他支持的模型格式。</p></div>' : '';
    inspector.innerHTML = `${tabs}${unsupported}${content}`;
    bindInspector();
  }

  function vectorField(label, field, values, nodes = [selected()]) {
    const displayed = sharedVectorValues(nodes, field, values);
    const rules = formatRules(state.project);
    const step = field === 'size' && rules.integerCubeSize ? '1' : field === 'rotation' && rules.rotationStep ? String(rules.rotationStep) : '0.0001';
    const disabled = field === 'rotation' && rules.moddedEntity && nodes[0]?.type === 'cube' ? 'disabled title="Cube 不能旋轉；請旋轉其所屬的組"' : '';
    return `<div class="vector-field"><span>${label}</span>${displayed.map((value, index) => `<label class="number-wrap"><b>${'XYZ'[index]}</b><input type="number" step="${step}" data-vector="${field}" data-axis="${index}" ${numberInputAttributes(value)} ${disabled} /></label>`).join('')}${field === 'pivot' ? '<button type="button" class="pivot-center-field-button" data-action="centerPivot" title="將所選物件的樞軸點移到整體幾何中心">居中</button>' : ''}</div>`;
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
    const minimum = key === 'sides' ? 3 : key === 'innerRadius' || key === 'radius' ? 0 : key === 'cubeSize' || key === 'segmentLength' ? .0625 : .1;
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

  function bindInspector(root = null) {
    const inspector = root || $('#inspector');
    const item = selected();
    if (!item) return;
    const items = inspectorBatchNodes();
    $('[data-element-color-popup]', inspector)?.addEventListener('click', () => openColorPickerPopup(item.color, color => {
      snapshot('core.element.color');
      items.filter(node => typeof node.color === 'string').forEach(node => { node.color = color; });
      markDirty();
      renderAll('selection');
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
        const before = key === 'inflate' && (formatRules(state.project).bedrockBlock || formatRules(state.project).javaBlock)
          ? captureFormatGeometry(targets) : null;
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
        if (before) keepFormatEditWithinLimit(state.project, before);
        if (key === 'locked') sceneRenderer.invalidateLockState();
        markDirty();
        renderAll('selection');
      });
    });
    $$('[data-vector]', inspector).forEach(input => {
      let snapshotTaken = false;
      let javaRotationGeometry = null;
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
        const before = formatRules(state.project).bedrockBlock || formatRules(state.project).javaBlock ? captureFormatGeometry(items) : null;
        if (field === 'rotation' && formatRules(state.project).singleAxisRotation) {
          javaRotationGeometry ||= captureFormatGeometry(items.filter(node => node.type === 'cube'));
          restoreFormatGeometry(javaRotationGeometry);
        }
        if (field.startsWith('curve-node:') && isBezierElement(item)) {
          const [, indexText, property] = field.split(':');
          const node = item.nodes[Number(indexText)];
          if (!node || !Array.isArray(node[property])) return;
          discardSubdivisionEdits(item);
          if (node.autoTangent && ['rotation', 'handleIn', 'handleOut'].includes(property))
            bakeCurveNodeTangent(item, Number(indexText));
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
          if (before) keepFormatEditWithinLimit(state.project, before);
          markDirty();
          invalidateSelectionRenderGeometry();
          renderScene();
          return;
        }
        for (const target of items.filter(node => field === 'transformPosition' ? node.type === 'group' : Array.isArray(node[field]))) {
          const rules = formatRules(state.project);
          const requested = target.type === 'cube' && field === 'size' && rules.integerCubeSize ? Math.round(value) : value;
          const displayed = displayedTransformVector(target, field);
          displayed[axis] = requested;
          const actual = ['position', 'origin', 'transformPosition', 'rotation'].includes(field)
            ? actualTransformValue(target, field, displayed) : displayed;
          const nextValue = target.type === 'cube' && field === 'size' && !state.allowNegativeSize
            ? Math.max(0, requested)
            : actual[axis];
          if (field === 'transformPosition' && target.type === 'group') {
            const delta = actual.map((component, index) => component - target.pivot[index]);
            translateNode(state.project, target, delta);
          } else if (field === 'rotation' && supportsAppliedTransform(target)) {
            target.rotation = actual;
          } else
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
          if (field === 'rotation' || field === 'size' || field === 'position') constrainNode(target, rules);
        }
        if (before) keepFormatEditWithinLimit(state.project, before);
        const displayedValue = item.type === 'cube' && field === 'size' && !state.allowNegativeSize ? Math.max(0, value) : value;
        if (displayedValue !== value) input.value = String(displayedValue);
        markDirty();
        invalidateSelectionRenderGeometry();
        syncInspectorValues();
        renderScene();
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', apply);
      input.addEventListener('blur', () => {
        snapshotTaken = false;
        if (javaRotationGeometry) {
          javaRotationGeometry = null;
          syncInspectorValues();
        }
      });
    });
    $$('[data-parameter]', inspector).forEach(input => {
      let snapshotTaken = false;
      const apply = () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        if (!snapshotTaken) {
          snapshot(input.dataset.operationId || `core.shape.parameter.${input.dataset.parameter.toLowerCase()}`);
          snapshotTaken = true;
        }
        delete input.dataset.mixed;
        const key = input.dataset.parameter;
        const nextValue = input.dataset.min !== undefined ? Math.max(Number(input.dataset.min), value)
          : key === 'sides' ? Math.max(3, Math.round(value))
            : Math.max(key === 'innerRadius' || key === 'radius' ? 0 : key === 'cubeSize' || key === 'segmentLength' ? .0625 : .1, value);
        const before = formatRules(state.project).bedrockBlock || formatRules(state.project).javaBlock ? captureFormatGeometry(items) : null;
        for (const target of items.filter(node => node.parameters && key in node.parameters)) {
          discardSubdivisionEdits(target);
          target.parameters[key] = nextValue;
        }
        if (before) keepFormatEditWithinLimit(state.project, before);
        markDirty();
        invalidateSelectionRenderGeometry();
        syncInspectorValues();
        renderScene();
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
    bindStackPanels(inspector, item);
    $('[data-shape-snap-mode]', inspector)?.addEventListener('change', event => {
      snapshot('core.shape.snap_mode');
      for (const target of items.filter(isShapeElement)) target.parameters.snapMode = event.target.value === 'radius' ? 'radius' : 'edge';
      markDirty();
      renderAll('selection');
    });
    $('[data-shape-inner-radius]', inspector)?.addEventListener('change', event => {
      snapshot('core.shape.inner_radius');
      for (const target of items.filter(isShapeElement)) {
        discardSubdivisionEdits(target);
        target.parameters.innerRadiusEnabled = event.target.checked;
      }
      markDirty();
      renderAll('selection');
    });
    $('[data-shape-inner-radius-mode]', inspector)?.addEventListener('change', event => {
      snapshot('core.shape.inner_radius_mode');
      for (const target of items.filter(isShapeElement)) {
        discardSubdivisionEdits(target);
        target.parameters.innerRadiusMode = event.target.value === 'depth' ? 'depth' : 'radius';
      }
      markDirty();
      renderAll('selection');
    });
    $('[data-curve-segmentation]', inspector)?.addEventListener('change', event => {
      snapshot('core.curve.segmentation');
      for (const target of items.filter(isBezierElement)) {
        discardSubdivisionEdits(target);
        target.parameters.segmentationMode = event.target.value;
      }
      markDirty();
      renderAll('selection');
    });
    $('[data-curve-head-direction]', inspector)?.addEventListener('change', event => {
      snapshot('core.curve.head_direction');
      for (const target of items.filter(node => isBezierElement(node) && node.variant === 'envelope')) {
        target.parameters.headAtStart = event.target.value !== 'end';
      }
      markDirty();
      renderInspector();
    });
    $('[data-curve-nested-bake]', inspector)?.addEventListener('change', event => {
      snapshot('core.curve.nested_bake');
      for (const target of items.filter(node => isBezierElement(node) && node.variant === 'envelope')) {
        target.parameters.nestedBake = event.target.checked;
      }
      markDirty();
      renderInspector();
    });
    $$('[data-select-curve-node]', inspector).forEach(button => button.addEventListener('click', () => {
      state.selectedModifierUid = null;
      state.selectedCurveNodeIndex = Number(button.dataset.selectCurveNode);
      renderInspector();
      renderScene();
      updateSelectionLabels();
    }));
    $$('[data-curve-node-toggle]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
      const node = item.nodes?.[Number(toggle.dataset.curveNodeToggle)];
      if (!node) return;
      snapshot('core.curve.handle');
      discardSubdivisionEdits(item);
      node.handlesEnabled = toggle.checked;
      markDirty();
      renderAll('selection');
    }));
    $$('[data-curve-node-symmetric]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
      const node = item.nodes?.[Number(toggle.dataset.curveNodeSymmetric)];
      if (!node) return;
      snapshot('core.curve.handle');
      discardSubdivisionEdits(item);
      node.symmetricHandles = toggle.checked;
      if (toggle.checked) setCurveHandle(node, 'handleOut', node.handleOut, item.dimension === 2);
      markDirty();
      renderAll('selection');
    }));
    $$('[data-curve-node-auto]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
      const index = Number(toggle.dataset.curveNodeAuto);
      const node = item.nodes?.[index];
      if (!node) return;
      snapshot('core.curve.tangent');
      discardSubdivisionEdits(item);
      if (!toggle.checked && node.autoTangent) bakeCurveNodeTangent(item, index);
      else node.autoTangent = toggle.checked;
      markDirty();
      renderAll('selection');
    }));
    $$('[data-curve-node-roll]', inspector).forEach(input => {
      let snapshotTaken = false;
      const apply = () => {
        const node = item.nodes?.[Number(input.dataset.curveNodeRoll)];
        const value = Number(input.value);
        if (!node || !Number.isFinite(value) || item.dimension !== 3) return;
        if (!snapshotTaken) {
          snapshot('core.curve.roll');
          snapshotTaken = true;
        }
        discardSubdivisionEdits(item);
        node.roll = value;
        markDirty();
        invalidateSelectionRenderGeometry();
        renderScene();
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', apply);
      input.addEventListener('blur', () => { snapshotTaken = false; });
    });
    $$('[data-curve-node-radius-enabled]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
      const node = item.nodes?.[Number(toggle.dataset.curveNodeRadiusEnabled)];
      if (!node || item.variant !== 'envelope') return;
      snapshot('core.curve.node_radius');
      discardSubdivisionEdits(item);
      node.radius = toggle.checked ? Math.max(0, Number(item.parameters.radius) || 0) : null;
      markDirty();
      renderAll('selection');
    }));
    $$('[data-curve-node-radius]', inspector).forEach(input => {
      let snapshotTaken = false;
      const apply = () => {
        const node = item.nodes?.[Number(input.dataset.curveNodeRadius)];
        if (!node || item.variant !== 'envelope' || input.value.trim() === '') return;
        const radius = Number(input.value);
        if (!Number.isFinite(radius)) return;
        const next = Math.max(0, radius);
        if (node.radius === next) return;
        if (!snapshotTaken) {
          snapshot('core.curve.node_radius');
          snapshotTaken = true;
        }
        discardSubdivisionEdits(item);
        node.radius = next;
        markDirty();
        invalidateSelectionRenderGeometry();
        renderScene();
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
      markDirty();
      renderAll('selection');
    }));
    $('[data-action="deleteSelected"]', inspector)?.addEventListener('click', deleteSelected);
    $('[data-action="centerPivot"]', inspector)?.addEventListener('click', centerSelectedPivots);
    $$('[data-transform-action]', inspector).forEach(button => button.addEventListener('click', () => {
      const kind = button.dataset.transformKind;
      const action = button.dataset.transformAction;
      const targets = items.filter(supportsAppliedTransform);
      if (!targets.length || action === 'restore' && !targets.some(target => target.appliedTransform?.[kind])) return;
      snapshot(`core.element.${action}_applied_${kind}`);
      targets.forEach(target => action === 'apply' ? applyTransform(target, kind) : restoreTransform(target, kind));
      markDirty();
      renderAll('selection');
    }));
    $('[data-action="enterSubdivisionEdit"]', inspector)?.addEventListener('click', () => enterSubdivisionEdit(item));
    $('[data-action="exitSubdivisionEdit"]', inspector)?.addEventListener('click', () => exitSubdivisionEdit());
    $('[data-action="resetTransform"]', inspector)?.addEventListener('click', () => {
      snapshot('core.element.reset_rotation');
      for (const target of items) {
        if (target.type !== 'group' && Array.isArray(target.rotation))
          target.rotation = actualTransformValue(target, 'rotation', [0, 0, 0]);
      }
      markDirty();
      renderAll('selection');
    });
  }
  return {
    get subdivisionSession() { return subdivision.subdivisionSession; },
    set subdivisionSession(value) { subdivision.subdivisionSession = value; },
    inspectorBatchNodes, sharedVectorValues, isBezierElement, isShapeElement,
    isProceduralShape, subdivisionOwner, subdivisionPatch, syncSubdivisionEdits,
    enterSubdivisionEdit, exitSubdivisionEdit, discardSubdivisionEdits,
    renderInspector, setNodeVisibility, setNodeFlag
  };
}
