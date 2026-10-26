import { applyGroupTransforms } from '../render/webgl-renderer.js';
import { cross3, normalize3 } from '../utils/math/vector3.js';
import { rotateVector } from '../utils/math/rotation.js';

export function createMirrorGuideController({ state, $, sceneCanvas, sceneRenderer, selected,
  isShapeElement, projectViewportPoint, addScaled3, clamp }) {
let mirrorGuideGroupUid = null;
let mirrorGuideEntryUid = null;
let mirrorGuideHoldTimer = null;
let mirrorGuideHideTimer = null;

function visibleMirrorGuidePage() {
  const paintMode = state.mode === 'paint';
  const panel = $(`[data-panel="${paintMode ? 'paintOperators' : 'inspector'}"]`);
  if (!panel || panel.hidden || panel.classList.contains('is-stack-inactive')
    || panel.classList.contains('is-collapsed')
    || panel.closest('.is-zone-collapsed')) return null;
  if (paintMode) return 'operators';
  return state.inspectorPage === 'operators' || state.inspectorPage === 'modifiers'
    ? state.inspectorPage : null;
}

function selectedMirrorGuideGroup() {
  const page = visibleMirrorGuidePage();
  if (!page) return null;
  const owner = selected();
  const entries = page === 'operators' ? owner?.operators || [] : owner?.modifiers || [];
  const isSymmetry = entry => ['symmetry', 'paint_symmetry'].includes(entry.type) && entry.enabled;
  const modifier = entries.find(entry => entry.uid === state.selectedModifierUid && isSymmetry(entry))
    || entries.find(isSymmetry);
  return modifier?.enabled ? { owner, modifier } : null;
}

function mirrorControllerWorldFrame(owner, modifier) {
  if (!owner || !modifier?.anchor) return null;
  const chain = state.project.getGroupChain(owner.uid);
  const pivot = owner.type === 'group' || owner.type === 'cube' || isShapeElement(owner) ? owner.pivot : owner.origin || owner.position || [0, 0, 0];
  const ownerRotation = owner.rotation || [0, 0, 0];
  const offset = modifier.anchor.position.map((value, axis) => value - pivot[axis]);
  const localOrigin = rotateVector(offset, ownerRotation).map((value, axis) => value + pivot[axis]);
  const rotateDirection = direction => normalize3(applyGroupTransforms(
    rotateVector(rotateVector(direction, modifier.anchor.rotation || [0, 0, 0]), ownerRotation),
    chain.map(parent => ({ pivot: [0, 0, 0], rotation: parent.rotation || [0, 0, 0] }))
  ));
  return {
    origin: applyGroupTransforms(localOrigin, chain),
    axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(rotateDirection)
  };
}

function symmetryModifierAngles(modifier) {
  const count = Math.max(1, Math.min(256, Math.round(Number(modifier.copies) || 1)));
  if (modifier.distribution !== 'range') return Array.from({ length: count }, (_, index) => index * 360 / count);
  const start = Number(modifier.rangeStart) || 0;
  const end = Number(modifier.rangeEnd) || 0;
  if (count === 1) return [start];
  return Array.from({ length: count }, (_, index) => start + (end - start) * index / (count - 1));
}

function mirrorProjectedSegment(start, end) {
  const first = projectViewportPoint(start), second = projectViewportPoint(end);
  if (first.behind || second.behind) return '';
  return `M${first.x.toFixed(1)},${first.y.toFixed(1)}L${second.x.toFixed(1)},${second.y.toFixed(1)}`;
}

function mirrorGridPlaneMarkup(origin, firstAxis, secondAxis, className) {
  const size = 24, step = 4;
  const minor = [], major = [];
  for (let offset = -size; offset <= size + .001; offset += step) {
    const firstStart = addScaled3(addScaled3(origin, firstAxis, -size), secondAxis, offset);
    const firstEnd = addScaled3(addScaled3(origin, firstAxis, size), secondAxis, offset);
    const secondStart = addScaled3(addScaled3(origin, secondAxis, -size), firstAxis, offset);
    const secondEnd = addScaled3(addScaled3(origin, secondAxis, size), firstAxis, offset);
    const target = Math.abs(offset) < .001 || Math.abs(offset % 8) < .001 ? major : minor;
    const firstPath = mirrorProjectedSegment(firstStart, firstEnd);
    const secondPath = mirrorProjectedSegment(secondStart, secondEnd);
    if (firstPath) target.push(firstPath);
    if (secondPath) target.push(secondPath);
  }
  return `<g class="mirror-guide ${className}">
    <path class="mirror-grid-minor" d="${minor.join('')}"/>
    <path class="mirror-grid-major" d="${major.join('')}"/>
  </g>`;
}

function mirrorInfiniteLineMarkup(origin, direction, width, height, className, ray = false) {
  return finiteWorldGuideMarkup(origin, direction, `mirror-guide ${className} ${ray ? 'mirror-ray' : 'mirror-axis-line'}`, ray);
}

function finiteWorldGuideMarkup(origin, direction, className, ray = false) {
  if (!origin || !direction) return '';
  const cameraForward = sceneRenderer.getCameraFrame()?.forward;
  const viewFade = cameraForward ? clamp(Math.hypot(...cross3(normalize3(direction), cameraForward)) * 20, 0, 1) : 1;
  const limit = 2048;
  const positive = [0, ...Array.from({ length: 29 }, (_, index) => .125 * 2 ** (index / 2)), ...Array.from({ length: 13 }, (_, index) => limit * (.7 + index * .025))];
  const distances = [...new Set(positive.filter(value => value <= limit))].sort((a, b) => a - b);
  const samples = ray ? distances : [...distances.slice(1).reverse().map(value => -value), ...distances];
  const projected = samples.map(distance => ({ distance, point: projectViewportPoint(addScaled3(origin, direction, distance)) }));
  const lines = [];
  for (let index = 1; index < projected.length; index++) {
    const first = projected[index - 1], second = projected[index];
    if (first.point.behind || second.point.behind || first.point.depth < -1 || second.point.depth < -1) continue;
    if (!Number.isFinite(first.point.x + first.point.y + second.point.x + second.point.y)) continue;
    if (Math.hypot(second.point.x - first.point.x, second.point.y - first.point.y) < .05) continue;
    const distance = Math.max(Math.abs(first.distance), Math.abs(second.distance));
    const opacity = clamp((limit - distance) / (limit * .3), 0, 1) * viewFade;
    lines.push(`<line class="${className}" style="opacity:${opacity}" x1="${first.point.x}" y1="${first.point.y}" x2="${second.point.x}" y2="${second.point.y}"/>`);
  }
  return lines.join('');
}

function renderMirrorGuide(entry) {
  const overlay = $('#mirrorGuideOverlay');
  const { owner, modifier } = entry;
  const frame = mirrorControllerWorldFrame(owner, modifier);
  if (!frame) { overlay.innerHTML = ''; return false; }
  const rect = sceneCanvas.getBoundingClientRect();
  const width = rect.width, height = rect.height;
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const [xAxis, yAxis, zAxis] = frame.axes;
  const markup = [];
  if (modifier.mode === 'axes') {
    const definitions = [
      ['x', xAxis, yAxis, zAxis],
      ['y', yAxis, zAxis, xAxis],
      ['z', zAxis, xAxis, yAxis]
    ];
    for (const [axisName, normal, first, second] of definitions) {
      if (!modifier.axes[axisName]) continue;
      markup.push(mirrorGridPlaneMarkup(frame.origin, first, second, `axis-${axisName}`));
      markup.push(mirrorInfiniteLineMarkup(frame.origin, normal, width, height, `axis-${axisName}`));
    }
  } else {
    markup.push(mirrorInfiniteLineMarkup(frame.origin, yAxis, width, height, 'radial-axis'));
    const angles = symmetryModifierAngles(modifier);
    for (const degrees of angles) {
      const radians = degrees * Math.PI / 180;
      const radial = normalize3(xAxis.map((value, axis) => value * Math.cos(radians) + zAxis[axis] * Math.sin(radians)));
      markup.push(mirrorGridPlaneMarkup(frame.origin, yAxis, radial, 'radial-plane'));
      markup.push(mirrorInfiniteLineMarkup(frame.origin, radial, width, height, 'radial-ray', true));
    }
  }
  overlay.innerHTML = markup.join('');
  return Boolean(markup.length);
}

function updateMirrorGuideOverlay() {
  const overlay = $('#mirrorGuideOverlay');
  if (!visibleMirrorGuidePage()) {
    clearTimeout(mirrorGuideHoldTimer);
    clearTimeout(mirrorGuideHideTimer);
    mirrorGuideHoldTimer = null;
    mirrorGuideHideTimer = null;
    mirrorGuideGroupUid = null;
    mirrorGuideEntryUid = null;
    overlay.classList.remove('visible');
    overlay.setAttribute('hidden', '');
    overlay.innerHTML = '';
    return;
  }
  const activeGroup = selectedMirrorGuideGroup();
  if (activeGroup) {
    clearTimeout(mirrorGuideHoldTimer);
    clearTimeout(mirrorGuideHideTimer);
    mirrorGuideHoldTimer = null;
    mirrorGuideHideTimer = null;
    mirrorGuideGroupUid = activeGroup.owner.uid;
    mirrorGuideEntryUid = activeGroup.modifier.uid;
    const visible = renderMirrorGuide(activeGroup);
    overlay.toggleAttribute('hidden', !visible);
    if (visible) requestAnimationFrame(() => overlay.classList.add('visible'));
    return;
  }
  const previousOwner = mirrorGuideGroupUid && state.project.getNode(mirrorGuideGroupUid);
  const previousModifier = [...(previousOwner?.modifiers || []), ...(previousOwner?.operators || [])]
    .find(entry => entry.uid === mirrorGuideEntryUid);
  if (!previousModifier?.enabled) {
    overlay.classList.remove('visible');
    overlay.setAttribute('hidden', '');
    overlay.innerHTML = '';
    mirrorGuideGroupUid = null;
    mirrorGuideEntryUid = null;
    return;
  }
  renderMirrorGuide({ owner: previousOwner, modifier: previousModifier });
  if (mirrorGuideHoldTimer || mirrorGuideHideTimer) return;
  mirrorGuideHoldTimer = setTimeout(() => {
    mirrorGuideHoldTimer = null;
    overlay.classList.remove('visible');
    mirrorGuideHideTimer = setTimeout(() => {
      mirrorGuideHideTimer = null;
      if (selectedMirrorGuideGroup()) return;
      overlay.setAttribute('hidden', '');
      overlay.innerHTML = '';
      mirrorGuideGroupUid = null;
      mirrorGuideEntryUid = null;
    }, 340);
  }, 1500);
}
return { selectedMirrorGuideGroup, mirrorControllerWorldFrame, symmetryModifierAngles,
  finiteWorldGuideMarkup, updateMirrorGuideOverlay };
}
