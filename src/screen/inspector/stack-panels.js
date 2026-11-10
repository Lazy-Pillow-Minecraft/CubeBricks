import { addModifier, addOperator, bakeModifier } from '../../model.js';
import { displayedTransformVector } from '../../common/core/applied-transform.js';
import { formatRules } from '../../common/core/format-constraints.js';
import { modifierRegistry } from '../../common/config/modifiers.js';
import { operatorRegistry } from '../../common/config/operators.js';
import { paintSymmetryRelationCache } from '../../paint/symmetry-relations.js';

// Markup and input handlers share the modifier and operator registries.
export function createInspectorStackPanels({
  state, $, $$, sceneRenderer, round, openIconMarkup, escapeHtml,
  schedulePaintSymmetryBuild, snapshot, markDirty, renderInspector, renderScene,
  updateSelectionLabels, toast, renderAll, setTool, syncInspectorValues, setMode
}) {
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

  function elementCopyModifierMarkup(modifier) {
    return `<div class="modifier-settings">
    <p class="modifier-anchor-note">拷貝節點在右側元素列表中，與所屬物件同層變換。</p>
    <div class="field-title"><span>拷貝節點 · ${modifier.nodes.length}</span><button type="button" data-copy-node-add="${modifier.uid}">＋ 新增節點</button></div>
  </div>`;
  }

  function modifierPanelMarkup(owner) {
    const modifiers = owner.modifiers || [];
    const available = modifierRegistry.listFor(owner.type, formatRules(state.project)).filter(definition =>
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
      ${collapsed ? '' : modifier.type === 'symmetry' ? symmetryModifierMarkup(owner, modifier)
          : modifier.type === 'element_copy' ? elementCopyModifierMarkup(modifier) : ''}
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



  function bindStackPanels(inspector, item) {
    const modifierByUid = uidValue => item.modifiers?.find(modifier => modifier.uid === uidValue);
    $('[data-action="addModifier"]', inspector)?.addEventListener('click', () => {
      const type = $('[data-modifier-add-type]', inspector)?.value;
      if (!type) return;
      snapshot(`modifier.${type}.add`);
      const modifier = addModifier(item, type, {}, state.project);
      if (!modifier) return;
      state.selectedModifierUid = modifier.uid;
      state.selectedModifierNodeUid = modifier.type === 'element_copy' ? modifier.nodes[0]?.uid || null : null;
      state.selectedCurveNodeIndex = null;
      sceneRenderer.invalidateMirrorGeometry();
      markDirty();
      renderInspector();
      renderScene();
      updateSelectionLabels();
    });
    $$('[data-modifier-collapse]', inspector).forEach(button => button.addEventListener('click', () => {
      const uidValue = button.dataset.modifierCollapse;
      state.collapsedModifiers.has(uidValue) ? state.collapsedModifiers.delete(uidValue) : state.collapsedModifiers.add(uidValue);
      renderInspector();
    }));
    $$('[data-modifier-enabled]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
      const modifier = modifierByUid(toggle.dataset.modifierEnabled);
      if (!modifier) return;
      snapshot(`modifier.${modifier.type}.toggle`);
      modifier.enabled = toggle.checked;
      if (!modifier.enabled && state.selectedModifierUid === modifier.uid) state.selectedModifierUid = null;
      sceneRenderer.invalidateMirrorGeometry();
      markDirty();
      renderInspector();
      renderScene();
      updateSelectionLabels();
    }));
    $$('[data-modifier-remove]', inspector).forEach(button => button.addEventListener('click', () => {
      snapshot(`modifier.${item.modifiers?.find(modifier => modifier.uid === button.dataset.modifierRemove)?.type || 'symmetry'}.remove`);
      item.modifiers = (item.modifiers || []).filter(modifier => modifier.uid !== button.dataset.modifierRemove);
      if (state.selectedModifierUid === button.dataset.modifierRemove) {
        state.selectedModifierUid = null;
        state.selectedModifierNodeUid = null;
      }
      state.collapsedModifiers.delete(button.dataset.modifierRemove);
      sceneRenderer.invalidateMirrorGeometry();
      markDirty();
      renderInspector();
      renderScene();
      updateSelectionLabels();
    }));
    $$('[data-modifier-bake]', inspector).forEach(button => button.addEventListener('click', () => {
      const modifierUid = button.dataset.modifierBake;
      snapshot(`modifier.${item.modifiers?.find(modifier => modifier.uid === modifierUid)?.type || 'symmetry'}.bake`);
      const result = bakeModifier(state.project, item, modifierUid);
      if (!result) return toast('這個修改器目前無法烘焙');
      state.selectedModifierUid = null;
      state.collapsedModifiers.delete(modifierUid);
      const bakedSelection = result.groupUids.length ? [result.rootUid] : result.elementUids;
      state.selectedUid = bakedSelection[0] || null;
      state.selectedUids = new Set(bakedSelection);
      state.selectionAnchorUid = state.selectedUid;
      markDirty();
      renderAll();
      toast('已烘焙選中的修改器');
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
      renderInspector();
      renderScene();
      updateSelectionLabels();
    }));
    $$('[data-copy-node-add]', inspector).forEach(button => button.addEventListener('click', () => {
      const modifier = modifierByUid(button.dataset.copyNodeAdd);
      if (!modifier || modifier.type !== 'element_copy') return;
      snapshot(`modifier.${modifier.type}.change`);
      const current = modifier.nodes.find(node => node.uid === state.selectedModifierNodeUid);
      const pivot = item.pivot || item.origin || item.position || [0, 0, 0];
      const source = current && current !== modifier.nodes[0] ? current : null;
      const node = {
        uid: `copy_node_${crypto.randomUUID()}`,
        position: [...(source?.position || pivot)],
        rotation: [...(source?.rotation || displayedTransformVector(item, 'rotation'))]
      };
      modifier.nodes.push(node);
      state.selectedModifierUid = modifier.uid;
      state.selectedModifierNodeUid = node.uid;
      sceneRenderer.invalidateMirrorGeometry();
      markDirty();
      renderInspector();
      renderScene();
      updateSelectionLabels();
    }));
    $$('[data-copy-node-remove]', inspector).forEach(button => button.addEventListener('click', () => {
      const modifier = modifierByUid(button.dataset.modifierUid);
      if (!modifier || modifier.type !== 'element_copy') return;
      snapshot(`modifier.${modifier.type}.change`);
      modifier.nodes = modifier.nodes.filter(node => node.uid !== button.dataset.copyNodeRemove);
      if (state.selectedModifierNodeUid === button.dataset.copyNodeRemove)
        state.selectedModifierNodeUid = modifier.nodes[0]?.uid || null;
      sceneRenderer.invalidateMirrorGeometry();
      markDirty();
      renderInspector();
      renderScene();
      updateSelectionLabels();
    }));
    $$('[data-copy-node-select]', inspector).forEach(button => button.addEventListener('click', () => {
      state.selectedModifierUid = button.dataset.modifierUid;
      state.selectedModifierNodeUid = button.dataset.copyNodeSelect;
      state.selectedCurveNodeIndex = null;
      if (!['move', 'rotate', 'pivot'].includes(state.tool)) setTool('move');
      else {
        renderInspector();
        renderScene();
        updateSelectionLabels();
      }
    }));
    $$('[data-modifier-move]', inspector).forEach(button => button.addEventListener('click', () => {
      const index = item.modifiers?.findIndex(modifier => modifier.uid === button.dataset.modifierUid) ?? -1;
      const target = index + (button.dataset.modifierMove === 'up' ? -1 : 1);
      if (index < 0 || target < 0 || target >= item.modifiers.length) return;
      snapshot(`modifier.${item.modifiers[index].type}.move`);
      [item.modifiers[index], item.modifiers[target]] = [item.modifiers[target], item.modifiers[index]];
      sceneRenderer.invalidateMirrorGeometry();
      markDirty();
      renderInspector();
      renderScene();
    }));
    $$('[data-modifier-axis]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
      const modifier = modifierByUid(toggle.dataset.modifierUid);
      if (!modifier) return;
      snapshot(`modifier.${modifier.type}.change`);
      modifier.axes[toggle.dataset.modifierAxis] = toggle.checked;
      sceneRenderer.invalidateMirrorGeometry();
      markDirty();
      renderScene();
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
        if (!snapshotTaken) {
          snapshot(`modifier.${modifier.type}.change`);
          snapshotTaken = true;
        }
        modifier[key] = value;
        sceneRenderer.invalidateMirrorGeometry();
        markDirty();
        if (key === 'mode' || key === 'distribution') renderInspector();
        else syncInspectorValues();
        renderScene();
      };
      input.addEventListener(input.type === 'number' ? 'input' : 'change', apply);
      if (input.type === 'number') {
        input.addEventListener('change', apply);
        input.addEventListener('blur', () => {
          snapshotTaken = false;
          const modifier = modifierByUid(input.dataset.modifierUid);
          if (modifier) input.value = String(round(modifier[input.dataset.modifierField]));
          syncInspectorValues();
        });
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
        const vector = scope === 'nodes' ? modifier.nodes?.find(node => node.uid === property)?.[input.dataset.modifierVector.split('.')[2]]
          : modifier[scope]?.[property];
        if (!vector || vector[axis] === value) return;
        if (!snapshotTaken) {
          snapshot(`modifier.${modifier.type}.transform`);
          snapshotTaken = true;
        }
        vector[axis] = value;
        sceneRenderer.invalidateMirrorGeometry();
        markDirty();
        syncInspectorValues();
        renderScene();
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', apply);
      input.addEventListener('blur', () => {
        snapshotTaken = false;
        const modifier = modifierByUid(input.dataset.modifierUid);
        const [scope, property, field] = input.dataset.modifierVector.split('.');
        const vector = scope === 'nodes' ? modifier?.nodes?.find(node => node.uid === property)?.[field] : modifier?.[scope]?.[property];
        if (vector) input.value = String(round(vector[Number(input.dataset.axis)]));
        syncInspectorValues();
      });
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
      renderInspector();
      renderScene();
      updateSelectionLabels();
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
      renderInspector();
      renderScene();
      updateSelectionLabels();
    });
    $$('[data-operator-collapse]', inspector).forEach(button => button.addEventListener('click', () => {
      const uidValue = button.dataset.operatorCollapse;
      state.collapsedOperators.has(uidValue) ? state.collapsedOperators.delete(uidValue) : state.collapsedOperators.add(uidValue);
      renderInspector();
    }));
    $$('[data-operator-enabled]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
      const operator = operatorByUid(toggle.dataset.operatorEnabled);
      if (!operator) return;
      snapshot(`operator.${operator.type}.toggle`);
      operator.enabled = toggle.checked;
      if (!operator.enabled && state.selectedModifierUid === operator.uid) state.selectedModifierUid = null;
      invalidatePaintOperator(operator);
      renderInspector();
      renderScene();
    }));
    $$('[data-operator-remove]', inspector).forEach(button => button.addEventListener('click', () => {
      const uidValue = button.dataset.operatorRemove;
      snapshot(`operator.${item.operators?.find(operator => operator.uid === uidValue)?.type || 'paint_symmetry'}.remove`);
      item.operators = (item.operators || []).filter(operator => operator.uid !== uidValue);
      if (state.selectedModifierUid === uidValue) state.selectedModifierUid = null;
      state.collapsedOperators.delete(uidValue);
      paintSymmetryRelationCache.delete(uidValue);
      markDirty();
      renderInspector();
      renderScene();
    }));
    $$('[data-operator-move]', inspector).forEach(button => button.addEventListener('click', () => {
      const index = item.operators?.findIndex(operator => operator.uid === button.dataset.operatorUid) ?? -1;
      const target = index + (button.dataset.operatorMove === 'up' ? -1 : 1);
      if (index < 0 || target < 0 || target >= item.operators.length) return;
      snapshot(`operator.${item.operators[index].type}.move`);
      [item.operators[index], item.operators[target]] = [item.operators[target], item.operators[index]];
      invalidatePaintOperator(item.operators[target]);
      renderInspector();
    }));
    $$('[data-operator-axis]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
      const operator = operatorByUid(toggle.dataset.operatorUid);
      if (!operator) return;
      snapshot(`operator.${operator.type}.change`);
      operator.axes[toggle.dataset.operatorAxis] = toggle.checked;
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
        if (!snapshotTaken) {
          snapshot(`operator.${operator.type}.change`);
          snapshotTaken = true;
        }
        operator[key] = value;
        invalidatePaintOperator(operator);
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
        if (!snapshotTaken) {
          snapshot(`operator.${operator.type}.transform`);
          snapshotTaken = true;
        }
        operator[scope][property][axis] = value;
        invalidatePaintOperator(operator);
        renderScene();
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', apply);
      input.addEventListener('blur', () => { snapshotTaken = false; });
    });
  }

  return { modifierVectorField, modifierPanelMarkup, operatorPanelMarkup, bindStackPanels };
}
