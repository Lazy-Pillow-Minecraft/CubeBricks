import { beginNumericEdit, endNumericEdit } from '../../common/core/numeric-edit-session.js';
import { incrementNumber, nextSelectIndex, numericBounds, numericStep } from './policy.js';

const NUMBER = 'input[type="number"]';
const PIXELS_PER_STEP = 4;
const DRAG_THRESHOLD = 3;
const BUTTON_WIDTH = 11;

// Paint the two spin buttons inside the input instead of wrapping it: existing
// flex/grid sizing, labels, field selectors and spinbutton accessibility survive.
export function bindNumberInputs({ getSnapStep, getAngleSnapStep, getProject,
  getShape = () => null, edgeLength = (_shape, value) => value,
  radiusFromEdge = (_shape, value) => value }, doc = document) {
  const win = doc.defaultView;
  const steps = { getSnapStep, getAngleSnapStep };
  let drag = null;
  let hover = null;
  let wheelTarget = null;
  let wheelRemainder = 0;
  let wheelAt = 0;
  const listeners = [];
  const on = (target, name, handler, options) => {
    target.addEventListener(name, handler, options);
    listeners.push(() => target.removeEventListener(name, handler, options));
  };
  const usable = input => input && !input.disabled && !input.readOnly && !input.closest('[inert]');
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const emit = (input, type) => input.dispatchEvent(new win.Event(type, { bubbles: true }));
  const endFieldBaseline = input => input.dispatchEvent(new win.FocusEvent('blur'));

  function decorate(root) {
    const inputs = root.matches?.(NUMBER) ? [root] : root.querySelectorAll?.(NUMBER) || [];
    for (const input of inputs) {
      input.classList.add('numeric-control');
      if (input.dataset.numericStep === undefined) {
        const declared = input.getAttribute('step') || '1';
        input.dataset.numericStep = declared;
        // Project/fine snapping can produce values outside the native step
        // lattice (.25 with a .1 declaration, for example). Keep the original
        // step for our policy but do not make the surrounding form unsavable.
        input.step = Number.isInteger(Number(declared)) && Number(declared) >= 1 ? '1' : 'any';
      }
      const label = input.previousElementSibling;
      if (label?.tagName === 'B' && input.parentElement.matches('.number-wrap, .axis-inputs label'))
        input.style.setProperty('--numeric-label-space', '16px');
    }
  }

  // Some property handlers redraw the entire inspector on change. Locate the
  // replacement field using its stable identity, never keep editing a dead node.
  function fieldReference(input) {
    const scope = input.closest('dialog, [data-panel], #viewport') || doc.body;
    const attributes = [...input.attributes].filter(attribute => attribute.name === 'id'
      || attribute.name === 'name' || attribute.name.startsWith('data-')
      && !['data-mixed', 'data-numeric-hover', 'data-numeric-drag', 'data-numeric-live', 'data-numeric-step'].includes(attribute.name));
    const candidates = [...scope.querySelectorAll(NUMBER)];
    const index = candidates.indexOf(input);
    return () => {
      if (input.isConnected) return input;
      if (!scope.isConnected) return null;
      if (attributes.length) return [...scope.querySelectorAll(NUMBER)].find(candidate => attributes.every(
        attribute => candidate.getAttribute(attribute.name) === attribute.value)) || null;
      return scope.querySelectorAll(NUMBER)[index] || null;
    };
  }

  function setHover(input, event) {
    if (hover && hover !== input) delete hover.dataset.numericHover;
    hover = input;
    if (!input) return;
    decorate(input);
    const rect = input.getBoundingClientRect();
    const label = Number.parseFloat(input.style.getPropertyValue('--numeric-label-space')) || 0;
    const x = event.clientX - rect.left;
    input.dataset.numericHover = x >= label && x < label + BUTTON_WIDTH ? 'decrease'
      : x >= rect.width - BUTTON_WIDTH ? 'increase' : 'drag';
  }

  function write(reference, ticks, event) {
    const input = reference();
    if (!usable(input) || !ticks) return false;
    const shape = input.dataset.parameter === 'radius' && getShape();
    const useEdge = shape?.parameters?.snapMode === 'edge';
    const current = input.value.trim() ? Number(input.value) : NaN;
    const step = numericStep(input, event, steps);
    const bounds = numericBounds(input);
    const next = useEdge
      ? Math.max(bounds.min, Math.min(bounds.max, radiusFromEdge(shape,
        incrementNumber(edgeLength(shape, current || 0), ticks, step))))
      : incrementNumber(current, ticks, step, bounds);
    if (Number.isFinite(current) && current === next) return false;
    input.value = String(next);
    delete input.dataset.mixed;
    emit(input, 'input');
    // Change-only consumers (UV, inflate, RGB, etc.) need live updates too.
    // History retention is deliberately committed only at the end of a scrub.
    if (input.dataset.numericLive !== 'input' && input.dataset.configKey !== 'application.history-limit') {
      const live = reference();
      if (live) emit(live, 'change');
    }
    const live = reference();
    if (live && drag?.reference === reference) {
      decorate(live);
      live.dataset.numericDrag = 'true';
    }
    return true;
  }

  function finishField(reference) {
    const input = reference();
    if (!input) return;
    if (input.dataset.numericLive === 'input' || input.dataset.configKey === 'application.history-limit') emit(input, 'change');
    // Existing fields use blur to end their local undo/format-edit baseline.
    // Dispatching it does not steal focus from another dock during hover-wheel.
    const live = reference();
    if (live) endFieldBaseline(live);
  }

  function once(input, ticks, event) {
    endFieldBaseline(input);
    const reference = fieldReference(input);
    const session = beginNumericEdit(getProject());
    try { if (write(reference, ticks, event)) finishField(reference); }
    finally { endNumericEdit(session); }
  }

  function finishDrag(event, cancelled = false) {
    const editing = drag;
    if (!editing) return;
    drag = null;
    if (doc.pointerLockElement === doc.documentElement) doc.exitPointerLock();
    editing.cursor.remove();
    const input = editing.reference();
    if (input) delete input.dataset.numericDrag;
    doc.documentElement.classList.remove('numeric-scrubbing');
    try {
      if (!cancelled && !editing.moved && event) {
        if (editing.button) editing.changed = write(editing.reference, editing.button, event);
        else { input?.focus({ preventScroll: true }); input?.select(); }
      }
      if (editing.changed) finishField(editing.reference);
    } finally { endNumericEdit(editing.session); }
  }

  on(doc, 'pointerdown', event => {
    if (event.button !== 0 || event.defaultPrevented || drag) return;
    const input = event.target.closest?.(NUMBER);
    if (!usable(input)) return;
    setHover(input, event);
    const button = input.dataset.numericHover === 'decrease' ? -1 : input.dataset.numericHover === 'increase' ? 1 : 0;
    consume(event);
    input.focus({ preventScroll: true });
    endFieldBaseline(input);
    const cursor = doc.createElement('div');
    cursor.className = 'numeric-drag-cursor';
    cursor.hidden = true;
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
    (input.closest('dialog[open]') || doc.body).append(cursor);
    const editing = drag = { reference: fieldReference(input), pressEvent: event, button,
      moved: false, changed: false, travel: 0, remainder: 0, locked: false, cursor,
      session: beginNumericEdit(getProject()) };
    requestDragLock(editing);
  }, true);

  function requestDragLock(editing) {
    editing.lockRequested = true;
    // Lock a stable node, not the input that may be replaced by a redraw.
    try {
      Promise.resolve(doc.documentElement.requestPointerLock()).catch(() => {
        if (drag === editing) finishDrag(editing.pressEvent);
      });
    } catch { finishDrag(editing.pressEvent); }
  }

  on(doc, 'pointerlockchange', () => {
    if (doc.pointerLockElement === doc.documentElement) {
      if (drag?.lockRequested) { drag.locked = true; drag.cursor.hidden = false; doc.documentElement.classList.add('numeric-scrubbing'); }
      else doc.exitPointerLock(); // The request completed after mouse-up.
    } else if (drag?.locked) finishDrag(null, true);
  });
  on(doc, 'pointerlockerror', () => {
    // A denied lock must not disable the spin buttons or ordinary text input.
    finishDrag(drag?.pressEvent);
  });
  on(doc, 'pointermove', event => {
    if (!drag) { setHover(usable(event.target.closest?.(NUMBER)) ? event.target.closest(NUMBER) : null, event); return; }
    consume(event);
  }, true);
  // Pointer Lock specifies mousemove deltas. Do not also process pointermove,
  // since Chromium can deliver both events for a single physical movement.
  on(doc, 'mousemove', event => {
    if (!drag) return;
    consume(event);
    if (!drag.locked) return;
    if (!drag.reference()) { finishDrag(null, true); return; }
    drag.travel += Math.abs(event.movementX);
    drag.remainder += event.movementX;
    if (drag.travel < DRAG_THRESHOLD) return;
    drag.moved = true;
    drag.cursor.classList.add('is-dragging');
    drag.reference().dataset.numericDrag = 'true';
    const ticks = Math.trunc(drag.remainder / PIXELS_PER_STEP);
    drag.remainder -= ticks * PIXELS_PER_STEP;
    if (ticks) drag.changed = write(drag.reference, ticks, event) || drag.changed;
  }, true);
  on(doc, 'pointerup', event => { if (drag) { consume(event); finishDrag(event); } }, true);
  on(doc, 'mouseup', event => { if (drag) { consume(event); finishDrag(event); } }, true);
  on(doc, 'pointercancel', () => finishDrag(null, true), true);
  on(win, 'blur', () => finishDrag(null, true));
  on(doc, 'click', event => { if (event.target.matches?.(NUMBER)) event.stopPropagation(); }, true);
  on(win, 'keydown', event => {
    if (drag) {
      if (event.key === 'Escape') finishDrag(null, true);
      consume(event);
      return;
    }
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !usable(event.target.closest?.(NUMBER))) return;
    consume(event);
    once(event.target.closest(NUMBER), event.key === 'ArrowUp' ? 1 : -1, event);
  }, true);

  on(win, 'wheel', event => {
    const target = event.target.closest?.(`${NUMBER}, select`);
    if (!usable(target) || !event.deltaY) return;
    consume(event);
    if (drag) return;
    const now = event.timeStamp;
    if (wheelTarget !== target || now - wheelAt > 180 || Math.sign(wheelRemainder) !== Math.sign(event.deltaY)) wheelRemainder = 0;
    wheelTarget = target;
    wheelAt = now;
    // Mouse-wheel notches act immediately; fine trackpad deltas accumulate.
    wheelRemainder += event.deltaMode || Math.abs(event.deltaY) >= 40 ? Math.sign(event.deltaY) * 40 : event.deltaY;
    const ticks = Math.trunc(wheelRemainder / 40);
    if (!ticks) return;
    wheelRemainder -= ticks * 40;
    if (target.tagName === 'SELECT') {
      let index = target.selectedIndex;
      for (let count = 0; count < Math.abs(ticks); count++) index = nextSelectIndex(target.options, index, Math.sign(ticks));
      if (index === target.selectedIndex) return;
      target.selectedIndex = index;
      const session = beginNumericEdit(getProject());
      try { emit(target, 'input'); emit(target, 'change'); }
      finally { endNumericEdit(session); }
    } else once(target, -ticks, event);
  }, { capture: true, passive: false });

  decorate(doc);
  const observer = new win.MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) decorate(node);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => {
    finishDrag(null, true);
    observer.disconnect();
    for (const remove of listeners) remove();
  };
}
