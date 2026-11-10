import { layerDescendantUids, layerTreeItems, reorderLayerStack } from '../common/core/texture-features.js';
import { createListDragAutoScroll } from '../screen/list-drag-scroll.js';
import { verticalDropTarget } from '../screen/vertical-drop.js';

// Keep the pointer session and drop preview attached to the layer list.
// The texture controller owns history and refreshes the rendered texture.
export function createLayerDragBinder({
  activeTextureAsset, textureCanvas, pushTexturePaintHistory,
  refreshLayeredTexture, renderTextureFeatureControls, toast
}) {
  let layerDrag = null;
  let layerDragBound = false;

  function bindLayerDrag(root) {
    if (layerDragBound) return;
    layerDragBound = true;
    const scroll = root.closest('.texture-layer-panel-scroll');
    const autoScroll = createListDragAutoScroll(scroll, () => Boolean(layerDrag?.active), pointer => {
      if (pointer) updateLayerDropTarget(root, pointer.y, pointer.x);
    });
    const clearTarget = () => {
      root.querySelectorAll('.drop-highlight').forEach(line => {
        line.classList.remove('drop-highlight');
        line.style.removeProperty('--drop-highlight-height');
      });
      const guide = root.querySelector('.texture-layer-drop-guide');
      if (guide) {
        guide.hidden = true;
        guide.classList.remove('is-nested-drop');
      }
    };
    function updateLayerDropTarget(rootNode, y, x) {
      clearTarget();
      if (!layerDrag) return;
      layerDrag.targetUid = null;
      layerDrag.position = null;
      const asset = layerDrag.asset;
      const tree = rootNode.querySelector('.texture-layer-tree');
      if (!tree || !asset) return;
      const entries = [...tree.querySelectorAll('[data-layer-row],[data-layer-group-end]')];
      const picked = verticalDropTarget(entries, y);
      const item = layerDrag.treeItems?.[picked?.index];
      if (!picked || !item) return;
      const targetRect = picked.entry.getBoundingClientRect();
      const treeRect = tree.getBoundingClientRect();
      const lineX = depth => 11 + depth * 16;
      let targetUid, position, groupLine, guideY, guideDepth;
      if (item.groupEnd) {
        const chain = [...item.ancestors, { uid: item.groupEnd, depth: item.depth }];
        const lastRect = entries.at(-1)?.getBoundingClientRect();
        const belowTree = picked.index === entries.length - 1 && y >= lastRect?.bottom;
        const outside = belowTree ? chain[0] : chain.find(({ depth }) => x <= treeRect.left + lineX(depth) + 4);
        const destination = outside || chain.at(-1);
        targetUid = destination.uid;
        position = outside ? 'after' : 'inside-end';
        groupLine = destination;
        guideY = targetRect.top + 7;
        guideDepth = destination.depth + (outside ? 0 : 1);
      } else {
        const ratio = picked.ratio;
        position = item.layer.type === 'group' && ratio > .27 && ratio < .73
          ? 'inside' : picked.position;
        targetUid = item.layer.uid;
        groupLine = position === 'inside' ? { uid: targetUid, depth: item.depth } : item.ancestors.at(-1);
        guideY = position === 'before' ? targetRect.top - 1.5 : targetRect.bottom + 1.5;
        guideDepth = item.depth + (position === 'inside' ? 1 : 0);
      }
      if (targetUid === layerDrag.uid || layerDrag.descendantUids?.has(targetUid)) return;
      layerDrag.targetUid = targetUid;
      layerDrag.position = position;
      const guide = tree.querySelector('.texture-layer-drop-guide');
      if (guide) {
        guide.hidden = false;
        guide.style.top = `${guideY - treeRect.top}px`;
        guide.style.left = `${guideDepth ? lineX(guideDepth) : 4}px`;
        guide.classList.toggle('is-nested-drop', Boolean(groupLine && guideDepth > groupLine.depth));
      }
      if (groupLine) {
        const rail = [...tree.querySelectorAll('[data-layer-group-line]')]
          .find(line => line.dataset.layerGroupLine === groupLine.uid);
        if (rail) {
          rail.classList.add('drop-highlight');
          rail.style.setProperty('--drop-highlight-height', `${Math.max(0, Math.min(rail.offsetHeight, guideY - rail.getBoundingClientRect().top))}px`);
        }
      }
    }
    root.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('input,button,[data-layer-group-line]')) return;
      const row = event.target.closest('[data-layer-row]');
      if (!row || !root.contains(row)) return;
      const asset = activeTextureAsset();
      layerDrag = {
        uid: row.dataset.layerRow, startX: event.clientX, startY: event.clientY,
        pointerId: event.pointerId, asset, treeItems: layerTreeItems(asset?.layers || []),
        descendantUids: layerDescendantUids(asset?.layers || [], row.dataset.layerRow),
        active: false, targetUid: null, position: null
      };
    });
    root.addEventListener('dragstart', event => {
      if (event.target.closest('[data-layer-row]')) event.preventDefault();
    });
    document.addEventListener('pointermove', event => {
      const drag = layerDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
        const row = root.querySelector(`[data-layer-row="${CSS.escape(drag.uid)}"]`);
        if (!row) {
          layerDrag = null;
          return;
        }
        drag.active = true;
        root.querySelector('.texture-layer-tree')?.classList.add('is-layer-dragging');
        row.classList.add('is-dragging');
        const ghost = row.cloneNode(true);
        ghost.classList.remove('is-dragging');
        ghost.classList.add('texture-layer-drag-ghost');
        const originalThumb = row.querySelector('.texture-layer-thumb');
        const ghostThumb = ghost.querySelector('.texture-layer-thumb');
        if (originalThumb && ghostThumb) ghostThumb.getContext('2d').drawImage(originalThumb, 0, 0);
        ghost.style.width = `${row.getBoundingClientRect().width}px`;
        (root.closest('dialog[open]') || document.body).append(ghost);
        drag.ghost = ghost;
        autoScroll.start();
      }
      event.preventDefault();
      drag.ghost.style.left = `${event.clientX + 13}px`;
      drag.ghost.style.top = `${event.clientY + 9}px`;
      updateLayerDropTarget(root, event.clientY, event.clientX);
    });
    const finish = (event, commit) => {
      const drag = layerDrag;
      if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
      if (commit && drag.active) updateLayerDropTarget(root, event.clientY, event.clientX);
      layerDrag = null;
      autoScroll.stop();
      drag.ghost?.remove();
      root.querySelector(`[data-layer-row="${CSS.escape(drag.uid)}"]`)?.classList.remove('is-dragging');
      root.querySelector('.texture-layer-tree')?.classList.remove('is-layer-dragging');
      clearTarget();
      if (!commit || !drag.active || !drag.targetUid) return;
      const asset = drag.asset;
      if (!asset || asset !== activeTextureAsset()) return;
      const reordered = reorderLayerStack(asset.layers, drag.uid, drag.targetUid, drag.position);
      if (reordered === asset.layers) return;
      pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
      asset.layers = reordered;
      refreshLayeredTexture(asset).then(renderTextureFeatureControls).catch(error => toast(error.message));
    };
    document.addEventListener('pointerup', event => finish(event, true));
    document.addEventListener('pointercancel', event => finish(event, false));
    window.addEventListener('blur', () => finish(null, false));
  }

  return bindLayerDrag;
}
