import { activeTextureFrame, FRAME_ROOT_UID, setFrameLayerLink } from '../common/core/frame-links.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export function createFrameConnections({ $, activeTextureAsset, noteJournalOperation, markDirty, onChange, onSelectFrame }) {
  const dialog = $('#layerEditorDialog'), layout = dialog.querySelector('.layer-editor-layout');
  const svg = $('#textureFrameConnections'), panel = $('#textureFrameEditor');
  const selections = new WeakMap();
  let scheduled = null, dragging = null;
  const element = (tag, attributes) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };
  function curve(a, b) {
    const distance = Math.max(40, Math.abs(b.x - a.x) * .5);
    return `M${a.x},${a.y} C${a.x + distance},${a.y} ${b.x - distance},${b.y} ${b.x},${b.y}`;
  }
  function select(kind, uid) {
    const asset = activeTextureAsset();
    if (asset) selections.set(asset, { kind, uid });
    render();
  }
  function portPoint(row, scroller, side, origin) {
    const rect = row.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
    const x = side === 'layer' ? (rect.right < viewport.left || rect.right > viewport.right ? viewport.right - 2 : rect.right) : rect.left, y = rect.top + rect.height / 2;
    if (y < viewport.top || y > viewport.bottom || x < viewport.left - 1 || x > viewport.right + 1) return null;
    return { x: x - origin.left, y: y - origin.top };
  }
  function draw() {
    scheduled = null;
    if (!dialog.open) return;
    const asset = activeTextureAsset(), enabled = Boolean(asset?.animation?.enabled);
    panel.hidden = !enabled;
    dialog.classList.toggle('has-texture-frames', enabled);
    dialog.querySelector('.texture-frame-gap').hidden = !enabled;
    svg.replaceChildren();
    if (!enabled) {
      dragging = null;
      return;
    }
    const origin = layout.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${origin.width} ${origin.height}`);
    const layerScroller = $('#layerEditorListHost .texture-layer-panel-scroll'), frameScroller = $('#textureFrameList');
    if (!layerScroller) return;
    const layers = new Map(), frames = new Map();
    const heading = $('#layerEditorListTitle').getBoundingClientRect();
    layers.set(FRAME_ROOT_UID, { x: layerScroller.getBoundingClientRect().right - origin.left - 2, y: heading.top + heading.height / 2 - origin.top });
    for (const row of layerScroller.querySelectorAll('[data-layer-row]')) {
      const point = portPoint(row, layerScroller, 'layer', origin);
      // A pinned header covers rows that have scrolled underneath it.
      if (point && point.y + origin.top > layerScroller.querySelector('.texture-layer-panel-header').getBoundingClientRect().bottom)
        layers.set(row.dataset.layerRow, point);
    }
    for (const row of frameScroller.querySelectorAll('[data-texture-frame]')) {
      const point = portPoint(row, frameScroller, 'frame', origin);
      if (point) frames.set(row.dataset.textureFrame, point);
    }
    const chosen = selections.get(asset) || { kind: 'frame', uid: activeTextureFrame(asset)?.uid };
    for (const frame of asset.animation.frames || []) {
      const to = frames.get(frame.uid);
      if (!to) continue;
      for (const uid of new Set(frame.layerUids || [])) {
        const from = layers.get(uid);
        if (!from) continue;
        const active = chosen?.kind === 'frame' ? chosen.uid === frame.uid : chosen?.kind === 'layer' && chosen.uid === uid;
        const d = curve(from, to);
        svg.append(element('path', { d, class: `texture-frame-link${active ? ' active' : ''}` }));
        // Stroke-only hit testing: never make the area inside the curve clickable.
        svg.append(element('path', { d, class: 'texture-frame-link-hit', 'data-frame-link': frame.uid, 'data-layer-link': uid }));
      }
    }
    if (dragging) {
      const from = (dragging.kind === 'layer' ? layers : frames).get(dragging.uid);
      if (from) {
        const cursor = { x: dragging.x - origin.left, y: dragging.y - origin.top };
        svg.append(element('path', { d: dragging.kind === 'layer' ? curve(from, cursor) : curve(cursor, from), class: 'texture-frame-link active pending' }));
      }
    }
    for (const [kind, points] of [['layer', layers], ['frame', frames]]) for (const [uid, point] of points) {
      const port = element('g', { 'data-frame-port': kind, 'data-port-uid': uid, class: 'texture-frame-port' });
      port.append(element('circle', { cx: point.x, cy: point.y, r: 10, class: 'texture-frame-port-hit' }),
        element('circle', { cx: point.x, cy: point.y, r: 4, class: 'texture-frame-port-dot' }));
      svg.append(port);
    }
  }
  function render() {
    if (!dialog.open) return;
    const enabled = Boolean(activeTextureAsset()?.animation?.enabled);
    panel.hidden = !enabled;
    dialog.classList.toggle('has-texture-frames', enabled);
    dialog.querySelector('.texture-frame-gap').hidden = !enabled;
    if (scheduled === null) scheduled = requestAnimationFrame(draw);
  }
  function mutate(frameUid, layerUid, connected) {
    const asset = activeTextureAsset();
    if (!asset) return;
    const frame = asset.animation?.frames?.find(entry => entry.uid === frameUid);
    if (!frame || Boolean(frame.layerUids?.includes(layerUid)) === connected) return;
    noteJournalOperation(connected ? 'core.texture.frame.link' : 'core.texture.frame.unlink');
    if (!setFrameLayerLink(asset, frameUid, layerUid, connected)) return;
    markDirty();
    onChange();
    render();
  }
  svg.addEventListener('pointerdown', event => {
    const port = event.target.closest('[data-frame-port]');
    if (event.button !== 0 || !port) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = {
      kind: port.dataset.framePort,
      uid: port.dataset.portUid,
      asset: activeTextureAsset(),
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    select(dragging.kind, dragging.uid);
    if (dragging.kind === 'frame') onSelectFrame(dragging.uid);
    else $('#textureFeatureControls').querySelector(`[data-layer-row="${CSS.escape(dragging.uid)}"]`)?.click();
  });
  document.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    event.preventDefault();
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    render();
  });
  document.addEventListener('pointerup', event => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const previous = dragging;
    dragging = null;
    const target = event.target.closest?.('[data-frame-port]') || document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-frame-port]');
    if (previous.asset === activeTextureAsset() && target && target.dataset.framePort !== previous.kind) {
      mutate(previous.kind === 'frame' ? previous.uid : target.dataset.portUid,
        previous.kind === 'layer' ? previous.uid : target.dataset.portUid, true);
    }
    render();
  });
  svg.addEventListener('contextmenu', event => {
    const path = event.target.closest('[data-frame-link]');
    if (!path) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    mutate(path.dataset.frameLink, path.dataset.layerLink, false);
  });
  const cancel = () => {
    dragging = null;
    render();
  };
  document.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  dialog.addEventListener('close', () => {
    dragging = null;
    if (scheduled !== null) cancelAnimationFrame(scheduled);
    scheduled = null;
  });
  dialog.addEventListener('scroll', render, true);
  window.addEventListener('resize', render);
  const observer = new ResizeObserver(render);
  observer.observe(layout);
  new MutationObserver(render).observe($('#textureFeatureControls'), { childList: true, subtree: true });
  return { render, selectFrame: uid => select('frame', uid), selectLayer: uid => select('layer', uid) };
}
