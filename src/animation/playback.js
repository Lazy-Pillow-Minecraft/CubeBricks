export const ANIMATION_LOOP_MODES = ['once', 'hold', 'loop'];

export function advanceAnimation(clip, frame, seconds) {
  const end = Math.max(0, clip.length), next = frame + Math.max(0, seconds) * clip.fps;
  if (!end) return { frame: 0, playing: false };
  if (next < end) return { frame: next, playing: true };
  if (clip.loop === 'loop' || clip.loop === undefined) return { frame: next % end, playing: true };
  return { frame: clip.loop === 'hold' ? end : 0, playing: false };
}

// FPS is the editing grid. Preserve seconds when the grid changes.
export function setAnimationFps(clip, fps) {
  const next = Math.max(1, Math.min(120, fps)), ratio = next / clip.fps;
  if (!Number.isFinite(next) || next === clip.fps) return 1;
  for (const track of Object.values(clip.tracks)) for (const channel of ['position', 'rotation', 'scale']) {
    for (const key of track[channel] || []) key.frame *= ratio;
  }
  clip.length *= ratio; clip.fps = next;
  return ratio;
}
