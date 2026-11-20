import { restChannel } from './channels.js';

export function animationVector(value, fallback) {
  const values = Array.isArray(value) ? value.length === 1 ? [value[0], value[0], value[0]] : value
    : typeof value === 'number' || typeof value === 'string' ? [value, value, value] : [];
  return fallback.map((number, axis) => {
    const entry = values[axis];
    if (typeof entry === 'string') return entry.trim() && Number.isFinite(Number(entry)) ? Number(entry) : entry;
    return Number.isFinite(entry) ? entry : number;
  });
}
const numericVector = (value, channel) => restChannel(channel).map((fallback, axis) => {
  const number = Number(value?.[axis]);
  return Number.isFinite(number) ? number : fallback;
});

// Molang values remain strings in the document. Until a runtime is available,
// unsupported expressions preview at the channel's rest value, never as code.
export function sampleChannel(keys, frame, channel) {
  if (!keys?.length) return restChannel(channel);
  if (frame < keys[0].frame) return numericVector(keys[0].pre || keys[0].value, channel);
  for (let index = 0; index < keys.length; index++) {
    const left = keys[index], right = keys[index + 1];
    if (frame === left.frame || !right) return numericVector(left.value, channel);
    if (frame >= right.frame) continue;
    const mix = (frame - left.frame) / (right.frame - left.frame);
    const a = numericVector(left.value, channel), b = numericVector(right.pre || right.value, channel);
    if (left.lerpMode === 'step') return a;
    if (left.lerpMode !== 'catmullrom') return a.map((value, axis) => value + (b[axis] - value) * mix);
    const p0 = numericVector(keys[index - 1]?.value || left.value, channel);
    const p3 = numericVector(keys[index + 2]?.pre || keys[index + 2]?.value || right.pre || right.value, channel);
    return a.map((value, axis) => .5 * ((2 * value) + (-p0[axis] + b[axis]) * mix
      + (2 * p0[axis] - 5 * value + 4 * b[axis] - p3[axis]) * mix * mix
      + (-p0[axis] + 3 * value - 3 * b[axis] + p3[axis]) * mix * mix * mix));
  }
  return restChannel(channel);
}
