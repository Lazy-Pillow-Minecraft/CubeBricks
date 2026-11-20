import { constrainAnimationEnd } from './model.js';

// Timeline gestures stay in their original group/clip and ignore pointer Y.
// Key and end-marker drags preview first, then record a single edit on release.
export function bindAnimationTimeline({ state, $, timeline, activeClip, selectItem, selectKey, clearKeys, setFrame, stopTimeline,
  moveKey, setEndFrame }) {
  const viewport = $('#animationTimeline');
  let drag = null, animationFrame = null, suppressEndContext = false;

  function valid(gesture) {
    return state.mode === 'animate' && state.project === gesture.project && activeClip() === gesture.clip;
  }

  function cleanup() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    viewport.classList.remove('is-key-dragging', 'is-end-dragging');
    if (drag) {
      if (drag.key) {
        drag.key.classList.remove('is-dragging');
        drag.key.style.setProperty('--animation-key-frame', String(drag.from));
      } else timeline.previewEnd(null);
      if (viewport.hasPointerCapture(drag.pointerId)) viewport.releasePointerCapture(drag.pointerId);
    }
    drag = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
  }

  function preview() {
    drag.target = Math.max(0, Math.round(timeline.frameAt(drag.clientX) + drag.offset));
    if (drag.kind === 'end') drag.target = Math.max(drag.minimum, drag.target);
    timeline.ensureFrame(drag.target);
    if (drag.key) drag.key.style.setProperty('--animation-key-frame', String(drag.target));
    else timeline.previewEnd(drag.target);
  }

  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!valid(drag)) return cleanup();
    drag.clientX = event.clientX;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) >= 3) {
      drag.moved = true;
      viewport.classList.add(drag.kind === 'end' ? 'is-end-dragging' : 'is-key-dragging');
      drag.key?.classList.add('is-dragging');
    }
    if (drag.moved || drag.kind === 'end') preview();
  }

  function autoScroll(now) {
    if (!drag || !valid(drag)) return cleanup();
    const elapsed = Math.min(50, now - drag.lastTime);
    drag.lastTime = now;
    if (drag.moved) {
      const bounds = viewport.getBoundingClientRect();
      const left = viewport.querySelector('.animation-bone-column').getBoundingClientRect().right;
      const right = bounds.left + viewport.clientWidth;
      const speed = drag.clientX < left + 32 ? -Math.min(1, (left + 32 - drag.clientX) / 32)
        : drag.clientX > right - 32 ? Math.min(1, (drag.clientX - right + 32) / 32) : 0;
      if (speed) {
        timeline.refresh();
        viewport.scrollLeft = Math.max(0, viewport.scrollLeft + speed * elapsed * .9);
        preview();
      }
    }
    animationFrame = requestAnimationFrame(autoScroll);
  }

  function finish(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    move(event);
    if (!drag) return;
    const gesture = drag;
    cleanup();
    if (!valid(gesture)) return;
    if (gesture.kind === 'end') setEndFrame(gesture.target);
    else if (gesture.moved) moveKey(gesture.uid, gesture.from, gesture.target, event.shiftKey);
  }

  function cancel(event) {
    if (!event || event.type === 'blur' || event.pointerId === drag?.pointerId) cleanup();
  }

  function capture(event) {
    // Synthetic pointers used by isolated UI tests have no native capture.
    try { viewport.setPointerCapture(event.pointerId); } catch {}
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    animationFrame = requestAnimationFrame(autoScroll);
  }

  function beginKey(event, key) {
    cleanup();
    const uid = key.dataset.groupUid, from = Number(key.dataset.animationKey);
    selectKey(uid, from, { toggle: event.ctrlKey, add: event.shiftKey });
    drag = { kind: 'key', uid, from, target: from, key, pointerId: event.pointerId, clientX: event.clientX, startX: event.clientX,
      offset: from - timeline.frameAt(event.clientX), moved: false, project: state.project, clip: activeClip(), lastTime: performance.now() };
    capture(event);
  }

  function beginEnd(event) {
    cleanup(); stopTimeline(); suppressEndContext = true;
    drag = { kind: 'end', pointerId: event.pointerId, clientX: event.clientX, startX: event.clientX,
      offset: 0, minimum: constrainAnimationEnd(activeClip(), 1), moved: false,
      project: state.project, clip: activeClip(), lastTime: performance.now() };
    preview(); capture(event);
  }

  viewport.addEventListener('pointerdown', event => {
    suppressEndContext = false;
    if (event.button === 2 && event.target.closest('[data-animation-ruler]')) {
      event.preventDefault(); event.stopPropagation();
      if (timeline.frameAt(event.clientX) < 0) { suppressEndContext = true; return; }
      if (activeClip()) { viewport.focus({ preventScroll: true }); beginEnd(event); }
      return;
    }
    if (event.button !== 0) return;
    const bone = event.target.closest('[data-animation-bone]');
    if (bone) { clearKeys(); selectItem(bone.dataset.animationBone, { toggle: event.ctrlKey, range: event.shiftKey }); return; }
    if (!activeClip()) return;
    const key = event.target.closest('[data-animation-key]');
    const track = event.target.closest('[data-animation-track]');
    if (!key && !track) return;
    if (!key && timeline.frameAt(event.clientX) < 0) { event.preventDefault(); return; }
    event.preventDefault(); viewport.focus({ preventScroll: true });
    if (key) return beginKey(event, key);
    const project = state.project, clip = activeClip();
    let clientX = event.clientX, control = event.ctrlKey;
    const updateScrub = () => {
      if (state.mode === 'animate' && state.project === project && activeClip() === clip) setFrame(timeline.frameAt(clientX), { snap: !control });
    };
    const scrub = pointer => {
      if (pointer.pointerId !== event.pointerId) return;
      clientX = pointer.clientX; control = pointer.ctrlKey; updateScrub();
    };
    const modifier = key => {
      if (key.key !== 'Control') return;
      control = key.ctrlKey || key.type === 'keydown'; updateScrub();
    };
    const cleanupScrub = () => {
      window.removeEventListener('pointermove', scrub); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', modifier); window.removeEventListener('keyup', modifier); window.removeEventListener('blur', cleanupScrub);
    };
    const end = pointer => {
      if (pointer.pointerId !== event.pointerId) return;
      cleanupScrub();
    };
    scrub(event); window.addEventListener('pointermove', scrub); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', modifier); window.addEventListener('keyup', modifier); window.addEventListener('blur', cleanupScrub);
  });

  viewport.addEventListener('contextmenu', event => {
    if (!suppressEndContext && !event.target.closest('[data-animation-ruler]')) return;
    event.preventDefault(); event.stopPropagation();
    // Windows may send contextmenu on press or release. The pointer gesture
    // owns both, including a release outside the ruler after pointer capture.
    if (suppressEndContext) return;
    if (activeClip() && timeline.frameAt(event.clientX) >= 0) setEndFrame(Math.max(0, Math.round(timeline.frameAt(event.clientX))));
  });

  viewport.addEventListener('wheel', event => {
    if (!event.ctrlKey) return;
    event.preventDefault(); event.stopPropagation();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    timeline.zoom(delta, event.clientX);
    if (drag?.moved) preview();
  }, { passive: false });
}
