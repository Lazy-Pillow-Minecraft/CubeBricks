import { dot3 } from '../utils/math/vector3.js';

export function createCameraController({ state, $, $$, sceneCanvas, sceneRenderer, viewport,
  renderScene, toast, mapProjectionZoom, setReferenceImageEditing }) {
let cameraFocusFrame = null;
let axisWidgetDrag = null;
let suppressAxisWidgetClick = false;

function bakeCameraPan() {
  const frame = sceneRenderer.getCameraFrame();
  if (frame?.target) state.target = [...frame.target];
  state.panX = 0;
  state.panY = 0;
}

function cancelCameraFocus() {
  if (cameraFocusFrame !== null) cancelAnimationFrame(cameraFocusFrame);
  cameraFocusFrame = null;
}

function animateCameraFocus(target, duration = 250) {
  cancelCameraFocus();
  bakeCameraPan();
  const from = [...state.target];
  const to = [...target];
  const startedAt = performance.now();
  const tick = now => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = progress < .5
      ? 4 * progress ** 3
      : 1 - (-2 * progress + 2) ** 3 / 2;
    state.target = from.map((value, axis) => value + (to[axis] - value) * eased);
    renderScene();
    if (progress < 1) cameraFocusFrame = requestAnimationFrame(tick);
    else cameraFocusFrame = null;
  };
  cameraFocusFrame = requestAnimationFrame(tick);
}

function focusSelected() {
  const center = state.selectedUid && sceneRenderer.getGeometryCenter(state.project, state.selectedUid);
  if (!center) return toast('目前沒有可聚焦的物件');
  animateCameraFocus(center);
}

function focusSceneOrigin() {
  animateCameraFocus([0, 0, 0]);
}

function currentProjection() {
  return state.axisView ? 'orthographic' : state.projection;
}

function captureCameraState() {
  return {
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    yaw: state.yaw,
    pitch: state.pitch,
    target: [...state.target]
  };
}

function applyCameraState(camera) {
  if (!camera) return;
  state.zoom = Number(camera.zoom) || 1;
  state.panX = Number(camera.panX) || 0;
  state.panY = Number(camera.panY) || 0;
  state.yaw = Number(camera.yaw) || 0;
  state.pitch = Number(camera.pitch) || 0;
  state.target = Array.isArray(camera.target) ? [...camera.target] : [0, 0, 0];
}

function axisViewOrientation(axis, sign = 1) {
  if (axis === 'x') return { yaw: sign > 0 ? Math.PI / 2 : -Math.PI / 2, pitch: 0 };
  if (axis === 'y') return { yaw: 0, pitch: sign > 0 ? Math.PI / 2 - .001 : -Math.PI / 2 + .001 };
  return { yaw: sign > 0 ? 0 : Math.PI, pitch: 0 };
}

function updateProjectionControls() {
  const projection = currentProjection();
  $$('[data-projection]').forEach(button => {
    button.classList.toggle('active', button.dataset.projection === projection);
    button.disabled = Boolean(state.axisView);
    button.title = state.axisView ? '三軸視圖固定使用正交投影' : '';
  });
}

function enterAxisView(axis, sign = 1) {
  if (!['x', 'y', 'z'].includes(axis)) return;
  cancelCameraFocus();
  bakeCameraPan();
  const previousAxis = state.axisView;
  if (!previousAxis) state.generalCamera = captureCameraState();
  else state.axisViewCameras[previousAxis] = captureCameraState();
  if (previousAxis === axis) {
    state.axisViewSign *= -1;
  } else {
    const general = state.generalCamera || captureCameraState();
    const saved = state.axisViewCameras[axis];
    applyCameraState(saved || {
      ...general,
      zoom: mapProjectionZoom(general.zoom, state.projection, 'orthographic'),
      panX: 0,
      panY: 0,
      target: [...general.target]
    });
    state.axisView = axis;
    state.axisViewSign = sign < 0 ? -1 : 1;
  }
  const orientation = axisViewOrientation(axis, state.axisViewSign);
  state.yaw = orientation.yaw;
  state.pitch = orientation.pitch;
  updateProjectionControls();
  setReferenceImageEditing(false);
  renderScene();
}

function exitAxisView({ render = true } = {}) {
  if (!state.axisView) return false;
  state.axisViewCameras[state.axisView] = captureCameraState();
  applyCameraState(state.generalCamera || captureCameraState());
  state.axisView = null;
  state.axisViewSign = 1;
  state.generalCamera = null;
  updateProjectionControls();
  setReferenceImageEditing(false);
  if (render) renderScene();
  return true;
}

function updateAxisWidget() {
  const frame = sceneRenderer.getCameraFrame();
  if (!frame) return;
  const { forward, right, up } = frame;
  const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const widget = $('.axis-widget');
  const endpoints = $$('[data-view-axis]', widget).map(button => {
    const name = button.dataset.viewAxis;
    const sign = Number(button.dataset.axisSign) < 0 ? -1 : 1;
    const axis = axes[name].map(value => value * sign);
    const x = 33 + dot3(axis, right) * 22;
    const y = 33 - dot3(axis, up) * 22;
    const depth = dot3(axis, forward);
    return { button, name, sign, x, y, depth };
  }).sort((first, second) => second.depth - first.depth);
  // Camera-forward depth increases away from the viewer. Draw the far end
  // first, including pointer hit testing when the projected circles overlap.
  for (let index = 0; index < endpoints.length; index++) {
    const { button, name, sign, x, y, depth } = endpoints[index];
    const line = $(`[data-axis-line="${name}"][data-axis-sign="${sign}"]`, widget);
    line.setAttribute('x2', x); line.setAttribute('y2', y);
    line.style.opacity = String(.65 - depth * .25);
    line.parentNode.appendChild(line);
    button.style.left = `${x}px`; button.style.top = `${y}px`;
    button.style.zIndex = String(index + 1);
    button.style.setProperty('--axis-tone', `color-mix(in srgb, var(--axis-color) ${Math.round(75 - depth * 25)}%, var(--panel))`);
    const active = state.axisView === name && state.axisViewSign === sign;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  $('#viewHint').innerHTML = state.axisView
    ? '<kbd>中鍵</kbd> 平移 <kbd>Shift + 中鍵</kbd> 平移 <kbd>滾輪</kbd> 縮放 <kbd>拖動輪盤</kbd> 一般視圖'
    : state.blockbenchControls && state.mode !== 'paint'
      ? '<kbd>左鍵拖動</kbd> 旋轉 <kbd>右鍵拖動</kbd> 平移 <kbd>Shift + 左鍵</kbd> 框選 <kbd>中鍵</kbd> 旋轉／平移'
    : '<kbd>中鍵</kbd> 旋轉 <kbd>Shift + 中鍵</kbd> 平移 <kbd>滾輪</kbd> 縮放 <kbd>R</kbd> 聚焦 <kbd>Shift+R</kbd> 中心';
  updateProjectionControls();
}

function beginAxisWidgetDrag(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  cancelCameraFocus();
  const widget = event.currentTarget;
  widget.setPointerCapture(event.pointerId);
  axisWidgetDrag = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    sourceAxis: event.target.closest('[data-view-axis]')?.dataset.viewAxis || null,
    sourceSign: Number(event.target.closest('[data-view-axis]')?.dataset.axisSign) < 0 ? -1 : 1,
    yaw: state.yaw,
    pitch: state.pitch
  };
}

function moveAxisWidgetDrag(event) {
  const drag = axisWidgetDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  if (!drag.moved) {
    drag.moved = true;
    if (state.axisView) {
      exitAxisView({ render: false });
      drag.yaw = state.yaw;
      drag.pitch = state.pitch;
    }
    $('.axis-widget').classList.add('dragging');
    sceneCanvas.classList.add('is-orbiting');
  }
  const fullTurn = Math.PI * 2;
  state.yaw = ((drag.yaw - dx * .01) % fullTurn + fullTurn) % fullTurn;
  state.pitch = Math.max(-Math.PI / 2 + .001, Math.min(Math.PI / 2 - .001, drag.pitch + dy * .01));
  renderScene();
}

function endAxisWidgetDrag(event) {
  if (!axisWidgetDrag || axisWidgetDrag.pointerId !== event.pointerId) return;
  const moved = axisWidgetDrag.moved;
  const sourceAxis = axisWidgetDrag.sourceAxis;
  const sourceSign = axisWidgetDrag.sourceSign;
  const widget = event.currentTarget;
  if (widget.hasPointerCapture?.(event.pointerId)) widget.releasePointerCapture(event.pointerId);
  axisWidgetDrag = null;
  widget.classList.remove('dragging');
  sceneCanvas.classList.remove('is-orbiting');
  if (moved || sourceAxis) {
    suppressAxisWidgetClick = true;
    setTimeout(() => { suppressAxisWidgetClick = false; }, 0);
  }
  if (event.type !== 'pointercancel' && !moved && sourceAxis) enterAxisView(sourceAxis, sourceSign);
}
return { get suppressAxisWidgetClick() { return suppressAxisWidgetClick; }, bakeCameraPan,
  cancelCameraFocus, focusSelected, focusSceneOrigin, currentProjection,
  updateProjectionControls, enterAxisView, exitAxisView, updateAxisWidget,
  beginAxisWidgetDrag, moveAxisWidgetDrag, endAxisWidgetDrag };
}
