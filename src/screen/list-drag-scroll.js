export function createListDragAutoScroll(container, isDragging, onScroll = () => {}) {
  let frame = null;
  let lastTime = 0;
  let pointer = null;
  const updatePointer = event => { pointer = { x: event.clientX, y: event.clientY }; schedule(); };
  const speedAtPointer = () => {
    if (!pointer) return 0;
    const rect = container.getBoundingClientRect();
    if (pointer.y < rect.top - 64 || pointer.y > rect.bottom + 64) return 0;
    const edge = Math.min(68, Math.max(24, rect.height * .22));
    const top = Math.max(0, Math.min(1.5, (edge - (pointer.y - rect.top)) / edge));
    const bottom = Math.max(0, Math.min(1.5, (edge - (rect.bottom - pointer.y)) / edge));
    const amount = bottom - top;
    return amount ? Math.sign(amount) * (2 + 20 * amount * amount) : 0;
  };
  const tick = now => {
    frame = null;
    if (!isDragging()) return;
    const speed = speedAtPointer();
    if (speed) {
      const before = container.scrollTop;
      container.scrollTop += speed * Math.min(2, (now - (lastTime || now)) / 16.67 || 1);
      if (container.scrollTop !== before) onScroll(pointer);
    }
    lastTime = now;
    if (speed) schedule();
  };
  function schedule() { if (frame === null && isDragging()) frame = requestAnimationFrame(tick); }
  const onWheel = event => {
    if (!isDragging()) return;
    event.preventDefault();
    pointer = { x: event.clientX, y: event.clientY };
    const before = container.scrollTop;
    container.scrollTop += event.deltaY * (event.deltaMode === 1 ? 31 : event.deltaMode === 2 ? container.clientHeight : 1);
    if (container.scrollTop !== before) onScroll(pointer);
  };
  container.addEventListener('wheel', onWheel, { passive: false });
  return {
    start() {
      container.classList.add('is-drag-scrolling');
      document.addEventListener('dragover', updatePointer, true);
      document.addEventListener('pointermove', updatePointer, true);
    },
    stop() {
      document.removeEventListener('dragover', updatePointer, true);
      document.removeEventListener('pointermove', updatePointer, true);
      container.classList.remove('is-drag-scrolling');
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null; lastTime = 0; pointer = null;
    }
  };
}
