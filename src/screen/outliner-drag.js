import { refreshAutomaticNodeName } from '../model.js';

export function createOutlinerDragController({
  state, $$, outliner, outlinerKindMarkup, escapeHtml,
  topLevelSelectedUids, nodeContainer, toast, snapshot, markDirty, renderAll
}) {
let outlinerDragGhost = null;
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
  snapshot('core.element.reparent');
  const order = new Map((state.outlinerRows || []).map((row, index) => [row.node.uid, index]));
  moving.sort((left, right) => (order.get(left) ?? Infinity) - (order.get(right) ?? Infinity));
  for (const uidValue of moving) {
    const container = nodeContainer(uidValue).items;
    const index = container.indexOf(uidValue);
    if (container === destination && index >= 0 && index < insertionIndex) insertionIndex--;
    if (index >= 0) container.splice(index, 1);
  }
  destination.splice(Math.max(0, insertionIndex), 0, ...moving);
  state.project.invalidateHierarchyIndex();
  moving.forEach(uidValue => refreshAutomaticNodeName(state.project, state.project.getNode(uidValue)));
  if (destinationParent) state.collapsedGroups.delete(destinationParent.uid);
  markDirty();
  renderAll();
  animateOutlinerReorder(previousRowPositions);
}

return {
  get dragGhost() { return outlinerDragGhost; },
  clearOutlinerDropState,
  captureOutlinerRowPositions,
  animateOutlinerReorder,
  removeOutlinerDragGhost,
  createOutlinerDragGhost,
  moveSelectedNodes,
};
}
