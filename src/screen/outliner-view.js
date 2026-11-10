import { modelFormatRegistry } from '../common/config/model-formats.js';
import { shapeRegistry } from '../shapes/builtins.js';

export function createOutlinerViewController({
  state, $, outliner, LOCATOR_ICON_SHAPES, selected, selectedElementUids,
  isBezierElement, isShapeElement, escapeHtml, escapeAttribute
}) {
  let outlinerFrame = null;
  const ITEM_HEIGHT = 31;
  const GROUP_END_HEIGHT = 16;
  const END_PADDING = ITEM_HEIGHT * 3;
  const treeLineX = depth => 16 + depth * 13;
  function rowAtOffset(rows, offset) {
    let low = 0, high = rows.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (rows[middle].top + rows[middle].height <= offset) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  function treeLines(ancestors, ownGroup = null, ending = false) {
    return ancestors.map(({ uid, depth }) => `<span class="outliner-tree-line" data-group-line-uid="${uid}" style="left:${treeLineX(depth)}px"></span>`).join('')
      + (ownGroup === null ? '' : `<span class="outliner-tree-line ${ending ? 'ends-here' : 'starts-here'}" data-group-line-uid="${ownGroup.uid}" style="left:${treeLineX(ownGroup.depth)}px"></span>`);
  }
  function updateSelectionLabels() {
    const item = selected();
    const modifierAnchorSelected = [...(item?.modifiers || []), ...(item?.operators || [])].find(modifier => modifier.uid === state.selectedModifierUid);
    const copyNodeIndex = modifierAnchorSelected?.type === 'element_copy'
      ? modifierAnchorSelected.nodes?.findIndex(node => node.uid === state.selectedModifierNodeUid) : -1;
    const curveNodeSelected = isBezierElement(item) && Number.isInteger(state.selectedCurveNodeIndex)
      && item.nodes[state.selectedCurveNodeIndex];
    const format = modelFormatRegistry.get(state.project.formatId);
    $('#selectionType').textContent = state.selectedGenerated ? 'modifier_result' : modifierAnchorSelected ? 'modifier_anchor'
      : curveNodeSelected ? 'curve_node' : item?.type || format?.name || 'Scene';
    $('#selectionName').textContent = state.selectedGenerated
      ? `${state.project.getNode(state.selectedGenerated.uid)?.name || '生成物'} · 唯讀`
      : modifierAnchorSelected ? (copyNodeIndex >= 0 ? `拷貝節點 ${copyNodeIndex + 1}` : '對稱軸點')
        : curveNodeSelected ? `節點 ${state.selectedCurveNodeIndex + 1}`
          : state.selectedUids.size > 1 ? `已選 ${state.selectedUids.size} 項` : item?.name || state.project.name;
    $('#uidChip').textContent = state.selectedGenerated?.uid
      || (copyNodeIndex >= 0 ? modifierAnchorSelected.nodes[copyNodeIndex].uid : modifierAnchorSelected?.uid)
      || curveNodeSelected?.uid || item?.uid || '—';
    const selectedCount = selectedElementUids().length;
    const counter = $('#outlinerSelectionCount');
    if (counter) counter.textContent = `${selectedCount}/${state.project.elements.filter(element => !element.subdivisionOwnerUid).length}`;
  }

  function renderOutliner() {
    const filter = $('#outlinerSearch').value.trim().toLowerCase();
    const matchCache = new Map();
    const matches = uidValue => {
      if (matchCache.has(uidValue)) return matchCache.get(uidValue);
      const node = state.project.getNode(uidValue);
      if (!node) return false;
      matchCache.set(uidValue, false);
      const matched = !filter || node.name.toLowerCase().includes(filter) || node.uid.toLowerCase().includes(filter)
        || node.type === 'group' && node.children.some(matches)
        || isBezierElement(node) && node.nodes.some((curveNode, index) => curveNode.uid.toLowerCase().includes(filter)
          || `節點 ${index + 1}`.includes(filter));
      matchCache.set(uidValue, matched);
      return matched;
    };
    const rows = [];
    const collectNode = (uidValue, depth = 0, ancestors = []) => {
      const node = state.project.getNode(uidValue);
      if (!node || !matches(uidValue)) return;
      const group = node.type === 'group';
      const curve = isBezierElement(node);
      const copyModifiers = (node.modifiers || []).filter(modifier => modifier.type === 'element_copy' && modifier.enabled);
      const hasCopyNodes = copyModifiers.some(modifier => modifier.nodes?.length);
      const container = group || curve;
      const collapsed = container && state.collapsedGroups.has(node.uid);
      rows.push({ node, depth, group, curve, container, collapsed, hasCopyNodes, ancestors, height: ITEM_HEIGHT });
      if (group && !collapsed) node.children.forEach(child => collectNode(child, depth + 1,
        [...ancestors, { uid: node.uid, depth }]));
      if (curve && !collapsed) node.nodes.forEach((curveNode, nodeIndex) => rows.push({
        node: curveNode, depth: depth + 1, group: false, curve: false, container: false, collapsed: false,
        curveNode: true, curveOwner: node, nodeIndex, ancestors, height: ITEM_HEIGHT
      }));
      if (group) rows.push({ groupEnd: true, groupUid: node.uid, depth, ancestors, height: GROUP_END_HEIGHT });
      if (hasCopyNodes && !state.collapsedCopyNodes.has(node.uid)) {
        for (const modifier of copyModifiers) (modifier.nodes || []).forEach((copyNode, nodeIndex) => rows.push({
          node: copyNode, depth: depth + 1, copyNode: true, copyOwner: node, copyModifier: modifier,
          nodeIndex, ancestors, height: ITEM_HEIGHT
        }));
        rows.push({ copyEnd: true, copyOwnerUid: node.uid, depth, ancestors, height: GROUP_END_HEIGHT });
      }
    };
    state.project.outliner.forEach(uidValue => collectNode(uidValue));
    let totalHeight = 0;
    for (const row of rows) {
      row.top = totalHeight;
      totalHeight += row.height;
    }
    state.outlinerRows = rows;
    state.outlinerWindowStart = -1;
    state.outlinerWindowEnd = -1;
    const scrollTop = outliner.scrollTop;
    outliner.innerHTML = `<div class="outliner-virtual-spacer" style="height:${totalHeight + END_PADDING}px"></div><div class="outliner-virtual-window"></div><div class="outliner-root-tail" style="top:${totalHeight}px;height:${END_PADDING}px" title="拖到此處放在根層"></div>`;
    outliner.scrollTop = scrollTop;
    renderOutlinerWindow();
  }

  function renderOutlinerWindow() {
    const rows = state.outlinerRows || [];
    const overscan = 6;
    const start = Math.max(0, rowAtOffset(rows, outliner.scrollTop) - overscan);
    const end = Math.min(rows.length, rowAtOffset(rows, outliner.scrollTop + outliner.clientHeight) + overscan + 1);
    if (start === state.outlinerWindowStart && end === state.outlinerWindowEnd) return;
    state.outlinerWindowStart = start;
    state.outlinerWindowEnd = end;
    const windowNode = $('.outliner-virtual-window', outliner);
    if (!windowNode) return;
    windowNode.style.transform = `translateY(${rows[start]?.top || 0}px)`;
    windowNode.innerHTML = rows.slice(start, end).map(({
      node,
      depth,
      container,
      collapsed,
      hasCopyNodes,
      curveNode,
      curveOwner,
      copyNode,
      copyOwner,
      copyModifier,
      nodeIndex,
      groupEnd,
      copyEnd,
      copyOwnerUid,
      groupUid,
      ancestors
    }, localIndex) => {
      if (copyEnd) return `<div class="outliner-group-end copy-node-end" data-outliner-row-index="${start + localIndex}" style="--group-line-x:${treeLineX(depth)}px">
      ${treeLines(ancestors)}<span class="outliner-tree-line ends-here" style="left:${treeLineX(depth)}px"></span><span class="outliner-group-end-branch"></span>
    </div>`;
      if (groupEnd) return `<div class="outliner-group-end" data-outliner-row-index="${start + localIndex}" data-group-end="${groupUid}" style="--group-line-x:${treeLineX(depth)}px" title="點擊線框選中組；拖到線右側放入組內，左側放到外層">
      ${treeLines(ancestors, { uid: groupUid, depth }, true)}<span class="outliner-group-end-branch" data-group-line-uid="${groupUid}"></span>
    </div>`;
      if (curveNode) {
        const active = state.selectedUid === curveOwner.uid && state.selectedCurveNodeIndex === nodeIndex;
        return `<button class="outliner-item curve-node-row ${active ? 'active' : ''}" data-outliner-row-index="${start + localIndex}" data-uid="${curveOwner.uid}" data-curve-node-index="${nodeIndex}" draggable="false" style="padding-left:${5 + depth * 13}px;--item-indent:${5 + depth * 13}px">
        ${treeLines(ancestors)}
        <span></span><span class="kind curve-node-kind">◆</span><span class="item-name">節點 ${nodeIndex + 1}</span><span></span>
      </button>`;
      }
      if (copyNode) {
        const active = state.selectedUid === copyOwner.uid && state.selectedModifierUid === copyModifier.uid
          && state.selectedModifierNodeUid === node.uid;
        return `<button class="outliner-item curve-node-row ${active ? 'active' : ''}" data-outliner-row-index="${start + localIndex}" data-uid="${copyOwner.uid}" data-copy-node-uid="${node.uid}" data-copy-modifier-uid="${copyModifier.uid}" draggable="false" style="padding-left:${5 + depth * 13}px;--item-indent:${5 + depth * 13}px">
        ${treeLines(ancestors)}<span class="outliner-tree-line" style="left:${treeLineX(depth - 1)}px"></span>
        <span></span><span class="kind curve-node-kind">◆</span><span class="item-name">拷貝節點 ${nodeIndex + 1}</span><span></span>
      </button>`;
      }
      return `<button class="outliner-item ${state.mode === 'paint' ? 'paint-flags' : state.outlinerDetailed ? 'has-details' : ''} ${state.selectedUids.has(node.uid) && state.selectedCurveNodeIndex === null ? 'active' : ''} ${state.outlinerDragUids?.includes(node.uid) ? 'is-dragging' : ''}" data-outliner-row-index="${start + localIndex}" data-uid="${node.uid}" draggable="false" style="padding-left:${5 + depth * 13}px;--item-indent:${5 + depth * 13}px">
      ${treeLines(ancestors, node.type === 'group' ? { uid: node.uid, depth } : null)}
      ${container ? `<span class="outliner-disclosure-hit" data-disclosure="${node.uid}" title="${collapsed ? '展開' : '折疊'}" draggable="false">${openIconMarkup(collapsed ? 'right' : 'down', 'outliner-disclosure')}</span>`
          : hasCopyNodes ? `<span class="outliner-disclosure-hit" data-copy-disclosure="${node.uid}" title="${state.collapsedCopyNodes.has(node.uid) ? '展開拷貝節點' : '折疊拷貝節點'}" draggable="false">${openIconMarkup(state.collapsedCopyNodes.has(node.uid) ? 'right' : 'down', 'outliner-disclosure')}</span>`
            : '<span class="outliner-disclosure-spacer"></span>'}
      <span class="kind">${outlinerKindMarkup(node)}</span>
      <span class="item-name">${escapeHtml(node.name)}</span>${hasCopyNodes && container ? `<span class="outliner-copy-disclosure" data-copy-disclosure="${node.uid}" title="${state.collapsedCopyNodes.has(node.uid) ? '展開拷貝節點' : '折疊拷貝節點'}">${state.collapsedCopyNodes.has(node.uid) ? '▸' : '▾'}</span>` : ''}${outlinerStateMarkup(node)}
    </button>`;
    }).join('');
  }

  function stateIconMarkup(id) {
    return `<svg class="outliner-state-icon" aria-hidden="true"><use href="#${id}"></use></svg>`;
  }

  function nodeAutoUvEnabled(node) {
    if (node.type === 'group') {
      const cubes = state.project.getDescendantElementUids(node.uid)
        .map(uidValue => state.project.getNode(uidValue))
        .filter(child => child?.type === 'cube');
      return cubes.length ? cubes.every(cube => cube.autoUv !== false) : node.autoUv !== false;
    }
    return node.autoUv !== false;
  }

  function isUvCapable(node) {
    return Boolean(node && (node.type === 'cube' || isShapeElement(node) || isBezierElement(node) || node.type === 'group'));
  }

  function nodeUvNormalizedEnabled(node) {
    if (node.type === 'group') {
      const descendants = state.project.getDescendantElementUids(node.uid)
        .map(uidValue => state.project.getNode(uidValue)).filter(isUvCapable);
      return descendants.length ? descendants.every(child => child.uvNormalized !== false) : node.uvNormalized !== false;
    }
    return node.uvNormalized !== false;
  }

  function outlinerFlag(node, key, enabled, onIcon, offIcon, onTitle, offTitle, available = true) {
    return `<span class="outliner-flag ${enabled ? '' : 'is-off'} ${available ? '' : 'unavailable'}" role="button"
      data-node-toggle="${key}" data-node-uid="${node.uid}" title="${enabled ? onTitle : offTitle}">
    ${stateIconMarkup(enabled ? onIcon : offIcon)}
  </span>`;
  }

  function outlinerStateMarkup(node) {
    const visible = outlinerFlag(node, 'visible', node.visible !== false, 'icon-show', 'icon-unshow', '可見', '隱藏');
    if (state.mode === 'paint') return outlinerFlag(node, 'locked', node.locked === true,
      'icon-locked', 'icon-unlocked', '鎖定', '解鎖') + visible;
    if (!state.outlinerDetailed) return visible;
    const autoUvAvailable = isUvCapable(node) && node.uvMode !== 'box';
    return [
      ...(autoUvAvailable ? [outlinerFlag(node, 'autoUv', nodeAutoUvEnabled(node), 'icon-uv-update', 'icon-unuv-update', '自動 UV', '不自動更新 UV', true)] : []),
      outlinerFlag(node, 'uvNormalized', nodeUvNormalizedEnabled(node), 'icon-uv-normalize', 'icon-unuv-normalize', 'UV 歸一化', '保留原 UV 像素', isUvCapable(node)),
      outlinerFlag(node, 'exported', node.exported !== false, 'icon-save', 'icon-unsave', '參與後續格式轉換', '不參與後續格式轉換'),
      outlinerFlag(node, 'locked', node.locked === true, 'icon-locked', 'icon-unlocked', '鎖定', '解鎖'),
      visible
    ].join('');
  }

  function outlinerKindMarkup(node) {
    if (node.type === 'node') return '<span class="outliner-curve-kind" aria-hidden="true">●</span>';
    if (node.type === 'bezier2d' || node.type === 'bezier3d') return `<span class="outliner-curve-kind" aria-hidden="true">⌁${node.type === 'bezier2d' ? '²' : '³'}</span>`;
    if (isShapeElement(node)) {
      const icon = shapeRegistry.get(node.shapeType)?.icon;
      return icon?.startsWith('data:image/')
        ? `<img class="outliner-kind-icon object-icon" alt="" src="${escapeAttribute(icon)}" />`
        : `<svg class="outliner-kind-icon object-icon" aria-hidden="true"><use href="#icon-${icon || 'shape'}"></use></svg>`;
    }
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

  return {
    updateSelectionLabels,
    renderOutliner,
    renderOutlinerWindow,
    stateIconMarkup,
    nodeAutoUvEnabled,
    isUvCapable,
    nodeUvNormalizedEnabled,
    outlinerFlag,
    outlinerStateMarkup,
    outlinerKindMarkup,
    openIconMarkup,
    scheduleOutlinerWindow,
  };
}
