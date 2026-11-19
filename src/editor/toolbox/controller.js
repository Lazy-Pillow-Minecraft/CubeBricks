import { captureFormatGeometry, constrainNode, formatRules, keepFormatEditWithinLimit } from '../../common/core/format-constraints.js';
import { generatedSelectionFrame, generatedPoint, sourcePoint, sourceVector } from '../../common/core/modifier-selection.js';
import { affineAround, affineCompose, affineInverse, matrixIdentity, rotationMatrix } from '../../model/transform-math.js';
import { boundsOfPoints, captureToolboxSelection, compensateToolboxRotation, restoreToolboxSelection, scaleToolboxSelection, transformToolboxSelection } from './model-transforms.js';
import { toolboxMarkup } from './view.js';
import { ConfigKey, configRegistry } from '../../common/config/app-config.js';
import { renameFlippedNodes } from '../../model.js';

export function createToolboxController({ state, $, sceneCanvas, sceneRenderer, selectedTopLevelNodes,
  isEffectivelyLocked, getSnapStep, snapshot, markDirty, renderAll, renderScene,
  invalidateSelectionRenderGeometry, updateToolOptions, discardSubdivisionEdits }) {
  let frameRequest = null;
  const root = () => $('#toolboxOptions');
  const roots = () => selectedTopLevelNodes().filter(node => !isEffectivelyLocked(node.uid));
  const selectionFrame = () => generatedSelectionFrame(state, sceneRenderer);
  const displayBounds = (capture, frame) => boundsOfPoints(capture.points.map(point => generatedPoint(frame, point)));
  const conjugate = (operation, frame) => frame ? affineCompose(affineInverse(frame), affineCompose(operation, frame)) : operation;
  function closeMenus() {
    root().querySelectorAll('[data-toolbox-menu]').forEach(menu => { menu.hidden = true; });
    root().querySelectorAll('[data-toolbox-picker]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }
  function refresh() {
    const container = root();
    if (!container?.childElementCount) return;
    container.hidden = state.mode !== 'edit' || state.tool !== 'toolbox';
    if (container.hidden) { closeMenus(); return; }
    const values = { category: state.toolboxCategory, snap: state.toolboxSnap, centerBase: state.toolboxCenterBase };
    for (const [id, value] of Object.entries(values)) {
      const item = container.querySelector(`[data-toolbox-choice="${id}"][data-value="${value}"]`);
      const label = container.querySelector(`[data-toolbox-label="${id}"]`);
      if (item && label && label.innerHTML !== item.innerHTML) label.innerHTML = item.innerHTML;
    }
    container.querySelectorAll('[data-toolbox-category]').forEach(group => { group.hidden = group.dataset.toolboxCategory !== state.toolboxCategory; });
    container.querySelectorAll('[data-toolbox-choice]').forEach(button => button.classList.toggle('active', values[button.dataset.toolboxChoice] === button.dataset.value));
    container.querySelector('[data-toolbox-rename-directions]').checked = state.toolboxRenameDirections !== false;
    const disabled = !roots().length;
    container.querySelectorAll('[data-toolbox-action]').forEach(button => { button.disabled = disabled; });
  }
  function bind() {
    root().innerHTML = toolboxMarkup();
    root().addEventListener('change', event => {
      if (!event.target.matches('[data-toolbox-rename-directions]')) return;
      state.toolboxRenameDirections = event.target.checked;
      configRegistry.set(ConfigKey.TOOLBOX_FLIP_NAMES, event.target.checked, { source: 'toolbox' });
    });
    root().addEventListener('click', event => {
      const choice = event.target.closest('[data-toolbox-choice]');
      if (choice) {
        const fields = { category: 'toolboxCategory', snap: 'toolboxSnap', centerBase: 'toolboxCenterBase' };
        state[fields[choice.dataset.toolboxChoice]] = choice.dataset.value;
        closeMenus(); refresh(); updateToolOptions(); renderScene();
        return;
      }
      const picker = event.target.closest('[data-toolbox-picker]');
      if (picker) {
        const menu = root().querySelector(`[data-toolbox-menu="${picker.dataset.toolboxPicker}"]`), open = menu.hidden;
        closeMenus();
        if (open) {
          menu.hidden = false;
          const rect = picker.getBoundingClientRect();
          menu.style.left = `${Math.max(4, Math.min(innerWidth - menu.offsetWidth - 4, rect.left))}px`;
          menu.style.top = `${rect.bottom + 4}px`;
          picker.setAttribute('aria-expanded', 'true');
        }
        return;
      }
      const action = event.target.closest('[data-toolbox-action]');
      if (action) applyAction(action.dataset.toolboxAction, action.dataset);
    });
    document.addEventListener('pointerdown', event => { if (!root().contains(event.target)) closeMenus(); });
    for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
      const drag = state.dragging;
      if (drag?.type === 'toolbox-scale' && drag.currentInput && ['Shift', 'Control', 'Meta'].includes(event.key))
        moveScale({ ...drag.currentInput, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey });
    });
    refresh();
  }
  function constrain(capture, before) {
    const rules = formatRules(state.project);
    for (const entry of capture.entries) constrainNode(entry.node, rules);
    if (!keepFormatEditWithinLimit(state.project, before)) { restoreToolboxSelection(capture); return false; }
    return true;
  }
  function applyAction(action, options = {}) {
    if (state.mode !== 'edit' || !roots().length) return false;
    const capture = captureToolboxSelection(state.project, roots()), frame = selectionFrame();
    const pivot = generatedPoint(frame, capture.pivot);
    const axis = ['x', 'y', 'z'].indexOf(options.axis);
    let operation, operationId;
    if (action === 'flip' && axis >= 0) {
      const matrix = matrixIdentity(); matrix[axis][axis] = -1;
      operation = affineAround(matrix, options.base === 'origin' ? [0, 0, 0] : pivot);
      operationId = 'core.toolbox.flip';
    } else if (action === 'rotate' && axis >= 0) {
      const rotation = [0, 0, 0]; rotation[axis] = Number(options.angle) < 0 ? -90 : 90;
      operation = affineAround(rotationMatrix(rotation), options.base === 'origin' ? [0, 0, 0] : pivot);
      operationId = 'core.toolbox.rotate';
    } else if (action === 'compensate' && ['x', 'y', 'z', 'xy', 'xz', 'yz', 'all'].includes(options.axis)) {
      operationId = 'core.toolbox.compensate';
    } else if (action === 'center') {
      const center = state.toolboxCenterBase === 'pivot' ? pivot : displayBounds(capture, frame)?.center || pivot;
      operation = { matrix: matrixIdentity(), translation: center.map((value, index) => options.axis === 'all' || index === axis ? -value : 0) };
      operationId = 'core.toolbox.center';
    } else return false;
    const before = captureFormatGeometry(capture.entries.map(entry => entry.node));
    snapshot(operationId);
    if (action === 'compensate') compensateToolboxRotation(state.project, capture, options.axis, frame);
    else transformToolboxSelection(state.project, capture, conjugate(operation, frame));
    const accepted = constrain(capture, before);
    if (accepted && action === 'flip' && state.toolboxRenameDirections !== false)
      renameFlippedNodes(state.project, capture.entries.map(entry => entry.node), options.axis);
    invalidateSelectionRenderGeometry(); markDirty(); renderAll();
    return true;
  }
  function startScale(event, captureTarget, handleElement) {
    if (event.button !== 0 || state.mode !== 'edit' || state.toolboxCategory !== 'scale' || !roots().length) return;
    event.preventDefault?.(); event.stopPropagation?.();
    const capture = captureToolboxSelection(state.project, roots()), frame = selectionFrame();
    const bounds = displayBounds(capture, frame);
    state.dragging = { type: 'toolbox-scale', pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      capture, center: sourcePoint(frame, bounds?.center || generatedPoint(frame, capture.pivot)), spans: bounds?.size || [0, 0, 0],
      axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(axis => sourceVector(frame, axis)),
      before: captureFormatGeometry(capture.entries.map(entry => entry.node)),
      captureTarget, handleElement, snapshotTaken: false, latest: null };
    if (Number.isFinite(event.pointerId)) captureTarget.setPointerCapture?.(event.pointerId);
    handleElement?.classList.add('active');
    sceneRenderer.beginTransformGhost();
  }
  function flushScale() {
    const drag = state.dragging;
    if (drag?.type !== 'toolbox-scale' || !drag.latest) return;
    const event = drag.latest; drag.latest = null;
    const requested = Math.exp(Math.max(-12, Math.min(12, (drag.y - event.clientY) / 160)));
    const factor = scaleToolboxSelection(state.project, drag.capture, requested, {
      center: drag.center, axes: drag.axes, spans: drag.spans, snap: state.toolboxSnap, step: getSnapStep(event)
    });
    constrain(drag.capture, drag.before);
    invalidateSelectionRenderGeometry();
    const tooltip = $('#transformTooltip'), rect = $('#viewport').getBoundingClientRect();
    tooltip.textContent = `${factor >= 1 ? '+' : ''}${Number(((factor - 1) * 100).toFixed(2))}%`;
    tooltip.style.left = `${event.clientX - rect.left + 14}px`;
    tooltip.style.top = `${event.clientY - rect.top + 14}px`;
    tooltip.hidden = false;
    markDirty(); renderScene();
  }
  function moveScale(event) {
    const drag = state.dragging;
    if (drag?.type !== 'toolbox-scale' || event.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
    if (!drag.snapshotTaken && Math.abs(event.clientY - drag.y) < .5) return;
    if (!drag.snapshotTaken) {
      snapshot('core.toolbox.scale');
      for (const entry of drag.capture.entries) {
        discardSubdivisionEdits(entry.node);
        entry.data.subdivisionEdits = structuredClone(entry.node.subdivisionEdits || {});
      }
      drag.snapshotTaken = true;
    }
    drag.latest = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey };
    drag.currentInput = drag.latest;
    if (frameRequest === null) frameRequest = requestAnimationFrame(() => { frameRequest = null; flushScale(); });
  }
  function finishScale(event) {
    const drag = state.dragging;
    if (drag?.type !== 'toolbox-scale') return;
    if (Number.isFinite(event.clientY) && event.type !== 'pointercancel') moveScale(event);
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    frameRequest = null; flushScale();
    drag.handleElement?.classList.remove('active');
    if (drag.captureTarget.hasPointerCapture?.(drag.pointerId)) drag.captureTarget.releasePointerCapture(drag.pointerId);
    state.dragging = null;
    sceneRenderer.endTransformGhost();
    $('#transformTooltip').hidden = true;
    if (drag.snapshotTaken) { markDirty(); renderAll(); }
    else renderScene();
  }
  return { bind, refresh, closeMenus, applyAction, startScale, moveScale, finishScale, flushScale };
}
