import { bakeProceduralShape } from '../model.js';
import { paintSymmetryRelationCache } from '../paint/symmetry-relations.js';
import { ConfigKey } from '../common/config/app-config.js';
import { insetControlRatio } from './color-picker/math.js';

export function createContextMenuController({
  state, $, outliner, inspector, sceneCanvas, sceneRenderer, inspectorController,
  referenceImages, getDockManager,
  textureInput, palette, paletteRows, configRegistry,
  captureModel, saveModelCapture, copyModelCapture, clearModelCapture,
  cancelKnifeSelection, updateToolOptions, renderScene, toast,
  selectItem, selected, selectedNodeUids, focusSelected, focusSceneOrigin,
  pasteElements, isBezierElement, addCurveNodeAtViewportPoint,
  refreshSelectionUi, snapshot, discardSubdivisionEdits, markDirty, renderAll,
  isProceduralShape, exitSubdivisionEdit, enterSubdivisionEdit,
  renderTextureList, remapNumericFaceTextureReferences, activateProjectTexture,
  renderTexture, rebuildTextureAtlas, noteJournalOperation, addTextureGroup,
  setMode, deleteSelectedPaletteColor, insertPaletteGradientNode,
  renderPalette, ensureColorSpaceCurve, openColorSpaceCurveEditor, addPaletteRow,
  setNodeVisibility, setNodeFlag, renderOutliner, addGroup,
  copySelected, cutSelected, deleteSelected, openIconMarkup, escapeHtml,
  copyTexture, cutTexture, pasteTexture, removeTexture
}) {
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
  const appendItem = (item, target) => {
    if (item.separator) {
      target.insertAdjacentHTML('beforeend', '<div class="context-menu-separator" role="separator"></div>');
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'menuitem';
    if (item.danger) button.classList.add('danger');
    button.innerHTML = `${item.icon ? `<span>${item.icon}</span>` : ''}<span>${escapeHtml(item.label)}</span>`;
    if (item.children?.length) {
      const wrapper = document.createElement('div');
      wrapper.className = 'context-menu-submenu';
      const panel = document.createElement('div');
      panel.className = 'context-menu-submenu-panel';
      panel.hidden = true;
      item.children.forEach(child => appendItem(child, panel));
      const open = () => {
        panel.hidden = false;
        panel.classList.toggle('is-left', wrapper.getBoundingClientRect().right + 160 > window.innerWidth);
      };
      wrapper.addEventListener('pointerenter', open);
      wrapper.addEventListener('pointerleave', () => { panel.hidden = true; });
      button.addEventListener('click', event => { event.stopPropagation(); panel.hidden ? open() : panel.hidden = true; });
      wrapper.append(button, panel);
      target.append(wrapper);
      return;
    }
    button.addEventListener('click', () => {
      closeContextMenu();
      item.action?.();
    });
    target.append(button);
  };
  items.forEach(item => appendItem(item, menu));
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX))}px`;
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY))}px`;
  menu.querySelector('button')?.focus({ preventScroll: true });
}

function setActiveTextureItem(item) {
  if (!item) return;
  const index = state.textureAssets.findIndex(asset => asset._uid === item.dataset.textureUid);
  if (index >= 0 && state.textureAssets[index]._uid !== state.activeTextureUid) activateProjectTexture(index);
}

function showElementContextMenu(event, uidValue, source = null) {
  if (!state.project.getNode(uidValue)) return;
  if (!state.selectedUids.has(uidValue)) selectItem(uidValue);
  const node = state.project.getNode(uidValue);
  if (state.mode === 'paint') {
    const selectedNodes = selectedNodeUids().map(id => state.project.getNode(id)).filter(Boolean);
    const visible = node.visible !== false;
    const locked = node.locked === true;
    showContextMenu(event, { title: selectedNodes.length > 1 ? `已選 ${selectedNodes.length} 項` : node.name, source, items: [
      { icon: '⌖', label: '聚焦此物件', action: focusSelected },
      { icon: visible ? '○' : '◉', label: visible ? '隱藏選中項' : '顯示選中項', action: () => {
        snapshot('core.element.field.visible');
        selectedNodes.forEach(entry => setNodeFlag(entry, 'visible', !visible));
        markDirty(); renderAll();
      } },
      { icon: locked ? '◇' : '◆', label: locked ? '解鎖選中項' : '鎖定選中項', action: () => {
        snapshot('core.element.field.locked');
        selectedNodes.forEach(entry => setNodeFlag(entry, 'locked', !locked));
        sceneRenderer.invalidateLockState(); markDirty(); renderAll();
      } }
    ] });
    return;
  }
  const selectedNodes = selectedNodeUids().map(id => state.project.getNode(id)).filter(Boolean);
  const allVisible = selectedNodes.every(entry => entry.visible);
  showContextMenu(event, {
    title: selectedNodes.length > 1 ? `已選 ${selectedNodes.length} 項` : node.name,
    source,
    items: [
      { icon: '⌖', label: '聚焦此物件', action: focusSelected },
      { icon: allVisible ? '○' : '◉', label: allVisible ? '隱藏選中項' : '顯示選中項', action: () => {
        snapshot('core.element.visibility'); selectedNodes.forEach(entry => setNodeVisibility(entry, !allVisible)); markDirty(); renderAll();
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
      ...(isProceduralShape(node) && state.mode !== 'paint' ? [{
        icon: inspectorController.subdivisionSession?.ownerUid === node.uid ? '◆' : '◇',
        label: inspectorController.subdivisionSession?.ownerUid === node.uid ? '完成細分編輯' : '進入細分編輯',
        action: () => inspectorController.subdivisionSession?.ownerUid === node.uid ? exitSubdivisionEdit() : enterSubdivisionEdit(node)
      }] : []),
      ...(isProceduralShape(node) ? [{
        icon: '▣', label: '烘焙為 Cube 組', action: () => {
          if (inspectorController.subdivisionSession?.ownerUid === node.uid) exitSubdivisionEdit(false);
          const generated = node.toCubes();
          if (!generated.length) return toast('這個 Shape 沒有可烘焙的 Cube');
          snapshot('core.shape.bake');
          const result = bakeProceduralShape(state.project, node.uid, generated);
          if (!result) return toast('這個 Shape 沒有可烘焙的 Cube');
          result.group.operators.forEach(operator => paintSymmetryRelationCache.delete(operator.uid));
          state.selectedUid = result.group.uid;
          state.selectedUids = new Set([result.group.uid]);
          state.selectionAnchorUid = result.group.uid;
          state.selectedGenerated = null;
          state.selectedCurveNodeIndex = null;
          state.selectedModifierUid = null;
          state.selectedUvFaces = new Set();
          sceneRenderer.invalidateMirrorGeometry();
          sceneRenderer.invalidateLockState();
          markDirty(); renderAll();
          toast(`已烘焙為 ${result.cubes.length} 個 Cube`);
        }
      }] : []),
      ...(node.subdivisionOwnerUid ? [{ icon: '◆', label: '完成細分編輯', action: () => exitSubdivisionEdit() }] : []),
      { separator: true },
      { icon: '□', label: '複製　Ctrl+C', action: copySelected },
      { icon: '✂', label: '剪切　Ctrl+X', action: cutSelected },
      { icon: '▣', label: '貼上　Ctrl+V', action: () => pasteElements() },
      { icon: '⧉', label: '複製元素　Ctrl+D', action: () => pasteElements({ inPlace: true }) },
      ...(node.subdivisionOwnerUid ? [] : [
        { separator: true },
        { icon: '×', label: '刪除選中項', danger: true, action: deleteSelected }
      ])
    ]
  });
}

function bindContextMenus() {
  const captureItem = () => ({ icon: '▣', label: '截屏模型', children: [
    { icon: '▢', label: '屏幕截圖', action: () => captureModel('screen') },
    { icon: '▣', label: '離屏渲染', action: () => captureModel('offscreen') }
  ] });
  $('#viewport').addEventListener('contextmenu', event => {
    if (referenceImages.editing && event.target.closest('#referenceImageLayer')) {
      const image = referenceImages.referenceImageAt(event.clientX, event.clientY);
      if (!image) {
        event.preventDefault();
        event.stopPropagation();
        closeContextMenu();
        referenceImages.setReferenceImageEditing(false);
        return;
      }
      const uid = image.dataset.referenceUid;
      referenceImages.selectReference(uid);
      const records = referenceImages.referenceImagesForView();
      const index = records.findIndex(record => record.uid === uid);
      showContextMenu(event, { title: records[index]?.name || '參考圖', source: image, items: [
        { icon: '↑', label: '上移一層', action: () => referenceImages.reorderReferenceImage(uid, 'up') },
        { icon: '↓', label: '下移一層', action: () => referenceImages.reorderReferenceImage(uid, 'down') },
        { icon: '⇧', label: '置於頂層', action: () => referenceImages.reorderReferenceImage(uid, 'top') },
        { icon: '⇩', label: '置於底層', action: () => referenceImages.reorderReferenceImage(uid, 'bottom') },
        { separator: true },
        { icon: '×', label: '移除參考圖', danger: true, action: () => referenceImages.removeReferenceImage(uid) }
      ] });
      return;
    }
    if (state.mode === 'paint') {
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu();
      const rect = sceneCanvas.getBoundingClientRect();
      const hit = sceneRenderer.pickDetailed(state.project, event.clientX - rect.left, event.clientY - rect.top,
        state.geometryOnly, { includeGenerated: !state.modifierResultGhost });
      if (hit?.uid && state.project.getNode(hit.uid)) {
        getDockManager()?.expand('outliner');
        selectItem(hit.uid, { revealInOutliner: true });
      }
      return;
    }
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
    const hit = sceneRenderer.pickDetailed(state.project, event.clientX - rect.left, event.clientY - rect.top,
      state.geometryOnly, { includeGenerated: !state.modifierResultGhost });
    if (hit?.generated) {
      showContextMenu(event, { title: '修改器結果 · 唯讀', items: [
        { icon: '⌖', label: '選擇來源物件', action: () => selectItem(hit.uid, { revealInOutliner: true }) }
      ] });
      return;
    }
    const hitUid = hit?.uid;
    if (hitUid) {
      showElementContextMenu(event, hitUid);
      return;
    }
    const activeCurve = selected();
    if (isBezierElement(activeCurve) && Number.isInteger(state.selectedCurveNodeIndex)) {
      event.preventDefault();
      event.stopPropagation();
      addCurveNodeAtViewportPoint(activeCurve, event, rect);
      return;
    }
    showContextMenu(event, {
      title: selected()?.name || state.project.name,
      items: [
        { icon: '⌖', label: '聚焦選中物件', action: focusSelected },
        { icon: '◎', label: '回到場景中心', action: focusSceneOrigin },
        { separator: true },
        { icon: '▣', label: '貼上　Ctrl+V', action: () => pasteElements() },
        ...(selectedNodeUids().length ? [{ icon: '⧉', label: '複製元素　Ctrl+D', action: () => pasteElements({ inPlace: true }) }] : []),
        { separator: true },
        captureItem(),
        { icon: '#', label: state.grid ? '隱藏參考網格' : '顯示參考網格', action: () => configRegistry.set(ConfigKey.SHOW_GRID, !state.grid, { source: 'viewport-context-menu' }) },
        { icon: '◐', label: '切換背景（純黑／目前／棋盤格）', action: () => {
          const modes = ['black', 'current', 'grid'];
          configRegistry.set(ConfigKey.BACKGROUND_MODE, modes[(modes.indexOf(state.backgroundMode) + 1) % modes.length], { source: 'viewport-context-menu' });
        } },
        { icon: '▧', label: state.wire ? '隱藏邊界線框' : '顯示邊界線框', action: () => configRegistry.set(ConfigKey.SHOW_WIREFRAME, !state.wire, { source: 'viewport-context-menu' }) }
      ]
    });
  });
  outliner.addEventListener('contextmenu', event => {
    if (state.mode === 'paint') {
      const row = event.target.closest('.outliner-item');
      if (row) showElementContextMenu(event, row.dataset.uid, row);
      else showContextMenu(event, { title: state.project.name, source: outliner, items: [
        { icon: '⌖', label: '聚焦選中物件', action: focusSelected }
      ] });
      return;
    }
    const item = event.target.closest('.outliner-item');
    if (!item) {
      showContextMenu(event, { title: state.project.name, source: outliner, items: [
        { icon: '▣', label: '貼上　Ctrl+V', action: () => pasteElements() },
        ...(selectedNodeUids().length ? [{ icon: '⧉', label: '複製元素　Ctrl+D', action: () => pasteElements({ inPlace: true }) }] : [])
      ] });
      return;
    }
    if (item.dataset.curveNodeIndex !== undefined) {
      const curve = state.project.getNode(item.dataset.uid);
      const index = Number(item.dataset.curveNodeIndex);
      if (!isBezierElement(curve) || !curve.nodes[index]) return;
      state.selectedUid = curve.uid;
      state.selectedUids = new Set([curve.uid]);
      state.selectionAnchorUid = curve.uid;
      state.selectedModifierUid = null;
      state.selectedCurveNodeIndex = index;
      refreshSelectionUi();
      showContextMenu(event, { title: `節點 ${index + 1}`, source: item, items: [
        { icon: '×', label: '刪除節點', danger: true, action: () => {
          if (curve.nodes.length <= 2) return toast('曲線至少需要兩個節點');
          snapshot('core.curve.node_remove'); discardSubdivisionEdits(curve); curve.nodes.splice(index, 1);
          state.selectedCurveNodeIndex = Math.min(index, curve.nodes.length - 1);
          markDirty(); renderAll('selection');
        } }
      ] });
      return;
    }
    const uidValue = item.dataset.uid;
    const source = outliner.querySelector(`[data-uid="${uidValue}"]`);
    showElementContextMenu(event, uidValue, source);
  });
  outliner.addEventListener('dblclick', event => {
    if (state.mode === 'paint') return;
    const row = event.target.closest('.outliner-item');
    if (row?.dataset.curveNodeIndex !== undefined) return;
    const node = row && state.project.getNode(row.dataset.uid);
    if (!isProceduralShape(node)) return;
    event.preventDefault();
    inspectorController.subdivisionSession?.ownerUid === node.uid ? exitSubdivisionEdit() : enterSubdivisionEdit(node);
  });
  $('#viewport').addEventListener('dblclick', event => {
    if (state.mode === 'paint') return;
    if (event.target !== sceneCanvas) return;
    const rect = sceneCanvas.getBoundingClientRect();
    const selectedHit = sceneRenderer.pickDetailed(state.project,
      event.clientX - rect.left, event.clientY - rect.top, state.geometryOnly,
      { includeGenerated: !state.modifierResultGhost });
    if (selectedHit?.generated) return;
    const uidValue = selectedHit?.uid;
    if (!uidValue) {
      if (!inspectorController.subdivisionSession) return;
      event.preventDefault();
      exitSubdivisionEdit();
      return;
    }
    const node = uidValue && state.project.getNode(uidValue);
    if (!isProceduralShape(node)) return;
    event.preventDefault();
    enterSubdivisionEdit(node);
  });
  $('#textureList').addEventListener('contextmenu', event => {
    const item = event.target.closest('.texture-item');
    const groupNode = event.target.closest('.texture-group');
    if (item) setActiveTextureItem(item);
    if (item) {
      const asset = state.textureAssets.find(entry => entry._uid === item.dataset.textureUid);
      return showContextMenu(event, { title: asset?.name || '貼圖', source: item, items: [
        { icon: '◉', label: '設為目前貼圖', action: () => setActiveTextureItem(item) },
        { icon: '▣', label: '複製貼圖', action: () => copyTexture(asset) },
        { icon: '✂', label: '剪切貼圖', action: () => cutTexture(asset) },
        { icon: '▤', label: '貼上貼圖', action: () => pasteTexture() },
        { icon: '⧉', label: '原地複製貼圖', action: () => pasteTexture({ inPlace: true }) },
        { icon: '▰', label: '移到新貼圖組', action: addTextureGroup },
        { separator: true },
        { icon: '×', label: '刪除貼圖', danger: true, action: () => removeTexture(asset) }
      ] });
    }
    if (groupNode) {
      const group = state.textureGroups.find(entry => entry.id === groupNode.dataset.textureGroup);
      return showContextMenu(event, { title: group?.name || '貼圖組', source: groupNode, items: [
        { icon: openIconMarkup(group?.collapsed ? 'down' : 'up', 'context-open-icon'), label: group?.collapsed ? '展開組' : '折疊組', action: () => { group.collapsed = !group.collapsed; renderTextureList(); } },
        { icon: '×', label: '解散貼圖組', action: () => {
          noteJournalOperation('core.texture.group');
          state.textureAssets.forEach(asset => { if (asset.groupId === group.id) asset.groupId = null; });
          state.textureGroups = state.textureGroups.filter(entry => entry.id !== group.id); renderTextureList(); markDirty();
        } }
      ] });
    }
    showContextMenu(event, { title: '貼圖列表', source: $('#textureList'), items: [
      { icon: '▤', label: '貼上貼圖', action: () => pasteTexture() }
    ] });
  });
  $('#texturePreview').addEventListener('contextmenu', event => showContextMenu(event, { title: '貼圖預覽', source: $('#texturePreview'), items: [
    { icon: '◒', label: '在繪畫模式打開', action: () => setMode('paint') },
    { icon: '＋', label: '導入新貼圖', action: () => textureInput.click() }
  ] }));
  $('#paletteRows').addEventListener('contextmenu', event => {
    if (palette.compact) { event.preventDefault(); return; }
    const rowNode = event.target.closest('.palette-row-card');
    if (!rowNode) return;
    const index = paletteRows.findIndex(row => row.id === rowNode.dataset.paletteId);
    const row = paletteRows[index];
    const swatch = event.target.closest('.swatch-item, .gradient-node-head');
    const gradientBar = event.target.closest('.gradient-picker');
    const barRect = gradientBar?.getBoundingClientRect();
    const barRatio = barRect ? insetControlRatio(event.clientX, barRect.left, barRect.width) : .5;
    if (swatch) {
      palette.selectedRowId = row.id;
      palette.selectedColorIndex = Number(swatch.dataset.paletteColorIndex ?? swatch.dataset.gradientNode);
    }
    showContextMenu(event, { title: row.name, source: rowNode, items: [
      ...(swatch ? [{ icon: '×', label: '刪除顏色', action: () => {
        deleteSelectedPaletteColor(row.id, Number(swatch.dataset.paletteColorIndex ?? swatch.dataset.gradientNode));
      } }] : []),
      ...(gradientBar && !swatch ? [{ icon: '＋', label: '在此新增漸變節點', action: () => insertPaletteGradientNode(row, barRatio) }] : []),
      { icon: '◫', label: row.gradient ? '改用離散色卡' : '啟用連續漸變', action: () => { row.gradient = !row.gradient; renderPalette(); } },
      { icon: '⌁', label: row.colorSpaceGradient ? '關閉色彩空間漸變' : '啟用色彩空間漸變', action: () => {
        row.colorSpaceGradient = !row.colorSpaceGradient;
        if (row.colorSpaceGradient) ensureColorSpaceCurve(row);
        renderPalette();
      } },
      ...(row.colorSpaceGradient ? [{ icon: '◇', label: '編輯色彩曲線', action: () => openColorSpaceCurveEditor(row) }] : []),
      { icon: '＋', label: '新增色卡行', action: addPaletteRow }
    ] });
  });
  $('#paletteRows').addEventListener('pointerdown', () => $('#paletteRows').focus({ preventScroll: true }), true);
  document.addEventListener('pointerdown', event => {
    const rows = $('#paletteRows');
    if (!event.target.closest('#bottomDock') && document.activeElement === rows) rows.blur();
  }, true);
  inspector.addEventListener('contextmenu', event => {
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const item = selected();
    if (!item) return;
    showContextMenu(event, { title: item.name, source: event.target.closest('.field-section'), items: [
      { icon: '⌖', label: '聚焦此物件', action: focusSelected },
      { icon: item.visible ? '◉' : '○', label: item.visible ? '隱藏' : '顯示', action: () => { snapshot('core.element.visibility'); setNodeVisibility(item, !item.visible); markDirty(); renderAll(); } }
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
  $('#modelCaptureSave').addEventListener('click', saveModelCapture);
  $('#modelCaptureCopy').addEventListener('click', copyModelCapture);
  $('#modelCaptureDialog').addEventListener('close', () => {
    $('#modelCaptureImage').removeAttribute('src');
    clearModelCapture();
  });
}

return {
  closeContextMenu,
  showContextMenu,
  setActiveTextureItem,
  showElementContextMenu,
  bindContextMenus,
};
}
