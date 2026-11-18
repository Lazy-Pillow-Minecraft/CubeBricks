// Report the signed input along the dragged handle, before it is distributed
// over model axes, mirrored around a center or clamped by individual objects.
export function signedDragDistance(components) {
  const dominant = components.reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, 0);
  return Math.hypot(...components) * Math.sign(dominant);
}

export function transformFeedback(drag, { formatSigned }) {
  return `${formatSigned(drag.feedbackDelta || 0)}${drag.tool === 'rotate' ? '°' : ' px'}`;
}
