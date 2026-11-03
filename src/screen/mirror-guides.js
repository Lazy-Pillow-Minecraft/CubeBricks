import { applyGroupTransforms } from '../common/core/geometry-utils.js';
import { cross3, normalize3 } from '../utils/math/vector3.js';
import { rotateVector } from '../utils/math/rotation.js';

export function createMirrorGuideController({ state, $, sceneCanvas, sceneRenderer, selected,
  isShapeElement, projectViewportPoint, addScaled3, clamp }) {
let mirrorGuideGroupUid = null;
let mirrorGuideEntryUid = null;
let mirrorGuideHoldTimer = null;
let mirrorGuideHideTimer = null;
let lastGuideMarkup = '';
const guideLimit = 2048;
const positiveGuideDistances = [0,
  ...Array.from({ length: 29 }, (_, index) => .125 * 2 ** (index / 2)),
  ...Array.from({ length: 13 }, (_, index) => guideLimit * (.7 + index * .025))]
  .filter(value => value <= guideLimit);
const guideDistances = [...new Set(positiveGuideDistances)].sort((a, b) => a - b);

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
  if (modifier.type === 'element_copy') {
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(direction => normalize3(applyGroupTransforms(
      rotateVector(direction, modifier.anchor.rotation || [0, 0, 0]),
      chain.map(parent => ({ pivot: [0, 0, 0], rotation: parent.rotation || [0, 0, 0] })))));
    return { origin: applyGroupTransforms(modifier.anchor.position, chain), axes };
  }
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

function mirrorGridPlaneMarkup(origin, firstAxis, secondAxis, className, collector = null) {
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
  if (collector) {
    for (const [kind, paths] of [['minor', minor], ['major', major]]) {
      if (!paths.length) continue;
      const key = `${className}\u0000${kind}`;
      collector.set(key, (collector.get(key) || '') + paths.join(''));
    }
    return '';
  }
  return `<g class="mirror-guide ${className}">
    <path class="mirror-grid-minor" d="${minor.join('')}"/>
    <path class="mirror-grid-major" d="${major.join('')}"/>
  </g>`;
}

function mirrorInfiniteLineMarkup(origin, direction, width, height, className, ray = false, collector = null) {
  return finiteWorldGuideMarkup(origin, direction, `mirror-guide ${className} ${ray ? 'mirror-ray' : 'mirror-axis-line'}`, ray, collector);
}

function finiteWorldGuideMarkup(origin, direction, className, ray = false, collector = null) {
  if (!origin || !direction) return '';
  const cameraForward = sceneRenderer.getCameraFrame()?.forward;
  const viewFade = cameraForward ? clamp(Math.hypot(...cross3(normalize3(direction), cameraForward)) * 20, 0, 1) : 1;
  const samples = ray ? guideDistances : [...guideDistances.slice(1).reverse().map(value => -value), ...guideDistances];
  const projected = samples.map(distance => ({ distance, point: projectViewportPoint(addScaled3(origin, direction, distance)) }));
  const paths = Array.from({ length: 12 }, () => []);
  for (let index = 1; index < projected.length; index++) {
    const first = projected[index - 1], second = projected[index];
    if (first.point.behind || second.point.behind || first.point.depth < -1 || second.point.depth < -1) continue;
    if (!Number.isFinite(first.point.x + first.point.y + second.point.x + second.point.y)) continue;
    if (Math.hypot(second.point.x - first.point.x, second.point.y - first.point.y) < .05) continue;
    const distance = Math.max(Math.abs(first.distance), Math.abs(second.distance));
    const opacity = clamp((guideLimit - distance) / (guideLimit * .3), 0, 1) * viewFade;
    if (opacity < .01) continue;
    const bucket = Math.max(0, Math.min(11, Math.ceil(opacity * 12) - 1));
    paths[bucket].push(`M${first.point.x},${first.point.y}L${second.point.x},${second.point.y}`);
  }
  if (collector) {
    paths.forEach((parts, bucket) => {
      if (!parts.length) return;
      const key = `${className}\u0000${bucket}`;
      collector.set(key, (collector.get(key) || '') + parts.join(''));
    });
    return '';
  }
  return paths.map((parts, bucket) => parts.length
    ? `<path class="${className}" style="opacity:${(bucket + 1) / 12}" d="${parts.join('')}"/>` : '').join('');
}

function renderMirrorGuide(entry) {
  const overlay = $('#mirrorGuideOverlay');
  const { owner, modifier } = entry;
  const frame = mirrorControllerWorldFrame(owner, modifier);
  if (!frame) { overlay.innerHTML = ''; lastGuideMarkup = ''; return false; }
  const rect = sceneRenderer.lastCanvasRect || sceneCanvas.getBoundingClientRect();
  const width = rect.width, height = rect.height;
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const [xAxis, yAxis, zAxis] = frame.axes;
  const markup = [];
  const gridPaths = new Map();
  const linePaths = new Map();
  if (modifier.mode === 'axes') {
    const definitions = [
      ['x', xAxis, yAxis, zAxis],
      ['y', yAxis, zAxis, xAxis],
      ['z', zAxis, xAxis, yAxis]
    ];
    for (const [axisName, normal, first, second] of definitions) {
      if (!modifier.axes[axisName]) continue;
      mirrorGridPlaneMarkup(frame.origin, first, second, `axis-${axisName}`, gridPaths);
      mirrorInfiniteLineMarkup(frame.origin, normal, width, height, `axis-${axisName}`, false, linePaths);
    }
  } else {
    mirrorInfiniteLineMarkup(frame.origin, yAxis, width, height, 'radial-axis', false, linePaths);
    const angles = symmetryModifierAngles(modifier);
    for (const degrees of angles) {
      const radians = degrees * Math.PI / 180;
      const radial = normalize3(xAxis.map((value, axis) => value * Math.cos(radians) + zAxis[axis] * Math.sin(radians)));
      mirrorGridPlaneMarkup(frame.origin, yAxis, radial, 'radial-plane', gridPaths);
      mirrorInfiniteLineMarkup(frame.origin, radial, width, height, 'radial-ray', true, linePaths);
    }
  }
  for (const [key, points] of gridPaths) {
    const [className, kind] = key.split('\u0000');
    markup.push(`<path class="mirror-guide ${className} mirror-grid-${kind}" d="${points}"/>`);
  }
  for (const [key, points] of linePaths) {
    const [className, bucket] = key.split('\u0000');
    markup.push(`<path class="${className}" style="opacity:${(Number(bucket) + 1) / 12}" d="${points}"/>`);
  }
  const nextMarkup = markup.join('');
  if (nextMarkup !== lastGuideMarkup) {
    overlay.innerHTML = nextMarkup;
    lastGuideMarkup = nextMarkup;
  }
  return Boolean(markup.length);
}

function updateMirrorGuideOverlay() {
  const overlay = $('#mirrorGuideOverlay');
  if (!visibleMirrorGuidePage()) {
    if (!mirrorGuideHoldTimer && !mirrorGuideHideTimer && !mirrorGuideGroupUid
      && overlay.hasAttribute('hidden') && !lastGuideMarkup
      && !overlay.classList.contains('visible')) return;
    clearTimeout(mirrorGuideHoldTimer);
    clearTimeout(mirrorGuideHideTimer);
    mirrorGuideHoldTimer = null;
    mirrorGuideHideTimer = null;
    mirrorGuideGroupUid = null;
    mirrorGuideEntryUid = null;
    overlay.classList.remove('visible');
    overlay.setAttribute('hidden', '');
    overlay.innerHTML = '';
    lastGuideMarkup = '';
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
    if (visible && !overlay.classList.contains('visible')) requestAnimationFrame(() => overlay.classList.add('visible'));
    return;
  }
  const previousOwner = mirrorGuideGroupUid && state.project.getNode(mirrorGuideGroupUid);
  const previousModifier = [...(previousOwner?.modifiers || []), ...(previousOwner?.operators || [])]
    .find(entry => entry.uid === mirrorGuideEntryUid);
  if (!previousModifier?.enabled) {
    if (!mirrorGuideGroupUid && overlay.hasAttribute('hidden') && !lastGuideMarkup
      && !overlay.classList.contains('visible')) return;
    overlay.classList.remove('visible');
    overlay.setAttribute('hidden', '');
    overlay.innerHTML = '';
    lastGuideMarkup = '';
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
      lastGuideMarkup = '';
      mirrorGuideGroupUid = null;
      mirrorGuideEntryUid = null;
    }, 340);
  }, 1500);
}
return { selectedMirrorGuideGroup, mirrorControllerWorldFrame, symmetryModifierAngles,
  finiteWorldGuideMarkup, updateMirrorGuideOverlay };
}
