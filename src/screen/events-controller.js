import { ConfigKey, configRegistry } from '../common/config/app-config.js';
import { createListDragAutoScroll } from './list-drag-scroll.js';
import { verticalDropTarget } from './vertical-drop.js';
import { Cube, Group, Shape } from '../model.js';
import { shapeRegistry } from '../shapes/builtins.js';

export function createEventBinder({
  state, $, $$, viewport, sceneCanvas, sceneRenderer, uvPreviewCanvas,
  uvPreviewViewport, uvPreviewRenderer, uvPreviewController, uvEditorController,
  outliner, outlinerDragController, inspectorController, palette, fileInput,
  textureInput, playerReferenceTextureInput, referenceImageInput,
  referenceImageLayer, referenceImages, languageSelect, themeDialog,
  projectInfoDialog, projectTabsController, projectTabsNode,
  getDockManager, getTexturePaintDrag, reloadShapePacks, clearLockedHoverCapture,
  openColorPickerPopup, closeProjectTab, activateProjectTab, openProjectInfo,
  projectTabInsertionIndex, previewProjectTabInsertion, moveProjectTabToIndex,
  applyProjectInfo, setReferenceImageMenu, beginReferenceImageImport,
  setReferenceImageEditing, resetReferenceImage, removeReferenceImage,
  loadReferenceImageFiles, beginReferenceImageDrag, moveReferenceImageDrag,
  endReferenceImageDrag, scaleReferenceImage, createTextureTemplate,
  addPaletteRow, renderPalette, enterAxisView, beginAxisWidgetDrag,
  moveAxisWidgetDrag, endAxisWidgetDrag, restore, cancelCameraFocus,
  deleteSelectedPaletteColor, refreshKnifeFromModifierEvent,
  activateDock, addBezierElement, addCube, addGroup, addLocator, addShape,
  addTextureGroup, animateLockedHoverStrength, applyPreset,
  beginTemporaryEyedropper, bindContextMenus, bindTextureFaceDropSurface,
  cameraController, clamp, clearOutlinerDropState,
  clearPaintGradientSelection, clearSelection, clearTextureFaceDropTarget,
  copySelected, copyTexture, createOutlinerDragGhost, createSimpleTexture, cutSelected, cutTexture,
  cycleSnap, deleteSelected, editSelectedUvFace, endPointerDrag,
  endTemporaryEyedropper, endTexturePointer, exitSubdivisionEdit,
  exportProject, focusSelected, focusSceneOrigin, focusSelectedTextureUvs, getUvPreviewProject,
  importPlayerReferenceTexture, importTexture, inspectorBatchNodes,
  invalidateSelectionRenderGeometry, isBezierElement, isEffectivelyLocked,
  loadProjectContent, markDirty, moveSelectedNodes, newProject,
  nodeAutoUvEnabled, nodeUvNormalizedEnabled, noteJournalOperation,
  onPointerDown, onPointerMove, onScenePointerMove, onTexturePointerMove,
  openNewProjectDialog, openPreciseRotationInput, openProject,
  openTextureCreateDialog, pasteElements, pasteTexture, playTimeline,
  rebuildTextureAtlas, redo, refreshSelectionUi, refreshUvPreview,
  remapNumericFaceTextureReferences, removeOutlinerDragGhost,
  renderAll, renderInspector, renderOutliner, renderOutlinerWindow,
  renderPaintGradientPreview, renderScene, renderTextureList, removeTexture, removeActiveLayer,
  renderTextureUvOverlay, renderUvPreview, resetTextureView,
  resolveGizmoHandle, round, saveProject, scheduleLockedHover,
  scheduleOutlinerWindow, scheduleSceneRender, scheduleTextureAnimation,
  selected, selectAllElements, selectItem, selectPaintGradientStop, setActiveTextureItem,
  setConfigFromControl, setDockHotspotFocus, setMode, setNodeFlag,
  setRenderModeMenu, setThemeVar, setTool, setUvCoordinate, snapshot,
  startCameraDrag, startTexturePointer, startTransformDrag, stopTimeline,
  stopUvPreviewAnimation, syncTexturePreviewPriority, textureUid,
  textureUvEntries, toast, topLevelSelectedUids, undo,
  updateFaceSelectionOverlay, updateGizmoDepthHover,
  updateMultiTransformModeButtons, updateRenderModeControl,
  updateRotationModeButtons, updateScaleHandleModeButtons,
  updateSelectionLabels, updateTextureCreateDialog,
  updateTextureStageTransform, updateToolOptions, useVertexSnapPoint,
  updateTransformGizmo, movePivotToRotationVertex,
  centerSelectedPivots,
  uvFaceKey, uvPreviewElements, uvPreviewIsActive, wheelTextureView
}) {
let recentRotationPress = null;
let pendingRotationPress = null;
let externalDropQueue = Promise.resolve();
const droppedFileExtension = file => String(file.name || '').split('.').at(-1)?.toLowerCase() || '';
async function isPngFile(file) {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return header.length === 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
}
function choosePngDestination(file) {
  const dialog = $('#droppedPngDialog');
  $('#droppedPngName').textContent = file.name;
  dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
  });
}
async function handleExternalFiles(files) {
  for (const file of files) {
    const extension = droppedFileExtension(file);
    if (['cbmodel', 'bbmodel', 'json'].includes(extension)) {
      if (window.cubeBricksDesktop?.getPathForFile) {
        const filePath = window.cubeBricksDesktop.getPathForFile(file);
        if (!filePath) throw new Error(`無法取得 ${file.name} 的本機路徑`);
        await openProject(filePath);
      } else if (extension !== 'cbmodel') loadProjectContent(await file.text(), file.name);
      else toast('.cbmodel 需要在桌面版打開');
      continue;
    }
    const isReference = file.type?.startsWith('image/')
      || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(extension);
    if (!isReference) { toast(`不支援拖入 ${file.name}`); continue; }
    if (!projectTabsController.activeId) { toast('請先打開或建立項目，再導入圖片'); continue; }
    const isPng = extension === 'png' && await isPngFile(file);
    const choice = isPng ? await choosePngDestination(file) : 'reference';
    if (choice === 'texture') importTexture(file);
    else if (choice === 'reference') await loadReferenceImageFiles([file], referenceImages.referenceViewKey());
  }
}
function bindEvents() {
  document.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, true);
  document.addEventListener('drop', event => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    event.stopPropagation();
    const files = [...event.dataTransfer.files];
    externalDropQueue = externalDropQueue.catch(() => {}).then(() => handleExternalFiles(files))
      .catch(error => toast(`拖入文件失敗：${error.message}`));
  }, true);
  const textureList = $('#textureList');
  const outlinerDragScroll = createListDragAutoScroll(outliner, () => Boolean(state.outlinerDragUids?.length), pointer => {
    renderOutlinerWindow();
    if (pointer) updateOutlinerDropTarget(pointer.y, pointer.x);
  });
  const textureDragScroll = createListDragAutoScroll(textureList, () => Boolean(state.textureDrag), pointer => {
    if (pointer) updateTextureDropTarget(pointer.y);
  });
  const paletteDragScroll = createListDragAutoScroll($('#paletteRows'), () => Boolean(palette.draggedColor));
  function highlightOutlinerGroupLine(groupUid, targetIndex, endpointY) {
    if (!groupUid) return;
    const rows = state.outlinerRows || [];
    const origin = rows.findIndex(row => row.node?.uid === groupUid);
    if (origin < 0) return;
    outliner.querySelectorAll('.outliner-tree-line[data-group-line-uid]').forEach(line => {
      if (line.dataset.groupLineUid !== groupUid) return;
      const index = Number(line.closest('[data-outliner-row-index]')?.dataset.outlinerRowIndex);
      if (!Number.isInteger(index) || index < origin || index > targetIndex) return;
      line.classList.add('drop-highlight');
      if (index === targetIndex) {
        const ownFooterBottom = line.classList.contains('ends-here') ? 7 : 0;
        line.style.setProperty('--highlight-bottom', `${Math.max(0, rows[index].height - endpointY - ownFooterBottom)}px`);
      }
    });
  }
  function updateOutlinerDropTarget(clientY, clientX) {
    clearOutlinerDropState({ keepDragging: true });
    const rows = state.outlinerRows || [];
    const listBounds = outliner.getBoundingClientRect();
    const contentY = clientY < listBounds.top ? -1
      : clientY > listBounds.bottom ? Infinity
        : clientY - listBounds.top + outliner.scrollTop;
    const picked = verticalDropTarget(rows, contentY);
    if (!picked || contentY >= rows.at(-1).top + rows.at(-1).height) {
      outliner.querySelector('.outliner-root-tail')?.classList.add('drop-root');
      return { uid: null, zone: 'after' };
    }
    let { entry: row, index: rowIndex } = picked;
    if (row.curveNode) {
      while (rowIndex > 0 && rows[rowIndex].curveNode) rowIndex--;
      row = rows[rowIndex];
    }
    const footer = outliner.querySelector(`.outliner-group-end[data-outliner-row-index="${rowIndex}"]`);
    if (row.groupEnd) {
      const chain = [...row.ancestors, { uid: row.groupUid, depth: row.depth }];
      const outside = chain.find(({ depth }) => clientX <= listBounds.left + 16 + depth * 13 + 4);
      const destination = outside || chain.at(-1);
      const zone = outside ? 'after' : 'inside';
      if (footer) {
        footer.dataset.dropUid = destination.uid;
        footer.dataset.dropZone = zone;
        footer.style.setProperty('--drop-line-x', `${16 + destination.depth * 13}px`);
        footer.classList.add(`drop-${zone}`);
        highlightOutlinerGroupLine(destination.uid, rowIndex, 8);
      }
      return { uid: destination.uid, zone };
    }
    const item = outliner.querySelector(`.outliner-item[data-outliner-row-index="${rowIndex}"]`);
    const node = row.node;
    const ratio = picked.entry === row ? picked.ratio : 1;
    const zone = node?.type === 'group' && ratio > .27 && ratio < .73 ? 'inside' : ratio < .5 ? 'before' : 'after';
    const groupLine = zone === 'inside' && node?.type === 'group'
      ? { uid: node.uid, depth: row?.depth || 0 }
      : row?.ancestors.at(-1);
    if (groupLine) {
      item?.style.setProperty('--drop-line-x', `${16 + groupLine.depth * 13}px`);
      if (item) highlightOutlinerGroupLine(groupLine.uid, rowIndex, zone === 'before' ? 0 : 31);
    }
    item?.classList.add(`drop-${zone}`);
    if (item) item.dataset.dropZone = zone;
    return { uid: node.uid, zone };
  }
  function updateTextureDropTarget(clientY) {
    textureList.querySelectorAll('.drop-before,.drop-after,.drop-inside').forEach(node => node.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    const rows = [...textureList.querySelectorAll(state.textureDrag?.type === 'group'
      ? '.texture-group-header' : '.texture-item,.texture-group-header')]
      .filter(node => node.getClientRects().length);
    const picked = verticalDropTarget(rows, clientY);
    if (!picked) return null;
    const item = picked.entry.classList.contains('texture-item') ? picked.entry : null;
    const group = item ? null : picked.entry.closest('.texture-group');
    const firstBounds = rows[0].getBoundingClientRect();
    const lastBounds = rows.at(-1).getBoundingClientRect();
    const rootEdge = state.textureDrag?.type === 'asset' && group
      ? clientY < firstBounds.top ? 'start' : clientY >= lastBounds.bottom ? 'end' : null
      : null;
    if (item && state.textureDrag?.type === 'asset') {
      item.classList.add(`drop-${picked.position}`);
      item.dataset.dropZone = picked.position;
    } else if (group) group.classList.add(state.textureDrag?.type === 'group' || rootEdge
      ? `drop-${picked.position}` : 'drop-inside');
    return { item, group, position: picked.position, rootEdge };
  }
  document.addEventListener('drop', () => {
    outlinerDragScroll.stop(); textureDragScroll.stop(); paletteDragScroll.stop();
    queueMicrotask(() => {
      if (state.outlinerDragUids?.length) {
        clearOutlinerDropState(); removeOutlinerDragGhost(); state.outlinerDragUids = null;
      }
      if (state.textureDrag) { state.textureDrag = null; clearTextureFaceDropTarget(); renderTextureList(); }
      palette.draggedColor = null;
    });
  }, true);
  document.addEventListener('dragend', () => {
    outlinerDragScroll.stop(); textureDragScroll.stop(); paletteDragScroll.stop();
    clearOutlinerDropState(); removeOutlinerDragGhost(); state.outlinerDragUids = null;
    if (state.textureDrag) {
      state.textureDrag = null;
      clearTextureFaceDropTarget();
      textureList.querySelectorAll('.is-dragging,.drop-before,.drop-after,.drop-inside').forEach(node =>
        node.classList.remove('is-dragging', 'drop-before', 'drop-after', 'drop-inside'));
    }
    palette.draggedColor = null;
  }, true);
  document.addEventListener('click', event => {
    const input = event.target.closest('input[type="color"]');
    if (!input || input.disabled) return;
    event.preventDefault();
    openColorPickerPopup(input.value, color => { input.value = color; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  });
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
  projectTabsNode.addEventListener('click', event => {
    const close = event.target.closest('[data-close-project-tab]');
    if (close) {
      event.stopPropagation();
      closeProjectTab(close.dataset.closeProjectTab);
      return;
    }
    const tab = event.target.closest('[data-project-tab]');
    if (tab) activateProjectTab(tab.dataset.projectTab);
  });
  projectTabsNode.addEventListener('auxclick', event => {
    if (event.button !== 1) return;
    const tab = event.target.closest('[data-project-tab]');
    if (!tab) return;
    event.preventDefault();
    closeProjectTab(tab.dataset.projectTab);
  });
  projectTabsNode.addEventListener('contextmenu', event => {
    const tab = event.target.closest('[data-project-tab]');
    if (!tab) return;
    event.preventDefault();
    event.stopPropagation();
    openProjectInfo(tab.dataset.projectTab);
  });
  projectTabsNode.addEventListener('keydown', event => {
    const tab = event.target.closest('[data-project-tab]');
    if (tab && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      activateProjectTab(tab.dataset.projectTab);
    }
  });
  projectTabsNode.addEventListener('dragstart', event => {
    const tab = event.target.closest('[data-project-tab]');
    if (!tab || event.target.closest('[data-close-project-tab]')) { event.preventDefault(); return; }
    projectTabsController.draggingTabId = tab.dataset.projectTab;
    projectTabsController.draggingInsertIndex = projectTabInsertionIndex(event.clientX, projectTabsController.draggingTabId);
    tab.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/x-cubebricks-project-tab', projectTabsController.draggingTabId);
  });
  projectTabsNode.addEventListener('dragover', event => {
    if (!projectTabsController.draggingTabId) return;
    event.preventDefault();
    projectTabsController.draggingInsertIndex = projectTabInsertionIndex(event.clientX);
    previewProjectTabInsertion(projectTabsController.draggingInsertIndex);
  });
  projectTabsNode.addEventListener('drop', event => {
    if (!projectTabsController.draggingTabId) return;
    event.preventDefault();
    projectTabsController.draggingInsertIndex = projectTabInsertionIndex(event.clientX);
    moveProjectTabToIndex(projectTabsController.draggingTabId, projectTabsController.draggingInsertIndex);
    projectTabsController.draggingTabId = null;
    projectTabsController.draggingInsertIndex = null;
  });
  projectTabsNode.addEventListener('dragend', event => {
    if (projectTabsController.draggingTabId) {
      moveProjectTabToIndex(projectTabsController.draggingTabId, projectTabInsertionIndex(event.clientX));
    }
    projectTabsController.draggingTabId = null;
    projectTabsController.draggingInsertIndex = null;
    projectTabsNode.querySelectorAll('.is-dragging,.drop-before,.drop-after').forEach(node => node.classList.remove('is-dragging', 'drop-before', 'drop-after'));
  });
  $('#newProjectTab').addEventListener('click', openNewProjectDialog);
  $('#projectInfoForm').addEventListener('submit', event => {
    event.preventDefault();
    applyProjectInfo();
  });
  $$('[data-action="closeProjectInfo"]').forEach(button => button.addEventListener('click', () => {
    projectInfoDialog.close();
    projectTabsController.editingTabId = null;
  }));
  $$('.mode-tab').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $$('.tool[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
  const shapeButton = $('#paintShapeButton'), shapeModeButton = $('#paintShapeModeButton'), shapeMenu = $('#paintShapeMenu');
  shapeButton.addEventListener('click', () => setTool(state.paintShapeTool || 'line'));
  const placePaintMenu = (menu, anchor) => {
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 150)}px`;
    menu.style.top = `${Math.min(rect.bottom + 5, window.innerHeight - 135)}px`;
  };
  shapeModeButton.addEventListener('click', event => {
    event.stopPropagation(); shapeMenu.hidden = !shapeMenu.hidden;
    if (!shapeMenu.hidden) placePaintMenu(shapeMenu, shapeModeButton);
    shapeModeButton.setAttribute('aria-expanded', String(!shapeMenu.hidden));
  });
  $$('[data-paint-shape]').forEach(button => button.addEventListener('click', () => {
    state.paintShapeTool = button.dataset.paintShape;
    setTool(state.paintShapeTool);
    shapeMenu.hidden = true; shapeModeButton.setAttribute('aria-expanded', 'false');
  }));
  const selectionModeButton = $('#paintSelectionModeButton'), selectionModeMenu = $('#paintSelectionModeMenu');
  selectionModeButton.addEventListener('click', event => {
    event.stopPropagation(); selectionModeMenu.hidden = !selectionModeMenu.hidden;
    if (!selectionModeMenu.hidden) placePaintMenu(selectionModeMenu, selectionModeButton);
    selectionModeButton.setAttribute('aria-expanded', String(!selectionModeMenu.hidden));
  });
  $$('[data-paint-selection-mode]').forEach(button => button.addEventListener('click', () => {
    const select = $('#paintSelectionMode'); select.value = button.dataset.paintSelectionMode;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    selectionModeMenu.hidden = true; selectionModeButton.setAttribute('aria-expanded', 'false');
  }));
  document.addEventListener('click', event => {
    if (!event.target.closest('#paintShapeModeControl')) { shapeMenu.hidden = true; shapeModeButton.setAttribute('aria-expanded', 'false'); }
    if (!event.target.closest('#paintSelectionModeControl')) { selectionModeMenu.hidden = true; selectionModeButton.setAttribute('aria-expanded', 'false'); }
  });
  $$('.dock-tab').forEach(button => button.addEventListener('click', () => activateDock(button.dataset.dock)));
  $('[data-action="addCube"]').addEventListener('click', addCube);
  const shapeCreateButton = $('[data-action="toggleShapeCreate"]');
  const shapeCreateMenu = $('#shapeCreateMenu');
  const closeShapeCreateMenu = () => {
    shapeCreateMenu.hidden = true;
    shapeCreateButton.setAttribute('aria-expanded', 'false');
  };
  shapeCreateButton.addEventListener('click', event => {
    event.stopPropagation();
    if (!shapeCreateMenu.hidden) return closeShapeCreateMenu();
    const rect = shapeCreateButton.getBoundingClientRect();
    shapeCreateMenu.hidden = false;
    const menuRect = shapeCreateMenu.getBoundingClientRect();
    shapeCreateMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, rect.right - menuRect.width))}px`;
    shapeCreateMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - menuRect.height - 8, rect.bottom + 5))}px`;
    shapeCreateButton.setAttribute('aria-expanded', 'true');
  });
  shapeCreateMenu.addEventListener('click', event => {
    event.stopPropagation();
    const option = event.target.closest('[data-create-shape]');
    if (!option) return;
    closeShapeCreateMenu();
    if (shapeRegistry.has(option.dataset.createShape) && !['bezier2d', 'bezier3d'].includes(option.dataset.createShape)) addShape(option.dataset.createShape);
    if (option.dataset.createShape === 'bezier2d') addBezierElement(2);
    if (option.dataset.createShape === 'bezier3d') addBezierElement(3);
    if (option.dataset.createShape === 'bezier2d-envelope') addBezierElement(2, 'envelope');
    if (option.dataset.createShape === 'bezier3d-envelope') addBezierElement(3, 'envelope');
  });
  document.addEventListener('click', closeShapeCreateMenu);
  $('[data-action="addLocator"]').addEventListener('click', addLocator);
  $('[data-action="addGroup"]').addEventListener('click', addGroup);
  $('.outliner-create-actions [data-action="deleteSelected"]').addEventListener('click', deleteSelected);
  $('[data-action="new"]').addEventListener('click', openNewProjectDialog);
  $('#modelFormatList').addEventListener('click', event => {
    const card = event.target.closest('[data-model-format]');
    if (card) newProject(card.dataset.modelFormat);
  });
  $('[data-action="open"]').addEventListener('click', openProject);
  $('[data-action="save"]').addEventListener('click', () => saveProject(false));
  $('[data-action="export"]').addEventListener('click', exportProject);
  $('[data-action="undo"]').addEventListener('click', undo);
  $('[data-action="redo"]').addEventListener('click', redo);
  $('[data-action="theme"]').addEventListener('click', async () => {
    themeDialog.showModal();
    const label = $('#projectWorkspaceDirectory');
    if (window.cubeBricksDesktop?.projectWorkspaceRoot) label.textContent = await window.cubeBricksDesktop.projectWorkspaceRoot();
    else label.textContent = '瀏覽器預覽不使用展開式工作目錄';
  });
  $('[data-action="chooseProjectWorkspace"]').addEventListener('click', async () => {
    if (!window.cubeBricksDesktop?.chooseProjectWorkspaceRoot) return toast('僅桌面版可更改工作目錄');
    try {
      const directory = await window.cubeBricksDesktop.chooseProjectWorkspaceRoot();
      if (directory) {
        $('#projectWorkspaceDirectory').textContent = directory;
        await reloadShapePacks();
        window.dispatchEvent(new Event('cubebricks:workspace-change'));
        toast('工作空間已切換；新項目使用 projects/，Shape 包從 shapepacks/ 載入');
      }
    } catch (error) { toast(`工作目錄更改失敗：${error.message}`); }
  });
  $$('[data-settings-page]').forEach(button => button.addEventListener('click', () => {
    $$('[data-settings-page]').forEach(entry => entry.classList.toggle('active', entry === button));
    $$('[data-settings-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.settingsPanel === button.dataset.settingsPage));
  }));
  languageSelect.addEventListener('change', event => {
    configRegistry.set(ConfigKey.LANGUAGE, event.target.value, { source: 'appearance-dialog' });
  });
  $$('[data-config-key]').forEach(control => {
    control.addEventListener('change', () => setConfigFromControl(control));
    if (control.type === 'number') control.addEventListener('input', () => {
      // A partial history-limit number must not immediately delete undo records.
      if (control.dataset.configKey !== ConfigKey.HISTORY_LIMIT && control.value !== '') setConfigFromControl(control);
    });
  });
  $('[data-action="importPlayerReferenceTexture"]').addEventListener('click', () => {
    playerReferenceTextureInput.value = '';
    playerReferenceTextureInput.click();
  });
  $('[data-action="resetPlayerReferenceTexture"]').addEventListener('click', () => {
    configRegistry.reset(ConfigKey.PLAYER_REFERENCE_TEXTURE, { source: 'player-reference-settings' });
    toast('已恢復內置玩家紋理');
  });
  playerReferenceTextureInput.addEventListener('change', () => importPlayerReferenceTexture(playerReferenceTextureInput.files?.[0]));
  $('#alphaLockToggle').addEventListener('change', event => configRegistry.set(ConfigKey.ALPHA_LOCK, event.target.checked, { source: 'toolbar' }));
  $('#paintExplodeToggle').addEventListener('change', event => {
    state.paintExplode = event.target.checked;
    renderScene();
  });
  $('#paintPixelGridToggle').addEventListener('change', event => {
    state.paintPixelGrid = event.target.checked;
    renderScene();
  });
  $('#negativeShapeToggle').addEventListener('change', event => configRegistry.set(ConfigKey.ALLOW_NEGATIVE_SIZE, event.target.checked, { source: 'bottom-options' }));
  $('#previewShadeToggle').addEventListener('change', event => configRegistry.set(ConfigKey.PREVIEW_SHADE, event.target.checked, { source: 'toolbar' }));
  $('#playerReferenceToggle').addEventListener('change', event => configRegistry.set(ConfigKey.SHOW_PLAYER_REFERENCE, event.target.checked, { source: 'toolbar' }));
  $('#modifierResultGhostToggle').addEventListener('change', event => configRegistry.set(ConfigKey.MODIFIER_RESULT_GHOST, event.target.checked, { source: 'bottom-options' }));
  $('#uvPreviewEnabled').addEventListener('change', event => {
    state.uvPreviewEnabled = event.target.checked;
    if (!state.uvPreviewEnabled) stopUvPreviewAnimation();
    refreshUvPreview();
  });
  $('#uvPreviewAutoRotate').addEventListener('change', event => {
    state.uvPreviewAutoRotate = event.target.checked;
    if (!state.uvPreviewAutoRotate) stopUvPreviewAnimation();
    refreshUvPreview();
  });
  $('#uvPreviewFaceColors').addEventListener('change', event => {
    state.uvPreviewFaceColors = event.target.checked;
    uvPreviewRenderer.invalidateGeometry();
    renderUvPreview();
  });
  $('#uvPreviewAutoFocusTexture').addEventListener('change', event => {
    state.uvPreviewAutoFocusTexture = event.target.checked;
  });
  $$('[data-uv-face-action]').forEach(button => button.addEventListener('click', () => {
    editSelectedUvFace(button.dataset.uvFaceAction);
  }));
  uvPreviewViewport.addEventListener('pointerdown', event => {
    if (![0, 1].includes(event.button) || !uvPreviewIsActive() || !uvPreviewElements().length) return;
    event.preventDefault();
    uvPreviewController.uvPreviewDrag = {
      pointerId: event.pointerId,
      button: event.button,
      rotates: event.button === 1,
      x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY,
      moved: false
    };
    if (uvPreviewController.uvPreviewDrag.rotates) uvPreviewViewport.classList.add('is-rotating');
    uvPreviewViewport.setPointerCapture(event.pointerId);
  });
  uvPreviewViewport.addEventListener('pointermove', event => {
    if (!uvPreviewController.uvPreviewDrag || uvPreviewController.uvPreviewDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - uvPreviewController.uvPreviewDrag.x;
    const dy = event.clientY - uvPreviewController.uvPreviewDrag.y;
    if (!uvPreviewController.uvPreviewDrag.moved && Math.hypot(event.clientX - uvPreviewController.uvPreviewDrag.startX, event.clientY - uvPreviewController.uvPreviewDrag.startY) < 4) return;
    uvPreviewController.uvPreviewDrag.moved = true;
    uvPreviewController.uvPreviewDrag.x = event.clientX;
    uvPreviewController.uvPreviewDrag.y = event.clientY;
    if (!uvPreviewController.uvPreviewDrag.rotates) return;
    state.uvPreviewYaw -= dx * .01;
    state.uvPreviewPitch = Math.max(-Math.PI / 2 + .02, Math.min(Math.PI / 2 - .02, state.uvPreviewPitch + dy * .01));
    renderUvPreview();
  });
  const endUvPreviewDrag = event => {
    if (!uvPreviewController.uvPreviewDrag || uvPreviewController.uvPreviewDrag.pointerId !== event.pointerId) return;
    const wasClick = !uvPreviewController.uvPreviewDrag.moved && uvPreviewController.uvPreviewDrag.button === 0;
    uvPreviewViewport.releasePointerCapture?.(event.pointerId);
    uvPreviewViewport.classList.remove('is-rotating');
    uvPreviewController.uvPreviewDrag = null;
    if (wasClick) {
      const rect = uvPreviewCanvas.getBoundingClientRect();
      const cache = getUvPreviewProject();
      const hit = uvPreviewRenderer.pickDetailed(cache.project,
        event.clientX - rect.left, event.clientY - rect.top, true);
      if (!hit) {
        state.uvPreviewSelectedFace = null;
        state.selectedUvFaces = new Set();
        renderTextureUvOverlay(true);
        updateFaceSelectionOverlay();
      }
      else if (state.project.getNode(hit.uid)?.type !== 'cube') {
        state.uvPreviewSelectedFace = null;
        toast('程序化 Shape 請先轉換為 Cube 才能編輯逐面 UV');
      } else state.uvPreviewSelectedFace = {
        uid: hit.uid,
        faceName: hit.faceName,
        points: hit.facePoints.map(point => [...point])
      };
      if (state.uvPreviewSelectedFace) {
        state.selectedUvFaces = new Set([uvFaceKey(state.uvPreviewSelectedFace.uid, state.uvPreviewSelectedFace.faceName)]);
        renderTextureUvOverlay(true);
        updateFaceSelectionOverlay();
        if (state.uvPreviewAutoFocusTexture) {
          getDockManager()?.expand('texture');
          setDockHotspotFocus('texture');
          requestAnimationFrame(focusSelectedTextureUvs);
        }
      }
      renderUvPreview();
    }
  };
  uvPreviewViewport.addEventListener('pointerup', endUvPreviewDrag);
  uvPreviewViewport.addEventListener('pointercancel', endUvPreviewDrag);
  uvPreviewViewport.addEventListener('auxclick', event => event.preventDefault());
  $$('[data-hotspot-focus="true"]').forEach(panel => panel.addEventListener('pointerdown', () => {
    setDockHotspotFocus(panel.dataset.panel);
  }));
  const texturePreview = $('#texturePreview');
  texturePreview.addEventListener('pointerdown', () => texturePreview.focus({ preventScroll: true }), true);
  texturePreview.addEventListener('pointerdown', startTexturePointer);
  texturePreview.addEventListener('pointermove', onTexturePointerMove);
  texturePreview.addEventListener('pointerup', endTexturePointer);
  texturePreview.addEventListener('pointercancel', endTexturePointer);
  texturePreview.addEventListener('lostpointercapture', endTexturePointer);
  texturePreview.addEventListener('pointerleave', () => {
    $('#textureGradientPreview').hidden = true;
    if (!getTexturePaintDrag()) $('#textureBrushCursor').hidden = true;
    if (!uvEditorController.textureUvDrag && !getTexturePaintDrag()) texturePreview.style.cursor = '';
  });
  texturePreview.addEventListener('auxclick', event => event.preventDefault());
  texturePreview.addEventListener('wheel', wheelTextureView, { passive: false });
  $$('[data-texture-face]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    setDockHotspotFocus('texture');
    const matching = textureUvEntries().filter(entry => entry.faceName === button.dataset.textureFace);
    const next = event.shiftKey || event.ctrlKey || event.metaKey
      ? new Set(state.selectedUvFaces)
      : new Set();
    matching.forEach(entry => {
      if (event.ctrlKey || event.metaKey) next.has(entry.key) ? next.delete(entry.key) : next.add(entry.key);
      else next.add(entry.key);
    });
    state.selectedUvFaces = next;
    renderTextureUvOverlay(true);
    updateFaceSelectionOverlay();
  }));
  $$('[data-uv-coordinate]').forEach(input => input.addEventListener('change', () => {
    setUvCoordinate(Number(input.dataset.uvCoordinate), Number(input.value));
  }));
  $('#paintBrushSize').addEventListener('input', event => {
    const size = clamp(Math.round(Number(event.target.value)) || 1, 1, 64);
    if (state.tool === 'brush') state.paintBrushSize = size;
    else if (state.paintToolSettings[state.tool]) state.paintToolSettings[state.tool].size = size;
    event.target.value = String(size);
  });
  $('#paintShapeFilled').addEventListener('change', event => {
    state.paintShapeFilled = event.target.checked;
  });
  $('#paintBrushShape').addEventListener('change', event => {
    state.paintBrushShape = event.target.value === 'circle' ? 'circle' : 'square';
    updateToolOptions();
  });
  $('#paintBrushAa').addEventListener('change', event => {
    state.paintBrushAa = event.target.checked;
  });
  $('#paintBrushDepth').addEventListener('input', event => {
    state.paintBrushDepth = clamp(Math.round(Number(event.target.value)) || 0, 0, 32);
    event.target.value = String(state.paintBrushDepth);
  });
  $('#paintBrushOverlay').addEventListener('change', event => {
    state.paintBrushOverlay = event.target.checked;
  });
  $('#paintBrushOpacity').addEventListener('input', event => {
    const opacity = clamp(Math.round(Number(event.target.value)) || 100, 1, 100);
    if (state.tool === 'brush') state.paintBrushOpacity = opacity;
    else if (state.paintToolSettings[state.tool]) state.paintToolSettings[state.tool].opacity = opacity;
    $('#paintBrushOpacityOutput').textContent = `${opacity}%`;
  });
  $('#paintEraseMode').addEventListener('change', event => {
    if (state.tool === 'brush') state.paintBrushErase = event.target.checked;
    else if (state.paintToolSettings[state.tool]) state.paintToolSettings[state.tool].erase = event.target.checked;
  });
  $('#paintIgnoreTransparentToggle').addEventListener('change', event => { state.paintIgnoreTransparent = event.target.checked; });
  $('#paintBucketScope').addEventListener('change', event => {
    state.paintBucketScope = ['face', 'element', 'color', 'contiguous'].includes(event.target.value) ? event.target.value : 'face';
    updateToolOptions();
  });
  $('#paintBucketSingleFace').addEventListener('change', event => {
    state.paintBucketSingleFace = event.target.checked;
  });
  $('#paintGradientMode').addEventListener('change', event => {
    state.paintGradientMode = event.target.value === 'volume' ? 'volume' : 'face';
    clearPaintGradientSelection();
  });
  $('#paintGradientPalette').addEventListener('change', event => {
    state.paintGradientPalette = event.target.checked;
    if (!state.paintGradientPalette) selectPaintGradientStop(state.paintGradientStop);
    updateToolOptions();
    renderPaintGradientPreview();
  });
  $('#paintGradientStartControl').addEventListener('click', () => selectPaintGradientStop('start'));
  $('#paintGradientEndControl').addEventListener('click', () => selectPaintGradientStop('end'));
  $('#paintGradientStartAlpha').addEventListener('input', event => {
    state.paintGradientStartAlpha = clamp(Math.round(Number(event.target.value)) || 0, 0, 100);
    event.target.value = String(state.paintGradientStartAlpha);
    renderPaintGradientPreview();
  });
  $('#paintGradientEndAlpha').addEventListener('input', event => {
    state.paintGradientEndAlpha = clamp(Math.round(Number(event.target.value)) || 0, 0, 100);
    event.target.value = String(state.paintGradientEndAlpha);
    renderPaintGradientPreview();
  });
  new ResizeObserver(() => {
    syncTexturePreviewPriority();
    updateTextureStageTransform();
  }).observe(texturePreview);
  new ResizeObserver(entries => {
    const rect = entries[0]?.contentRect;
    if (!rect || rect.width < 2 || rect.height < 2 || uvPreviewController.uvPreviewResizeFrame !== null) return;
    uvPreviewController.uvPreviewResizeFrame = requestAnimationFrame(() => {
      uvPreviewController.uvPreviewResizeFrame = null;
      uvPreviewController.uvPreviewRenderDirty = true;
      refreshUvPreview(false);
    });
  }).observe(uvPreviewViewport);
  document.fonts?.load('12px "Fusion Pixel Latin"').then(() => {
    uvPreviewController.uvPreviewFaceLabelFontRevision++;
    uvPreviewController.invalidateFaceLabelCache();
    refreshUvPreview();
  });
  $('#geometryOnlyToggle').addEventListener('change', event => configRegistry.set(ConfigKey.SHOW_GEOMETRY_ONLY, event.target.checked, { source: 'toolbar' }));
  $$('[data-transform-space]').forEach(button => button.addEventListener('click', () => {
    state.transformSpace = button.dataset.transformSpace;
    updateToolOptions();
    renderScene();
  }));
  $('#pivotCenterButton').addEventListener('click', centerSelectedPivots);
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
  $('#vertexSnapIntersectionToggle').addEventListener('click', () => {
    state.vertexSnapIntersections = !state.vertexSnapIntersections;
    updateToolOptions();
    renderScene();
  });
  $$('[data-vertex-rotation-mode]').forEach(button => button.addEventListener('click', () => {
    state.vertexSnapRotationMode = button.dataset.vertexRotationMode;
    state.vertexSnapSource = null;
    updateToolOptions();
    renderScene();
  }));
  $('[data-action="grid"]').addEventListener('click', () => configRegistry.set(ConfigKey.SHOW_GRID, !state.grid, { source: 'viewport-toolbar' }));
  $('[data-action="background"]').addEventListener('click', () => {
    const modes = ['black', 'current', 'grid'];
    configRegistry.set(ConfigKey.BACKGROUND_MODE, modes[(modes.indexOf(state.backgroundMode) + 1) % modes.length], { source: 'viewport-toolbar' });
  });
  $('[data-action="wire"]').addEventListener('click', () => configRegistry.set(ConfigKey.SHOW_WIREFRAME, !state.wire, { source: 'viewport-toolbar' }));
  const snapButton = $('[data-action="cycleSnap"]');
  snapButton.addEventListener('click', () => cycleSnap(1));
  snapButton.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    cycleSnap(-1);
  });
  $$('[data-projection]').forEach(button => button.addEventListener('click', () => {
    if (state.axisView) return;
    configRegistry.set(ConfigKey.PROJECTION, button.dataset.projection, { source: 'viewport-toolbar' });
  }));
  $('[data-action="referenceImage"]').addEventListener('click', event => {
    event.stopPropagation();
    setReferenceImageMenu($('#referenceImageMenu').hidden);
  });
  $$('[data-reference-action]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const action = button.dataset.referenceAction;
    if (action === 'import') beginReferenceImageImport();
    if (action === 'edit') {
      setReferenceImageEditing(!referenceImages.editing);
      setReferenceImageMenu(false);
    }
    if (action === 'reset') resetReferenceImage();
    if (action === 'remove') removeReferenceImage();
  }));
  $('#referenceImageList').addEventListener('click', event => {
    const button = event.target.closest('[data-reference-select]');
    if (!button) return;
    event.stopPropagation();
    referenceImages.selectReference(button.dataset.referenceSelect);
  });
  referenceImageInput.addEventListener('change', () => {
    loadReferenceImageFiles(referenceImageInput.files, referenceImages.importViewKey);
  });
  referenceImageLayer.addEventListener('pointerdown', beginReferenceImageDrag);
  referenceImageLayer.addEventListener('pointermove', moveReferenceImageDrag);
  referenceImageLayer.addEventListener('pointerup', endReferenceImageDrag);
  referenceImageLayer.addEventListener('pointercancel', endReferenceImageDrag);
  referenceImageLayer.addEventListener('wheel', scaleReferenceImage, { passive: false });
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
    if (!event.target.closest('.reference-image-control')) setReferenceImageMenu(false);
  });
  $('#minecraftRenderType').addEventListener('change', event => {
    snapshot('core.project.render_type');
    state.project.renderType = event.target.value;
    markDirty();
    renderScene();
  });
  $('#cullFaces').addEventListener('change', event => {
    if (state.project.formatId === 'java_block_item') { event.target.checked = true; return; }
    snapshot('core.project.face_culling');
    state.project.cullFaces = event.target.checked;
    markDirty();
    renderScene();
  });
  $('[data-action="addTexture"]').addEventListener('click', () => textureInput.click());
  $('[data-action="createTexture"]').addEventListener('click', openTextureCreateDialog);
  $('#textureCreateType').addEventListener('change', updateTextureCreateDialog);
  $('#textureTemplatePowerOfTwo').addEventListener('change', updateTextureCreateDialog);
  $('#textureTemplatePaddingEnabled').addEventListener('change', updateTextureCreateDialog);
  $('[data-action="cancelTextureCreate"]').addEventListener('click', () => $('#textureCreateDialog').close());
  $('#textureCreateDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $('#textureCreateDialog .close-button').addEventListener('click', event => {
    event.preventDefault();
    $('#textureCreateDialog').close();
  });
  $('#textureCreateForm').addEventListener('submit', async event => {
    event.preventDefault();
    const type = $('#textureCreateType').value;
    const name = $('#textureCreateName').value.trim() || 'texture.png';
    $('#textureCreateDialog').close();
    if (type === 'template') {
      await createTextureTemplate({
        name,
        selectedOnly: $('#textureTemplateSelectedOnly').checked,
        cleanInvalidFaces: $('#textureTemplateCleanInvalid').checked,
        boxUv: $('#textureTemplateBoxUv').checked,
        powerOfTwo: $('#textureTemplatePowerOfTwo').checked,
        keepMultiTexture: $('#textureTemplateKeepMulti').checked,
        keepLayers: $('#textureTemplateKeepLayers').checked,
        paddingEnabled: $('#textureTemplatePaddingEnabled').checked,
        padding: Number($('#textureTemplatePadding').value) || 0,
        multiple: Number($('#textureTemplateMultiple').value) || 4
      });
    } else createSimpleTexture({
      type, name,
      width: Number($('#textureCreateWidth').value) || 1,
      height: Number($('#textureCreateHeight').value) || 1,
      color: $('#textureCreateColor').value
    });
  });
  $('[data-action="playTimeline"]')?.addEventListener('click', playTimeline);
  $('[data-action="stopTimeline"]')?.addEventListener('click', stopTimeline);
  $('[data-action="addPaletteRow"]').addEventListener('click', addPaletteRow);
  $('#paletteImportButton').addEventListener('click', () => $('#paletteImportInput').click());
  $('#paletteImportInput').addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void palette.importColorMap(file);
  });
  $('#paletteExportButton').addEventListener('click', () => { void palette.exportColorMap(); });
  $('#paletteCompactToggle').addEventListener('click', () => {
    palette.compact = !palette.compact;
    palette.saveCompactPreference();
    renderPalette();
  });
  $('#paletteRows').addEventListener('dragstart', () => {
    if (palette.draggedColor) paletteDragScroll.start();
  });
  $('#paletteRows').addEventListener('dragend', () => paletteDragScroll.stop());
  $('#outlinerSearch').addEventListener('input', renderOutliner);
  $('#outlinerDetailsToggle').addEventListener('change', event => {
    state.outlinerDetailed = event.target.checked;
    state.outlinerWindowStart = -1;
    renderOutlinerWindow();
  });
  outliner.addEventListener('scroll', scheduleOutlinerWindow, { passive: true });
  outliner.addEventListener('pointerover', event => {
    const line = event.target.closest('[data-group-line-uid]');
    if (!line || !outliner.contains(line)) return;
    outliner.querySelectorAll('[data-group-line-uid]').forEach(item =>
      item.classList.toggle('is-hovered-group-line', item.dataset.groupLineUid === line.dataset.groupLineUid));
  });
  outliner.addEventListener('pointerout', event => {
    const line = event.target.closest('[data-group-line-uid]');
    if (!line || event.relatedTarget?.closest?.('[data-group-line-uid]')?.dataset.groupLineUid === line.dataset.groupLineUid) return;
    outliner.querySelectorAll('.is-hovered-group-line').forEach(item => item.classList.remove('is-hovered-group-line'));
  });
  outliner.addEventListener('click', event => {
    const groupLine = event.target.closest('[data-group-line-uid]');
    if (groupLine) {
      event.preventDefault();
      selectItem(groupLine.dataset.groupLineUid, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
      return;
    }
    const button = event.target.closest('[data-uid]');
    if (!button) { clearSelection(); return; }
    if (button.dataset.curveNodeIndex !== undefined) {
      const curve = state.project.getNode(button.dataset.uid);
      if (!isBezierElement(curve)) return;
      sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
      state.selectedUid = curve.uid;
      state.selectedUids = new Set([curve.uid]);
      state.selectionAnchorUid = curve.uid;
      state.selectedModifierUid = null;
      state.selectedCurveNodeIndex = Number(button.dataset.curveNodeIndex);
      refreshSelectionUi();
      return;
    }
    const flag = event.target.closest('[data-node-toggle]');
    if (flag && !flag.classList.contains('unavailable')) {
      event.preventDefault();
      event.stopPropagation();
      const node = state.project.getNode(flag.dataset.nodeUid);
      const key = flag.dataset.nodeToggle;
      if (state.mode === 'paint' && key !== 'visible' && key !== 'locked') return;
      const current = key === 'autoUv' ? nodeAutoUvEnabled(node)
        : key === 'uvNormalized' ? nodeUvNormalizedEnabled(node)
        : key === 'locked' ? node.locked === true
        : node[key] !== false;
      const targets = state.selectedUids.has(node.uid) && state.selectedUids.size > 1
        ? inspectorBatchNodes()
        : [node];
      snapshot(`core.element.field.${key.toLowerCase()}`);
      for (const target of targets) setNodeFlag(target, key, !current);
      markDirty();
      if (key === 'locked') sceneRenderer.invalidateLockState();
      if (key === 'visible' || key === 'autoUv') renderAll();
      else {
        state.outlinerWindowStart = -1;
        renderOutlinerWindow();
        if (key === 'locked') renderScene();
      }
      return;
    }
    const disclosure = event.target.closest('[data-disclosure]');
    if (disclosure?.dataset.disclosure) {
      event.preventDefault();
      const uidValue = disclosure.dataset.disclosure;
      state.collapsedGroups.has(uidValue) ? state.collapsedGroups.delete(uidValue) : state.collapsedGroups.add(uidValue);
      renderOutliner(); return;
    }
    state.selectedCurveNodeIndex = null;
    selectItem(button.dataset.uid, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
  });
  // Native HTML drag suppresses wheel input on Windows. Keep hierarchy drags
  // pointer-driven so the list can still scroll beneath a held item.
  let outlinerPointerDrag = null;
  let suppressOutlinerClick = false;
  const finishOutlinerPointerDrag = (event, commit = false) => {
    const drag = outlinerPointerDrag;
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    outlinerPointerDrag = null;
    if (!drag.active) return;
    const destination = commit ? updateOutlinerDropTarget(event.clientY, event.clientX) : null;
    outlinerDragScroll.stop();
    clearOutlinerDropState();
    removeOutlinerDragGhost();
    state.outlinerDragUids = null;
    suppressOutlinerClick = true;
    setTimeout(() => { suppressOutlinerClick = false; }, 0);
    if (destination) moveSelectedNodes(destination.uid, destination.zone);
  };
  outliner.addEventListener('pointerdown', event => {
    if (event.button !== 0 || state.mode === 'paint'
      || event.target.closest('[data-disclosure], [data-node-toggle], [data-group-line-uid]')) return;
    const item = event.target.closest('.outliner-item');
    if (!item || item.dataset.curveNodeIndex !== undefined) return;
    outlinerPointerDrag = { pointerId: event.pointerId, uid: item.dataset.uid,
      startX: event.clientX, startY: event.clientY, active: false };
  });
  document.addEventListener('pointermove', event => {
    const drag = outlinerPointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      const item = outliner.querySelector(`.outliner-item[data-uid="${CSS.escape(drag.uid)}"]`);
      if (!item) return finishOutlinerPointerDrag(event);
      drag.active = true;
      if (!state.selectedUids.has(drag.uid)) {
        sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
        state.selectedUid = drag.uid;
        state.selectedUids = new Set([drag.uid]);
        state.selectionAnchorUid = drag.uid;
        outliner.querySelectorAll('.outliner-item.active').forEach(row => row.classList.remove('active'));
        item.classList.add('active');
        invalidateSelectionRenderGeometry(false);
        renderInspector(); renderScene(); updateSelectionLabels();
      }
      state.outlinerDragUids = topLevelSelectedUids();
      state.outlinerDragUids.forEach(uidValue =>
        outliner.querySelector(`.outliner-item[data-uid="${CSS.escape(uidValue)}"]`)?.classList.add('is-dragging'));
      createOutlinerDragGhost(state.outlinerDragUids);
      outlinerDragScroll.start();
    }
    event.preventDefault();
    outlinerDragController.dragGhost.style.left = `${event.clientX + 14}px`;
    outlinerDragController.dragGhost.style.top = `${event.clientY + 12}px`;
    updateOutlinerDropTarget(event.clientY, event.clientX);
  });
  document.addEventListener('pointerup', event => finishOutlinerPointerDrag(event, true));
  document.addEventListener('pointercancel', event => finishOutlinerPointerDrag(event));
  window.addEventListener('blur', () => finishOutlinerPointerDrag(null));
  document.addEventListener('click', event => {
    if (!suppressOutlinerClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressOutlinerClick = false;
  }, true);
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
  bindTextureFaceDropSurface(viewport, sceneCanvas, sceneRenderer, () => state.project, '#sceneTextureDropFaceOverlay');
  bindTextureFaceDropSurface(uvPreviewViewport, uvPreviewCanvas, uvPreviewRenderer,
    () => uvPreviewIsActive() ? getUvPreviewProject().project : null, '#uvTextureDropFaceOverlay');
  $('#textureList').addEventListener('click', event => {
    const groupToggle = event.target.closest('[data-texture-group-toggle]');
    if (groupToggle) {
      const group = state.textureGroups.find(entry => entry.id === groupToggle.dataset.textureGroupToggle);
      if (group) { group.collapsed = !group.collapsed; renderTextureList(); }
      return;
    }
    const item = event.target.closest('.texture-item'); if (!item) return;
    setActiveTextureItem(item);
    textureList.focus({ preventScroll: true });
  });
  textureList.addEventListener('dragstart', event => {
    const item = event.target.closest('.texture-item');
    const group = !item && event.target.closest('.texture-group');
    if (!item && !group) return;
    state.textureDrag = item ? { type: 'asset', id: item.dataset.textureUid } : { type: 'group', id: group.dataset.textureGroup };
    (item || group).classList.add('is-dragging');
    if (item) {
      const preview = item.querySelector('.texture-thumb')?.cloneNode(true);
      if (preview) {
        preview.classList.add('texture-drag-preview');
        document.body.append(preview);
        event.dataTransfer.setDragImage(preview, 18, 18);
        requestAnimationFrame(() => preview.remove());
      }
    }
    event.dataTransfer.effectAllowed = item ? 'copyMove' : 'move';
    event.dataTransfer.setData('text/x-cubebricks-texture', `${state.textureDrag.type}:${state.textureDrag.id}`);
    textureDragScroll.start();
  });
  textureList.addEventListener('dragover', event => {
    if (!state.textureDrag) return;
    event.preventDefault();
    updateTextureDropTarget(event.clientY);
  });
  textureList.addEventListener('drop', event => {
    if (!state.textureDrag) return;
    event.preventDefault();
    const destination = updateTextureDropTarget(event.clientY);
    noteJournalOperation(state.textureDrag.type === 'asset' ? 'core.texture.reorder' : 'core.texture.group');
    const item = destination?.item;
    const groupNode = destination?.group;
    const previousAssets = [...state.textureAssets];
    if (state.textureDrag.type === 'asset') {
      const asset = state.textureAssets.find(entry => entry._uid === state.textureDrag.id);
      if (asset && item && item.dataset.textureUid !== asset._uid) {
        const target = state.textureAssets.find(entry => entry._uid === item.dataset.textureUid);
        state.textureAssets = state.textureAssets.filter(entry => entry !== asset);
        const targetIndex = state.textureAssets.indexOf(target);
        state.textureAssets.splice(targetIndex + (destination.position === 'after' ? 1 : 0), 0, asset);
        asset.groupId = target.groupId || null;
      } else if (asset && destination?.rootEdge) {
        state.textureAssets = state.textureAssets.filter(entry => entry !== asset);
        state.textureAssets.splice(destination.rootEdge === 'start' ? 0 : state.textureAssets.length, 0, asset);
        asset.groupId = null;
      } else if (asset && groupNode) asset.groupId = groupNode.dataset.textureGroup;
      else if (asset) asset.groupId = null;
    } else if (state.textureDrag.type === 'group' && groupNode && groupNode.dataset.textureGroup !== state.textureDrag.id) {
      const moving = state.textureGroups.find(entry => entry.id === state.textureDrag.id);
      const target = state.textureGroups.find(entry => entry.id === groupNode.dataset.textureGroup);
      state.textureGroups = state.textureGroups.filter(entry => entry !== moving);
      state.textureGroups.splice(state.textureGroups.indexOf(target) + (destination.position === 'after' ? 1 : 0), 0, moving);
    }
    state.textureDrag = null;
    remapNumericFaceTextureReferences(previousAssets);
    renderTextureList();
    rebuildTextureAtlas();
    markDirty();
  });
  textureList.addEventListener('dragend', () => {
    textureDragScroll.stop();
    state.textureDrag = null;
    clearTextureFaceDropTarget();
    renderTextureList();
  });
  $$('[data-view-axis]').forEach(button => button.addEventListener('click', event => {
    if (cameraController.suppressAxisWidgetClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    enterAxisView(button.dataset.viewAxis, Number(button.dataset.axisSign));
  }));
  const axisWidget = $('.axis-widget');
  axisWidget.addEventListener('pointerdown', beginAxisWidgetDrag);
  axisWidget.addEventListener('pointermove', moveAxisWidgetDrag);
  axisWidget.addEventListener('pointerup', endAxisWidgetDrag);
  axisWidget.addEventListener('pointercancel', endAxisWidgetDrag);
  $('#transformGizmo').addEventListener('pointerdown', event => {
    if (event.button === 1) {
      event.preventDefault(); event.stopPropagation();
      startCameraDrag(event, event.currentTarget);
      return;
    }
    if (event.button !== 0) return;
    const curve = selected();
    if (state.mode !== 'paint') {
      const rect = sceneCanvas.getBoundingClientRect();
      const node = sceneRenderer.pickUnselectedCurveNode(state.project,
        event.clientX - rect.left, event.clientY - rect.top,
        isBezierElement(curve) ? curve.uid : null, state.selectedCurveNodeIndex,
        14, uid => !isEffectivelyLocked(uid));
      if (node) {
        event.preventDefault(); event.stopPropagation();
        if (node.uid !== curve?.uid) selectItem(node.uid, { revealInOutliner: true });
        state.selectedCurveNodeIndex = node.index;
        state.selectedModifierUid = null;
        state.outlinerWindowStart = -1;
        renderOutlinerWindow(); renderInspector(); renderScene();
        return;
      }
    }
    const handle = resolveGizmoHandle(event);
    if (!handle) return;
    event.preventDefault(); event.stopPropagation();
    if (handle.dataset.kind === 'modifier-anchor') {
      const owner = selected();
      const modifier = [...(owner?.modifiers || []), ...(owner?.operators || [])].find(entry => entry.uid === handle.dataset.modifierUid);
      if (!modifier?.enabled) return;
      state.selectedModifierUid = modifier.uid;
      state.selectedCurveNodeIndex = null;
      state.inspectorPage = modifier.type === 'paint_symmetry' ? 'operators' : 'modifiers';
      if (!['move', 'rotate', 'pivot'].includes(state.tool)) setTool('move');
      else { renderInspector(); renderScene(); updateSelectionLabels(); }
      return;
    }
    if (handle.dataset.kind === 'vertex') {
      useVertexSnapPoint(state.vertexSnapPoints?.[Number(handle.dataset.vertexIndex)]);
      return;
    }
    if (handle.dataset.kind === 'rotation-pivot-vertex') {
      if (event.altKey && state.rotationVertexPick) {
        movePivotToRotationVertex(state.rotationPivotVertices[Number(handle.dataset.vertexIndex)]);
      }
      return;
    }
    if (state.tool === 'rotate' && handle.dataset.kind?.startsWith('rotate')) {
      const signature = `${handle.dataset.kind}:${handle.dataset.axis || 'view'}:${handle.dataset.sign || 1}`;
      pendingRotationPress = {
        x: event.clientX, y: event.clientY,
        signature, selectedUid: state.selectedUid,
        serialized: state.project.serialize(), historyLength: state.history.length,
        future: [...state.future], dirty: state.dirty
      };
    } else pendingRotationPress = null;
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
  $('#transformGizmo').addEventListener('click', event => {
    if (event.detail === 1 && pendingRotationPress) recentRotationPress = pendingRotationPress;
  });
  $('#viewport').addEventListener('dblclick', event => {
    const prior = recentRotationPress;
    if (!prior || state.tool !== 'rotate' || prior.selectedUid !== state.selectedUid
      || Math.hypot(event.clientX - prior.x, event.clientY - prior.y) >= 12) return;
    event.preventDefault(); event.stopImmediatePropagation();
    recentRotationPress = null;
    // The browser's dblclick event uses the operating system's click timing.
    // Both pointer drags may already have committed by now; roll them back.
    if (state.project.serialize() !== prior.serialized) {
      state.history.length = prior.historyLength;
      state.future = prior.future;
      restore(prior.serialized);
      markDirty(prior.dirty);
    }
    const matching = control => control
      && `${control.dataset.kind}:${control.dataset.axis || 'view'}:${control.dataset.sign || 1}` === prior.signature;
    const resolved = resolveGizmoHandle(event);
    const handle = matching(resolved) ? resolved
      : [...$('#transformGizmo').querySelectorAll('.gizmo-control')].find(matching);
    if (handle) openPreciseRotationInput(event, handle);
  }, true);
  $('#transformGizmo').addEventListener('pointerleave', () => {
    $('#transformGizmo').querySelectorAll('.depth-hover').forEach(control => control.classList.remove('depth-hover'));
  });
  $('#transformGizmo').addEventListener('pointerup', endPointerDrag);
  $('#transformGizmo').addEventListener('pointercancel', endPointerDrag);
  sceneCanvas.addEventListener('pointerdown', () => sceneCanvas.focus({ preventScroll: true }), true);
  sceneCanvas.addEventListener('pointerdown', onPointerDown);
  sceneCanvas.addEventListener('pointermove', onScenePointerMove);
  viewport.addEventListener('pointermove', scheduleLockedHover);
  viewport.addEventListener('pointerleave', () => {
    sceneCanvas.classList.remove('is-curve-handle-hover', 'is-curve-node-hover');
    $('#transformGizmo').querySelectorAll('.curve-node-marker.hover').forEach(marker => marker.classList.remove('hover'));
    clearLockedHoverCapture();
    animateLockedHoverStrength(false);
    if (state.tool !== 'knife' || state.dragging) return;
    state.knifeHover = null;
    renderScene();
  });
  sceneCanvas.addEventListener('pointerup', endPointerDrag);
  sceneCanvas.addEventListener('pointercancel', endPointerDrag);
  sceneCanvas.addEventListener('lostpointercapture', endPointerDrag);
  sceneCanvas.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
  window.addEventListener('wheel', event => {
    if (!event.altKey || !palette.scrollSelectedPaletteColor(event.deltaY)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, passive: false });
  sceneCanvas.addEventListener('wheel', event => { event.preventDefault(); cancelCameraFocus(); state.zoom = Math.max(.002, Math.min(100, state.zoom * (event.deltaY > 0 ? .9 : 1.1))); scheduleSceneRender(); }, { passive: false });
  window.addEventListener('resize', renderScene);
  document.addEventListener('visibilitychange', refreshUvPreview);
  window.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (event.key === 'Alt' && !event.repeat && beginTemporaryEyedropper()) {
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      if (event.target instanceof Element
        && (event.target.closest('input, textarea, [contenteditable]') || event.target.isContentEditable)) return;
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      event.shiftKey ? exportProject() : saveProject();
      return;
    }
    if (event.target.matches('input,select,textarea') || event.target.isContentEditable) return;
    if (state.mode === 'display') return;
    if ((event.ctrlKey || event.metaKey) && key === 'a'
      && event.target instanceof Element
      && (viewport.contains(event.target) || outliner.contains(event.target))) {
      event.preventDefault();
      selectAllElements();
      return;
    }
    const textureListFocused = document.activeElement?.closest?.('#textureList');
    if (textureListFocused && (event.ctrlKey || event.metaKey)) {
      if (key === 'c') { event.preventDefault(); copyTexture(); return; }
      if (key === 'x') { event.preventDefault(); cutTexture(); return; }
      if (key === 'v') { event.preventDefault(); pasteTexture(); return; }
      if (key === 'd') { event.preventDefault(); pasteTexture({ inPlace: true }); return; }
    }
    if (event.key === 'Alt' && state.mode !== 'paint' && state.tool === 'rotate' && !state.rotationVertexPick) {
      event.preventDefault();
      state.rotationVertexPick = true;
      updateTransformGizmo();
    }
    if (event.key === 'Escape') {
      setRenderModeMenu(false);
      setReferenceImageMenu(false);
      if (referenceImages.editing) setReferenceImageEditing(false);
      closeShapeCreateMenu();
      if (inspectorController.subdivisionSession) exitSubdivisionEdit();
      clearPaintGradientSelection();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') { event.preventDefault(); cutSelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteElements(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); pasteElements({ inPlace: true }); }
    if (event.key === 'Delete') {
      const palette = $('#paletteRows');
      if (document.activeElement === palette || palette.contains(document.activeElement)) {
        event.preventDefault();
        if (!event.repeat) deleteSelectedPaletteColor();
        return;
      }
      const focus = document.activeElement;
      if (focus?.closest?.('#textureFeatureControls, #layerEditorDialog')) {
        event.preventDefault();
        if (!event.repeat) removeActiveLayer().catch(error => toast(error.message));
        return;
      }
      if (focus?.closest?.('#textureList')) {
        event.preventDefault();
        if (!event.repeat) removeTexture();
        return;
      }
      deleteSelected();
    }
    if (event.key.toLowerCase() === 'f') { cancelCameraFocus(); state.zoom = 1.12; state.panX = 0; state.panY = 0; renderScene(); }
    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      if (uvEditorController.focusedDockHotspot === 'texture') event.shiftKey ? resetTextureView() : focusSelectedTextureUvs();
      else event.shiftKey ? focusSceneOrigin() : focusSelected();
    }
    if (state.mode === 'paint' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const paintShortcuts = { b: 'brush', l: 'line', m: 'rectangle', o: 'ellipse', g: 'fill', j: 'gradient', i: 'eyedropper' };
      const paintTool = paintShortcuts[event.key.toLowerCase()];
      if (paintTool) {
        event.preventDefault();
        setTool(paintTool);
      }
    }
    const shortcuts = { '1': 'move', '2': 'resize', '3': 'rotate', '4': 'pivot', '5': 'vertexSnap', '6': 'knife', '7': 'faceSelect' }; if (shortcuts[event.key]) setTool(shortcuts[event.key]);
    if (state.tool === 'knife' && state.knifePointer && ['Shift', 'Control'].includes(event.key)) refreshKnifeFromModifierEvent(event);
  });
  window.addEventListener('keyup', event => {
    if (event.key === 'Alt' && state.rotationVertexPick) {
      state.rotationVertexPick = false;
      updateTransformGizmo();
      event.preventDefault();
    }
    if (event.key === 'Alt' && endTemporaryEyedropper()) {
      event.preventDefault();
      return;
    }
    if (state.tool === 'knife' && state.knifePointer && ['Shift', 'Control'].includes(event.key)) refreshKnifeFromModifierEvent(event);
  });
  window.addEventListener('blur', () => {
    endTemporaryEyedropper();
    if (state.rotationVertexPick) {
      state.rotationVertexPick = false;
      updateTransformGizmo();
    }
  });
  document.addEventListener('visibilitychange', scheduleTextureAnimation);
}

let timelineAnimation = null;
let timelineLastTime = 0;

return { bindEvents };
}
