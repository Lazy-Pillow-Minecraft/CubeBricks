import { ANIMATION_CHANNELS, restChannel } from './channels.js';
import { animationVector } from './keyframes.js';
import { normalizeAnimations } from './model.js';

const clone = value => structuredClone(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const time = value => Number(Number(value).toPrecision(12));
const signs = channel => channel === 'position' ? [-1, 1, 1] : channel === 'rotation' ? [-1, -1, 1] : [1, 1, 1];
function flip(values, channel) {
  return values.map((value, axis) => signs(channel)[axis] > 0 ? value : typeof value === 'number' ? value === 0 ? 0 : -value
    : value.startsWith('-(') && value.endsWith(')') ? value.slice(2, -1) : `-(${value})`);
}
// BBmodel and project serialization can reorder object fields. Compare content,
// not insertion order, so untouched channels retain their original timestamps.
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = (keys, fps) => JSON.stringify(canonical((keys || []).map(key => ({ ...key, frame: time(key.frame / fps) }))));
const loopMode = value => value === true ? 'loop' : value === 'hold_on_last_frame' ? 'hold' : 'once';
const nativeLoop = value => value === 'loop' ? true : value === 'hold' ? 'hold_on_last_frame' : false;

function readChannel(value, channel, fps) {
  const vector = value => flip(animationVector(value, restChannel(channel)), channel);
  if (!object(value)) return [{ frame: 0, value: vector(value) }];
  return Object.entries(value).flatMap(([stamp, item]) => {
    const seconds = Number(stamp);
    if (!Number.isFinite(seconds) || seconds < 0) return [];
    if (!object(item)) return [{ frame: seconds * fps, value: vector(item) }];
    return [{ frame: seconds * fps, value: vector(item.post ?? item.pre),
      ...(item.pre !== undefined ? { pre: vector(item.pre) } : {}),
      ...(item.lerp_mode ? { lerpMode: item.lerp_mode } : {}), nativeData: clone(item) }];
  }).sort((a, b) => a.frame - b.frame);
}

export function isBedrockAnimationDocument(data) {
  return object(data?.animations) && !data.meta?.model_format && !Array.isArray(data.elements);
}

export function importBedrockAnimations(data, project, boneNames, fps = 24) {
  if (!isBedrockAnimationDocument(data)) throw Error('ui.animation-invalid-file');
  const byName = new Map([...boneNames].map(([uid, name]) => [name, uid]));
  for (const group of project.groups) if (!byName.has(group.name)
    && project.groups.filter(other => other.name === group.name).length === 1) byName.set(group.name, group.uid);
  const document = Object.fromEntries(Object.entries(data).filter(([key]) => !['animations', 'format_version'].includes(key)));
  return Object.entries(data.animations).map(([name, source]) => {
    if (!object(source)) throw Error('ui.animation-invalid-file');
    const tracks = Object.create(null), bindings = Object.create(null);
    let duration = 0;
    for (const [bone, settings] of Object.entries(source.bones || {})) {
      const uid = byName.get(bone);
      if (!uid || !object(settings)) continue;
      if (tracks[uid]) throw Error('ui.animation-ambiguous-bone');
      bindings[uid] = bone;
      tracks[uid] = Object.fromEntries(ANIMATION_CHANNELS.map(channel => [channel,
        settings[channel] === undefined ? [] : readChannel(settings[channel], channel, fps)]));
      for (const channel of ANIMATION_CHANNELS) for (const key of tracks[uid][channel]) duration = Math.max(duration, key.frame / fps);
    }
    // Unmatched bones and effects also contribute to the asset's duration.
    for (const settings of Object.values(source.bones || {})) for (const channel of ANIMATION_CHANNELS) {
      if (object(settings?.[channel])) for (const stamp of Object.keys(settings[channel])) if (Number.isFinite(Number(stamp))) duration = Math.max(duration, Number(stamp));
    }
    for (const field of ['timeline', 'particle_effects', 'sound_effects']) for (const stamp of Object.keys(source[field] || {})) {
      if (Number.isFinite(Number(stamp))) duration = Math.max(duration, Number(stamp));
    }
    const length = Number.isFinite(source.animation_length) ? Math.max(duration, source.animation_length) : duration;
    const clip = normalizeAnimations([{ uid: crypto.randomUUID(), name, fps, length: length * fps, loop: loopMode(source.loop), tracks,
      native: { animation: clone(source), document: clone(document), formatVersion: data.format_version || '1.8.0', identifier: name,
        nameAtImport: name, durationAtImport: length, loopAtImport: loopMode(source.loop), bindings, preserveStarts: Object.keys(bindings),
        unboundNames: Object.keys(source.bones || {}).filter(bone => !Object.values(bindings).includes(bone)),
        hasDynamic: /"(?:timeline|sound_effects|particle_effects|relative_to|anim_time_update|blend_weight|start_delay|loop_delay)"/.test(JSON.stringify(source))
          || Object.values(tracks).some(track => ANIMATION_CHANNELS.some(channel => track[channel].some(key => [...key.value, ...(key.pre || [])].some(value => typeof value === 'string')))) }
    }])[0];
    clip.native.baselines = Object.fromEntries(Object.entries(clip.tracks).map(([uid, track]) => [uid,
      Object.fromEntries(ANIMATION_CHANNELS.map(channel => [channel, fingerprint(track[channel], fps)]))]));
    return clip;
  });
}

function writeChannel(keys, channel, fps) {
  if (keys.length === 1 && keys[0].frame === 0 && !keys[0].pre && !keys[0].lerpMode && !keys[0].nativeData) return flip(keys[0].value, channel);
  return Object.fromEntries(keys.map((key, index) => {
    if (key.lerpMode && !['linear', 'catmullrom', 'step'].includes(key.lerpMode)) throw Error('ui.animation-unsupported-interpolation');
    const value = flip(key.value, channel);
    const pre = keys[index - 1]?.lerpMode === 'step' ? keys[index - 1].value : key.pre;
    const entry = pre || key.lerpMode || key.nativeData ? { ...clone(key.nativeData || {}),
      ...(pre ? { pre: flip(pre, channel) } : {}), post: value,
      ...(key.lerpMode && key.lerpMode !== 'step' ? { lerp_mode: key.lerpMode } : {}) } : value;
    return [String(time(key.frame / fps)), entry];
  }));
}

const slug = value => String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^_+|_+$/g, '') || 'model';
export function exportBedrockAnimations(clips, boneNames, projectName = 'model') {
  const animations = Object.create(null), document = Object.create(null);
  let version = '1.8.0';
  for (const clip of clips) {
    for (const [key, value] of Object.entries(clip.native?.document || {})) {
      if (Object.hasOwn(document, key) && JSON.stringify(document[key]) !== JSON.stringify(value)) throw Error('ui.animation-document-conflict');
      document[key] = clone(value);
    }
    if (clip.native?.formatVersion && clip.native.formatVersion.split('.').reduce((n, v) => n * 1000 + Number(v), 0)
      > version.split('.').reduce((n, v) => n * 1000 + Number(v), 0)) version = clip.native.formatVersion;
    const name = clip.native && clip.name === clip.native.nameAtImport ? clip.native.identifier
      : clip.name.startsWith('animation.') ? slug(clip.name) : `animation.${slug(projectName)}.${slug(clip.name)}`;
    if (Object.hasOwn(animations, name)) throw Error('ui.animation-duplicate-identifier');
    const source = clone(clip.native?.animation || {});
    const bones = Object.assign(Object.create(null), source.bones || {});
    for (const oldName of Object.values(clip.native?.bindings || {})) delete bones[oldName];
    for (const [uid, track] of Object.entries(clip.tracks)) {
      const oldName = clip.native?.bindings?.[uid], target = boneNames.get(uid) || oldName;
      if (!target) continue;
      if (Object.hasOwn(bones, target)) throw Error('ui.animation-ambiguous-bone');
      const bone = clone(clip.native?.animation?.bones?.[oldName] || {});
      for (const channel of ANIMATION_CHANNELS) {
        if (clip.native?.baselines?.[uid]?.[channel] === fingerprint(track[channel], clip.fps)) continue;
        if (track[channel]?.length) {
          const encoded = writeChannel(track[channel], channel, clip.fps);
          const extras = object(bone[channel]) ? Object.fromEntries(Object.entries(bone[channel]).filter(([stamp]) => !Number.isFinite(Number(stamp)))) : {};
          bone[channel] = object(encoded) ? { ...extras, ...encoded } : encoded;
        }
        else delete bone[channel];
      }
      bones[target] = bone;
    }
    if (Object.keys(bones).length || source.bones !== undefined) source.bones = bones;
    if (!clip.native || clip.loop !== clip.native.loopAtImport) source.loop = nativeLoop(clip.loop || 'loop');
    if (!clip.native || Math.abs(clip.length / clip.fps - clip.native.durationAtImport) > 1e-10) source.animation_length = time(clip.length / clip.fps);
    animations[name] = source;
  }
  return { ...document, format_version: version, animations };
}
