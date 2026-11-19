import { createListDragAutoScroll } from '../list-drag-scroll.js';
import { verticalDropTarget } from '../vertical-drop.js';

// Stack order affects evaluation, so dragging previews only the destination.
// Commit once on release; never collapse the real card or rebuild geometry
// while moving the pointer. Roots stay bound across inspector rebuilds.
export function createStackCardDragController({ state, onReorder, onRefresh }) {
  const bindings = new WeakMap();
  let drag = null;

  function valid(session) {
    return state.project === session.project && session.binding.ownerUid === session.owner.uid
      && state.project.getNode(session.owner.uid) === session.owner
      && session.row.isConnected && session.binding.root.contains(session.row);
  }

  function updateDrop(y) {
    if (!drag?.active) return;
    const rows = [...drag.page.querySelectorAll(`[data-${drag.kind}-card]`)].filter(row => row !== drag.row);
    const picked = verticalDropTarget(rows, y);
    drag.index = picked ? picked.index + (picked.position === 'after' ? 1 : 0) : 0;
    drag.guide.hidden = !picked;
    if (!picked) return;
    const rect = picked.entry.getBoundingClientRect();
    const edge = picked.position === 'before' ? rect.top - 3.5 : rect.bottom + 3.5;
    drag.guide.style.top = `${edge - drag.page.getBoundingClientRect().top}px`;
  }

  function move(event) {
    const session = drag;
    if (!session || event.pointerId !== session.pointerId) return;
    if (!valid(session)) { cancel(); return; }
    if (!session.active) {
      if (Math.hypot(event.clientX - session.x, event.clientY - session.y) < 6) return;
      session.active = true;
      const ghost = session.row.cloneNode(false);
      ghost.classList.add('modifier-stack-drag-ghost');
      ghost.style.width = `${session.row.getBoundingClientRect().width}px`;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.append(session.row.querySelector('.modifier-card-heading').cloneNode(true));
      const arrow = ghost.querySelector('.modifier-collapse .open-icon');
      if (arrow) arrow.dataset.iconDirection = 'right';
      (session.binding.root.closest('dialog[open]') || document.body).append(ghost);
      session.ghost = ghost;
      session.guide = document.createElement('div');
      session.guide.className = 'modifier-stack-drop-guide';
      session.guide.setAttribute('aria-hidden', 'true');
      session.page.append(session.guide);
      session.row.classList.add('is-stack-dragging');
      session.binding.root.classList.add('is-stack-dragging');
      session.binding.scroll.start();
    }
    event.preventDefault();
    session.ghost.style.left = `${event.clientX + 13}px`;
    session.ghost.style.top = `${event.clientY + 9}px`;
    updateDrop(event.clientY);
  }

  function finish(event, commit) {
    const session = drag;
    if (!session || event?.pointerId !== undefined && event.pointerId !== session.pointerId) return;
    const accepted = commit && session.active && valid(session);
    if (accepted) updateDrop(event.clientY);
    drag = null;
    session.binding.scroll.stop();
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', release);
    document.removeEventListener('pointercancel', abort);
    window.removeEventListener('blur', cancel);
    if (session.handle.hasPointerCapture?.(session.pointerId)) session.handle.releasePointerCapture(session.pointerId);
    session.ghost?.remove(); session.guide?.remove();
    session.row.classList.remove('is-stack-dragging');
    session.binding.root.classList.remove('is-stack-dragging');
    const changed = accepted && onReorder(session.owner, session.kind, session.uid, session.index);
    if (session.deferredRender && !changed) onRefresh?.();
  }
  function release(event) { finish(event, true); }
  function abort(event) { finish(event, false); }
  function cancel() { finish(null, false); }

  function prepareRender(owner) {
    // A background face-relation build can finish during a drag. Keep the
    // existing cards until release instead of destroying the active handle.
    if (drag?.active && valid(drag) && owner === drag.owner && state.mode === drag.mode && state.inspectorPage === drag.pageKey) {
      drag.deferredRender = true;
      return false;
    }
    if (drag) drag.deferredRender = false;
    cancel();
    return true;
  }

  function begin(event, binding) {
    if (event.button !== 0) return;
    const handle = event.target.closest('[data-stack-drag]');
    if (!handle || !binding.root.contains(handle)) return;
    const kind = handle.dataset.stackDrag;
    if (!['modifier', 'operator'].includes(kind) || state.mode === 'paint' && kind === 'modifier') return;
    const row = handle.closest(`[data-${kind}-card]`), page = row?.closest('.modifier-page');
    const owner = state.project.getNode(binding.ownerUid);
    if (!row || !page || !owner) return;
    cancel(); event.preventDefault(); event.stopPropagation();
    drag = { binding, owner, project: state.project, row, page, kind, handle,
      uid: handle.dataset.stackUid, x: event.clientX, y: event.clientY,
      pointerId: event.pointerId, active: false, index: 0, mode: state.mode, pageKey: state.inspectorPage };
    handle.setPointerCapture?.(event.pointerId);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', abort);
    window.addEventListener('blur', cancel);
  }

  function bind(root, owner) {
    if (!root?.addEventListener) return;
    if (drag?.binding.root === root) cancel();
    let binding = bindings.get(root);
    if (!binding) {
      // Keep only the ID between drags so an empty inspector cannot retain
      // the last closed project's objects through this persistent listener.
      binding = { root, ownerUid: owner.uid };
      binding.scroll = createListDragAutoScroll(root, () => Boolean(drag?.active && drag.binding === binding),
        pointer => { if (pointer && drag?.binding === binding) updateDrop(pointer.y); });
      bindings.set(root, binding);
      root.addEventListener('pointerdown', event => begin(event, binding));
      root.addEventListener('dragstart', event => { if (event.target.closest('[data-stack-drag]')) event.preventDefault(); });
    }
    binding.ownerUid = owner.uid;
  }
  return { bind, cancel, prepareRender };
}
