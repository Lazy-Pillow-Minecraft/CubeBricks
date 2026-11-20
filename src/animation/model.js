import { rotateVector, inverseRotateVector } from '../utils/math/rotation.js';
import { ANIMATION_CHANNELS, restChannel } from './channels.js';
import { animationVector, sampleChannel } from './keyframes.js';
import { ANIMATION_LOOP_MODES } from './playback.js';
export { ANIMATION_CHANNELS, restChannel } from './channels.js';
export { sampleChannel } from './keyframes.js';

export function lastAnimationFrame(clip) {
  let frame = 0;
  for (const track of Object.values(clip?.tracks || {})) for (const channel of ANIMATION_CHANNELS) {
    for (const key of track?.[channel] || []) if (Number.isFinite(key.frame)) frame = Math.max(frame, key.frame);
  }
  return frame;
}
export function constrainAnimationEnd(clip, frame) {
  return Math.max(0, lastAnimationFrame(clip), Number(frame) || 0);
}
export function keyedChannel(clip, uid, channel, frame) {
  const key = clip?.tracks?.[uid]?.[channel]?.find(entry => Math.abs(entry.frame - frame) < 1e-8);
  return key ? [...key.value] : null;
}
// A row with later keys needs one explicit rest frame. An existing frame zero
// is authoritative, even when it defines only one of the three channels.
export function ensureAnimationStart(clip, uid) {
  const track = clip.tracks[uid];
  if (clip.native?.preserveStarts?.includes(uid) || clip.preserveStarts?.includes(uid)) return false;
  if (!track || ANIMATION_CHANNELS.some(channel => track[channel]?.some(key => key.frame === 0))
    || !ANIMATION_CHANNELS.some(channel => track[channel]?.some(key => key.frame > 0))) return false;
  for (const channel of ANIMATION_CHANNELS) (track[channel] ||= []).unshift({ frame: 0, value: restChannel(channel) });
  return true;
}
export function normalizeAnimations(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(clip => clip && typeof clip === 'object').map((clip, index) => {
    const animation = {
      ...structuredClone(clip),
      uid: typeof clip.uid === 'string' ? clip.uid : crypto.randomUUID(),
      name: String(clip.name || `animation_${index + 1}`),
      fps: Math.max(1, Math.min(120, Number(clip.fps) || 24)),
      length: Number.isFinite(Number(clip.length)) ? Math.max(0, Number(clip.length)) : 24,
      loop: ANIMATION_LOOP_MODES.includes(clip.loop) ? clip.loop : 'loop',
      tracks: Object.fromEntries(Object.entries(clip.tracks || {}).map(([uid, track]) => [uid,
        Object.fromEntries(ANIMATION_CHANNELS.map(channel => {
          const keys = new Map();
          for (const key of Array.isArray(track?.[channel]) ? track[channel] : []) {
            if (!Number.isFinite(Number(key.frame)) || key.frame < 0) continue;
            keys.set(Number(key.frame), { ...structuredClone(key), frame: Number(key.frame), value: animationVector(key.value, restChannel(channel)),
              ...(key.pre !== undefined ? { pre: animationVector(key.pre, restChannel(channel)) } : {}) });
          }
          return [channel, [...keys].sort((a, b) => a[0] - b[0]).map(([, key]) => key)];
        }))
      ]))
    };
    for (const uid of Object.keys(animation.tracks)) ensureAnimationStart(animation, uid);
    animation.length = constrainAnimationEnd(animation, animation.length);
    return animation;
  });
}
export function sampleGroup(clip, uid, frame) {
  return Object.fromEntries(ANIMATION_CHANNELS.map(channel => [channel, sampleChannel(clip?.tracks?.[uid]?.[channel], frame, channel)]));
}
export function setAnimationKey(clip, uid, channel, frame, value) {
  if (!ANIMATION_CHANNELS.includes(channel)) return;
  frame = Math.max(0, frame);
  if (!Number.isFinite(frame)) return;
  const track = clip.tracks[uid] ||= Object.fromEntries(ANIMATION_CHANNELS.map(name => [name, []]));
  const keys = track[channel] ||= [];
  const key = keys.find(entry => entry.frame === frame);
  if (key) key.value = [...value];
  else keys.push({ frame, value: [...value] });
  keys.sort((a, b) => a.frame - b.frame);
  ensureAnimationStart(clip, uid);
  clip.length = Math.max(clip.length, frame);
}
// A timeline marker carries every channel keyed at that frame. A moved channel
// replaces its destination key; unrelated destination channels remain intact.
export function moveAnimationKey(clip, uid, from, to, clampToEnd = false) {
  const track = clip.tracks[uid];
  to = Math.max(0, Math.round(to));
  if (clampToEnd) to = Math.min(to, clip.length);
  if (!track || from === to || !Number.isFinite(to)) return false;
  let moved = false;
  for (const channel of ANIMATION_CHANNELS) {
    const key = track[channel]?.find(entry => entry.frame === from);
    if (!key) continue;
    track[channel] = track[channel].filter(entry => entry.frame !== from && entry.frame !== to);
    track[channel].push({ ...key, frame: to, value: [...key.value] });
    track[channel].sort((a, b) => a.frame - b.frame);
    moved = true;
  }
  if (moved) {
    ensureAnimationStart(clip, uid);
    if (!clampToEnd) clip.length = Math.max(clip.length, to);
  }
  return moved;
}
// Preview state never enters serialization, history snapshots or exports.
export function setGroupAnimationPose(group, pose) {
  if (!pose) { delete group._animationPose; return; }
  Object.defineProperty(group, '_animationPose', { value: pose, writable: true, configurable: true, enumerable: false });
}
// Bedrock adds the animation's Euler channels to the geometry's rest angles.
// Translation is in the parent's frame, independent of this bone's rotation.
export function animationGroupRotation(group, pose = group._animationPose) {
  return (group.rotation || [0, 0, 0]).map((value, axis) => value + (pose?.rotation[axis] || 0));
}
export function animationPoseRotation(group, rotation) {
  return rotation.map((value, axis) => value - (group.rotation?.[axis] || 0));
}
export function animationGroupPoint(point, group) {
  const pivot = group.pivot, pose = group._animationPose;
  let local = point.map((value, axis) => value - pivot[axis]);
  if (pose) local = local.map((value, axis) => value * pose.scale[axis]);
  return rotateVector(local, animationGroupRotation(group)).map((value, axis) => value + pivot[axis] + (pose?.position[axis] || 0));
}
export function inverseAnimationGroupPoint(point, group) {
  const pivot = group.pivot, pose = group._animationPose;
  let local = inverseRotateVector(point.map((value, axis) => value - pivot[axis] - (pose?.position[axis] || 0)), animationGroupRotation(group));
  if (pose) local = local.map((value, axis) => Math.abs(pose.scale[axis]) > 1e-9 ? value / pose.scale[axis] : 0);
  return local.map((value, axis) => value + pivot[axis]);
}
export function animationLocalDelta(project, group, delta) {
  let zero = [0, 0, 0], point = [...delta];
  for (const parent of project.getGroupChain(group.uid)) {
    zero = inverseAnimationGroupPoint(zero, parent);
    point = inverseAnimationGroupPoint(point, parent);
  }
  return point.map((value, axis) => value - zero[axis]);
}
// Directions for gizmos and rotation edits use rotation only. Geometry and
// position deltas keep the full matrix, including parent scale and translation.
export function animationGroupDirection(direction, group) {
  return rotateVector(direction, animationGroupRotation(group));
}
export function animationLocalDirection(project, group, direction) {
  let local = [...direction];
  for (const parent of project.getGroupChain(group.uid)) {
    local = inverseRotateVector(local, animationGroupRotation(parent));
  }
  return local;
}
