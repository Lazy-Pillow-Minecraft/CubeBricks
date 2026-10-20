import { formatRules } from '../common/core/format-constraints.js';

export function createSnapController({ state, $, noteJournalOperation, markDirty, toast }) {
function activeSnapSubdivisions() {
  const projectValue = Number(state.project.snap?.subdivisions);
  return Number.isFinite(projectValue) && projectValue > 0 ? projectValue : state.settingsSnap;
}

function updateSnapButton() {
  const value = activeSnapSubdivisions();
  $('#snapButton').textContent = `吸附 ${formatNumber(value)} · ${formatNumber(16 / value)}px`;
}

function cycleSnap(direction = 1) {
  const values = [4, 8, 16, 32, 64];
  const currentIndex = values.indexOf(activeSnapSubdivisions());
  const nextIndex = currentIndex < 0
    ? direction < 0 ? values.length - 1 : 0
    : (currentIndex + direction + values.length) % values.length;
  const next = values[nextIndex];
  noteJournalOperation('core.project.snap');
  if (!state.project.snap) state.project.snap = {};
  state.project.snap.subdivisions = next;
  updateSnapButton();
  markDirty();
  toast(`吸附精度 ${next}（${formatNumber(16 / next)} px）`);
}

function getSnapSubdivisions(event = {}) {
  const standard = activeSnapSubdivisions();
  const modifier = event.shiftKey && event.ctrlKey
    ? state.modifierSnap.shiftCtrl
    : event.shiftKey
      ? state.modifierSnap.shift
      : event.ctrlKey
        ? state.modifierSnap.ctrl
        : null;
  if (!modifier) return standard;
  return modifier.mode === 'multiplier' ? standard * modifier.value : modifier.value;
}

function getSnapStep(event = {}) { return 16 / Math.max(.0001, getSnapSubdivisions(event)); }
function snapValue(value, event) { const step = getSnapStep(event); return Math.round(value / step) * step; }
function getAngleSnapStep(event = {}) {
  const requiredStep = formatRules(state.project).rotationStep;
  if (requiredStep) return requiredStep;
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.shiftKey && ctrl) return .05;
  if (event.shiftKey) return .5;
  if (ctrl) return 15;
  return 2.5;
}

function polyhedronEdgeLength(shape, radius) {
  const value = Math.max(0, Number(radius) || 0);
  if (shape?.shapeType === 'dodecahedron') return value * 4 / (Math.sqrt(3) * (1 + Math.sqrt(5)));
  if (shape?.shapeType === 'truncated_icosahedron') return value * 4 / Math.sqrt(58 + 18 * Math.sqrt(5));
  const sides = Math.max(3, Math.round(Number(shape?.parameters?.sides) || 3));
  return value * 2 * Math.sin(Math.PI / sides);
}

function radiusFromPolyhedronEdge(shape, edgeLength) {
  const unitEdge = polyhedronEdgeLength(shape, 1);
  return unitEdge > 1e-8 ? edgeLength / unitEdge : 0;
}

function snapShapeDimension(shape, key, value, event = {}) {
  if (key !== 'radius') return snapValue(value, event);
  if (shape?.parameters?.snapMode === 'radius') return snapValue(value, event);
  return radiusFromPolyhedronEdge(shape, snapValue(polyhedronEdgeLength(shape, value), event));
}
function snapAngle(value, step) { return Math.round(value / step) * step; }
function formatNumber(value) { return Number(value.toFixed(4)).toString(); }
function formatSigned(value) { const rounded = formatNumber(value); return value > 0 ? `+${rounded}` : rounded; }

return {
  activeSnapSubdivisions,
  updateSnapButton,
  cycleSnap,
  getSnapSubdivisions,
  getSnapStep,
  snapValue,
  getAngleSnapStep,
  polyhedronEdgeLength,
  radiusFromPolyhedronEdge,
  snapShapeDimension,
  snapAngle,
  formatNumber,
  formatSigned,
};
}
