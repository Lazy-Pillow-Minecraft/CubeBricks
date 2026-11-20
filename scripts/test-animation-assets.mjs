import assert from 'node:assert/strict';
import { Cube, Group, CubeBricksProject, exportBlockbench, importBlockbench } from '../src/model.js';
import { bedrockBoneNames } from '../src/model/formats/bedrock-bones.js';
import { exportBedrockJson } from '../src/model/formats/bedrock-json.js';
import { importBedrockAnimations, exportBedrockAnimations } from '../src/animation/bedrock.js';
import { normalizeAnimations, keyedChannel, setAnimationKey, sampleChannel } from '../src/animation/model.js';
import { advanceAnimation, setAnimationFps } from '../src/animation/playback.js';
import { nearestAnimationEuler, rotateAnimationEuler } from '../src/animation/rotation.js';
import { quaternionFromEuler, quaternionMultiply, quaternionFromAxisAngle } from '../src/utils/math/rotation.js';
const json = value => JSON.parse(JSON.stringify(value));

const cube = new Cube({ uid: 'cube', position: [0, 0, 0], size: [2, 2, 2] });
const loose = new Cube({ uid: 'loose', size: [1, 1, 1] });
const a = new Group({ uid: 'a', name: 'head', children: [cube.uid] });
const b = new Group({ uid: 'b', name: 'head', children: [] });
const root = new Group({ uid: 'root-group', name: 'root', children: [a.uid, b.uid] });
const project = new CubeBricksProject({ name: 'mob', formatId: 'bedrock_entity', elements: [loose, cube], groups: [root, a, b], outliner: [loose.uid, root.uid] });
project.getNode(a.uid).name = project.getNode(b.uid).name = 'head';
const bb = exportBlockbench(project), names = bedrockBoneNames(bb).names;
const geometry = exportBedrockJson(bb, [])['minecraft:geometry'][0];
assert.equal(names.get(root.uid), 'root_2', 'synthetic roots share the geometry naming sequence');
assert.equal(names.get(a.uid), 'head'); assert.equal(names.get(b.uid), 'head_2');
for (const name of names.values()) assert.ok(geometry.bones.some(bone => bone.name === name));

const source = {
  format_version: '1.8.0', custom_header: { keep: true }, animations: {
    'animation.mob.walk': { animation_length: 1.2, loop: true, anim_time_update: 'query.anim_time + query.delta_time',
      blend_weight: 'variable.weight', override_previous_animation: true, custom_animation: 5,
      bones: { head: { custom_bone: 'keep', rotation: {
        '0.1000': { pre: [12, 0, 0], post: [20, 0, 360], lerp_mode: 'catmullrom', custom_key: 'keep' }, '0.3': [40, 0, 720]
      }, position: [1, 2, 3], scale: 2 }, head_2: { position: ['query.anim_time', 0, 0], relative_to: { rotation: 'entity' } },
      other_model_bone: { rotation: ['variable.swing', 0, 0] } },
      sound_effects: { '0.2': [{ effect: 'step', locator: 'foot' }] }, particle_effects: { '0.4': { effect: 'dust', locator: 'foot' } }, timeline: { '0.8': ['v.a = 1;'] }
    }
  }
};
const clips = importBedrockAnimations(source, project, names), clip = clips[0];
assert.ok(Math.abs(clip.tracks[a.uid].rotation[0].frame - 2.4) < 1e-10, 'native seconds retain subframe precision');
assert.equal(clip.tracks[a.uid].rotation.length, 2, 'import does not manufacture a rest frame');
assert.deepEqual(keyedChannel(clip, a.uid, 'rotation', 2.4), [-20, 0, 360]);
assert.deepEqual(keyedChannel(clip, a.uid, 'position', 0), [-1, 2, 3]);
assert.deepEqual(sampleChannel(clip.tracks[a.uid].rotation, 1, 'rotation'), [-12, 0, 0], 'before the first native key, use its pre value');
assert.deepEqual(keyedChannel(clip, a.uid, 'scale', 0), [2, 2, 2], 'uniform values expand without changing their source representation');
assert.deepEqual(json(exportBedrockAnimations(clips, names, project.name)), source, 'untouched native assets roundtrip exactly');
const restored = normalizeAnimations(JSON.parse(JSON.stringify(clips)));
assert.deepEqual(json(exportBedrockAnimations(restored, names, project.name)), source, 'project save/load preserves native metadata and expressions');
setAnimationFps(clip, 48);
assert.ok(Math.abs(clip.tracks[a.uid].rotation[0].frame - 4.8) < 1e-10);
assert.deepEqual(json(exportBedrockAnimations(clips, names, project.name)), source, 'changing the editing FPS preserves native timestamps');
const expression = keyedChannel(clip, b.uid, 'position', 0);
expression[1] = 3; setAnimationKey(clip, b.uid, 'position', 0, expression);
const edited = exportBedrockAnimations(clips, names, project.name).animations['animation.mob.walk'];
assert.deepEqual(edited.bones.head_2.position, ['query.anim_time', 3, 0], 'editing a numeric axis preserves expressions on other axes');
assert.deepEqual(edited.bones.other_model_bone, source.animations['animation.mob.walk'].bones.other_model_bone);
assert.deepEqual(edited.sound_effects, source.animations['animation.mob.walk'].sound_effects);
const renamed = new Map(names); renamed.set(a.uid, 'new_head');
const mapped = exportBedrockAnimations(clips, renamed, project.name).animations['animation.mob.walk'].bones;
assert.ok(mapped.new_head && !mapped.head, 'animation follows the geometry exporter name mapping');

const jump = importBedrockAnimations({ animations: { jump: { bones: { head: { scale: { '0.5': { pre: 1, post: 2 }, '1': 1 } } } } } }, project, names)[0];
assert.deepEqual(sampleChannel(jump.tracks[a.uid].scale, .49 * 24, 'scale'), [1, 1, 1]);
assert.deepEqual(sampleChannel(jump.tracks[a.uid].scale, .5 * 24, 'scale'), [2, 2, 2]);
assert.deepEqual(sampleChannel(jump.tracks[a.uid].scale, .75 * 24, 'scale'), [1.5, 1.5, 1.5]);
const fractional = normalizeAnimations([{ fps: 24, length: .9, tracks: { a: { position: [{ frame: .12, value: [1, 0, 0] }, { frame: .24, value: [2, 0, 0] }] } }, native: { preserveStarts: ['a'] } }])[0];
assert.equal(fractional.length, .9);
assert.deepEqual(sampleChannel(fractional.tracks.a.position, .18, 'position'), [1.5, 0, 0], 'short key intervals are not stretched to a full frame');

for (const mode of ['once', 'hold', 'loop']) {
  const test = { uid: mode, name: mode, fps: 24, length: 24, loop: mode, tracks: {} };
  assert.deepEqual(advanceAnimation(test, 0, 1), { frame: mode === 'hold' ? 24 : 0, playing: mode === 'loop' }, 'an end frame of 24 at 24 FPS is exactly one second');
  const document = exportBedrockAnimations([test], names, 'mob');
  assert.equal(document.animations[`animation.mob.${mode}`].loop, mode === 'loop' ? true : mode === 'hold' ? 'hold_on_last_frame' : false);
  assert.equal(importBedrockAnimations(document, project, names)[0].loop, mode);
}
assert.deepEqual(advanceAnimation({ fps: 24, length: 0, loop: 'loop' }, 0, 1), { frame: 0, playing: false });

for (const angle of [270, 360, 720, -450]) {
  const result = rotateAnimationEuler([0, 0, 0], [0, 0, 1], angle);
  assert.ok(Math.abs(result[2] - angle) < 1e-7, 'precise pose rotations preserve full turns');
}
let continuous = [0, 0, 0];
for (let angle = 0; angle <= 720; angle += 10) continuous = nearestAnimationEuler(quaternionFromAxisAngle([0, 0, 1], angle), continuous);
assert.ok(Math.abs(continuous[2] - 720) < 1e-7, 'drag rotations unwrap across the quaternion boundary');
const start = [25, 88, 720], rotated = rotateAnimationEuler(start, [1, 0, 0], 100);
const wanted = quaternionMultiply(quaternionFromAxisAngle([1, 0, 0], 100), quaternionFromEuler(start));
assert.ok(Math.abs(Math.abs(quaternionFromEuler(rotated).reduce((sum, value, axis) => sum + value * wanted[axis], 0)) - 1) < 1e-8, 'unwrapped Euler values preserve their quaternion orientation');

project.animations = clips;
const bbAnimated = exportBlockbench(project), reimported = importBlockbench(bbAnimated);
assert.equal(reimported.animations[0].loop, clip.loop);
assert.ok(Math.abs(reimported.animations[0].tracks[a.uid].rotation[0].frame / reimported.animations[0].fps - .1) < 1e-10);
assert.deepEqual(exportBedrockAnimations(reimported.animations, names, project.name).animations['animation.mob.walk'].sound_effects, edited.sound_effects);
assert.deepEqual(json(exportBedrockAnimations(reimported.animations, names, project.name)), json(exportBedrockAnimations(clips, names, project.name)), 'BBmodel roundtrips retain native pre/post, expressions, timing and extra fields');

const standardBb = structuredClone(bb);
standardBb.animations = [{ uuid: 'bb-animation', name: 'walk', loop: 'hold', length: 1, snapping: 30,
  animators: { [a.uid]: { type: 'bone', name: 'head', keyframes: [
    { channel: 'rotation', time: .125, interpolation: 'linear', data_points: [{ x: '45', y: '0', z: '360' }] }
  ] }, effects: { type: 'effect', keyframes: [
    { channel: 'sound', time: .2, data_points: [{ effect: 'step', locator: 'foot' }] },
    { channel: 'particle', time: .3, data_points: [{ effect: 'dust', locator: 'foot', script: 'v.a = 1;' }] },
    { channel: 'timeline', time: .4, data_points: [{ script: 'v.b = 2;' }] }
  ] } } }];
const standard = importBlockbench(standardBb).animations[0];
assert.deepEqual(standard.tracks[a.uid].rotation[0].value, [45, 0, 360], 'BB numeric strings remain editable numbers');
assert.equal(standard.tracks[a.uid].rotation[0].frame, 3.75);
const standardNative = json(exportBedrockAnimations([standard], names, project.name)).animations['animation.mob.walk'];
assert.equal(standardNative.loop, 'hold_on_last_frame');
assert.deepEqual(standardNative.bones.head.rotation['0.125'], [-45, 0, 360]);
assert.deepEqual(standardNative.sound_effects['0.2'], [{ effect: 'step', locator: 'foot' }]);
assert.deepEqual(standardNative.particle_effects['0.3'], [{ effect: 'dust', locator: 'foot', pre_effect_script: 'v.a = 1;' }]);
assert.deepEqual(standardNative.timeline['0.4'], ['v.b = 2;']);
console.log('Native animation roundtrips, bone mapping, seconds, expressions, loops, multi-turn rotations and BBmodel animation persistence passed.');
