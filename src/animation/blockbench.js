import { ANIMATION_CHANNELS, normalizeAnimations, restChannel } from './model.js';
import { animationVector } from './keyframes.js';

function nativeMetadata(source, projectName, tracks) {
  const definition = { animation_length: Number(source.length) || 0,
    loop: source.loop === 'loop' ? true : source.loop === 'hold' ? 'hold_on_last_frame' : false };
  for (const field of ['anim_time_update', 'blend_weight', 'start_delay', 'loop_delay']) if (source[field] !== undefined) definition[field] = structuredClone(source[field]);
  if (source.override !== undefined) definition.override_previous_animation = source.override === true;
  for (const [id, animator] of Object.entries(source.animators || {})) {
    if (id !== 'effects' && animator.type !== 'effect') continue;
    for (const key of animator.keyframes || []) {
      if (!Number.isFinite(key.time) || key.time < 0) continue;
      const field = { sound: 'sound_effects', particle: 'particle_effects', timeline: 'timeline' }[key.channel];
      if (!field) continue;
      definition[field] ||= {};
      definition[field][String(key.time)] ||= [];
      for (const point of key.data_points || []) {
        if (key.channel === 'timeline') definition[field][String(key.time)].push(String(point.script || ''));
        else definition[field][String(key.time)].push({ effect: point.effect || '', ...(point.locator ? { locator: point.locator } : {}),
          ...(key.channel === 'particle' && point.script ? { pre_effect_script: point.script } : {}) });
      }
    }
  }
  const slug = value => String(value || 'model').replace(/[^a-zA-Z0-9_.-]/g, '_');
  return { animation: definition, formatVersion: '1.8.0', document: {}, bindings: {}, preserveStarts: Object.keys(tracks),
    identifier: source.name?.startsWith('animation.') ? source.name : `animation.${slug(projectName)}.${slug(source.name)}`,
    nameAtImport: source.name, durationAtImport: Number(source.length) || 0, loopAtImport: source.loop || 'once',
    hasDynamic: Object.keys(definition).some(key => !['loop', 'animation_length'].includes(key))
      || Object.values(tracks).some(track => ANIMATION_CHANNELS.some(channel => track[channel].some(key => key.value.some(value => typeof value === 'string')))) };
}

export function importBlockbenchAnimations(animations, groups, projectName) {
  if (!Array.isArray(animations)) return [];
  const groupIds = new Set(groups.map(group => group.uid));
  return animations.map(source => {
    const fps = Math.max(1, Math.min(120, Number(source.snapping) || 24));
    const tracks = Object.create(null);
    for (const [id, animator] of Object.entries(source.animators || {})) {
      const uid = groupIds.has(id) ? id : groups.find(group => group.name === animator.name)?.uid;
      if (!uid || animator.type && animator.type !== 'bone') continue;
      const track = tracks[uid] = Object.fromEntries(ANIMATION_CHANNELS.map(channel => [channel, []]));
      for (const key of animator.keyframes || []) {
        if (!ANIMATION_CHANNELS.includes(key.channel) || !Number.isFinite(key.time) || key.time < 0) continue;
        const points = (key.data_points || []).map(point => animationVector([point.x, point.y, point.z], restChannel(key.channel)));
        track[key.channel].push({ ...structuredClone(key.cubebricks_key || {}), frame: key.time * fps, value: points.at(-1) || restChannel(key.channel),
          ...(points.length > 1 ? { pre: points[0] } : {}),
          ...(key.interpolation && key.interpolation !== 'linear' ? { lerpMode: key.interpolation } : {}) });
      }
    }
    const raw = structuredClone(source); delete raw.cubebricks_native;
    return normalizeAnimations([{ uid: source.uuid || crypto.randomUUID(), name: source.name || 'animation',
      fps, length: Math.max(0, Number(source.length) || 0) * fps, loop: source.loop || 'once', tracks,
      preserveStarts: Object.keys(tracks), blockbench: raw,
      native: source.cubebricks_native ? structuredClone(source.cubebricks_native) : nativeMetadata(source, projectName, tracks) }])[0];
  });
}

export function exportBlockbenchAnimations(clips, groups) {
  const names = new Map(groups.map(group => [group.uid, group.name]));
  return clips.map(clip => {
    const source = structuredClone(clip.blockbench || {}), animators = { ...(source.animators || {}) };
    for (const [uid, track] of Object.entries(clip.tracks)) {
      if (!names.has(uid)) continue;
      const keyframes = ANIMATION_CHANNELS.flatMap(channel => (track[channel] || []).map(key => {
        const point = value => Object.fromEntries(['x', 'y', 'z'].map((axis, index) => [axis, value[index]]));
        return { channel, time: key.frame / clip.fps, interpolation: key.lerpMode || 'linear',
          ...(key.nativeData ? { cubebricks_key: { nativeData: structuredClone(key.nativeData) } } : {}),
          data_points: [...(key.pre ? [point(key.pre)] : []), point(key.value)] };
      }));
      animators[uid] = { ...animators[uid], type: 'bone', name: names.get(uid), keyframes };
    }
    return { ...source, uuid: clip.uid, name: clip.name, loop: clip.loop || 'loop', length: clip.length / clip.fps,
      snapping: clip.fps, animators, ...(clip.native ? { cubebricks_native: structuredClone(clip.native) } : {}) };
  });
}
