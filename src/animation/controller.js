import { ANIMATION_CHANNELS, animationLocalDelta, animationLocalDirection, constrainAnimationEnd, ensureAnimationStart, keyedChannel, moveAnimationKey, sampleGroup, setAnimationKey, setGroupAnimationPose } from './model.js';
import { createAnimationView } from './view.js';
import { createAnimationInteraction } from './interaction.js';
import { animationGroupPoint, animationGroupRotation, animationPoseRotation } from './model.js';
import { applyGroupTransforms } from '../common/core/geometry-utils.js';
import { normalize3 } from '../utils/math/vector3.js';
import { quaternionFromEuler, quaternionMultiply, eulerFromQuaternion, rotateVector } from '../utils/math/rotation.js';
import { rotationMatrix, matrixMultiply, matrixEuler } from '../model/transform-math.js';
import { bindAnimationTimeline } from './timeline-interaction.js';
import { selectedAnimationKeys } from './selection.js';
import { advanceAnimation, setAnimationFps } from './playback.js';
import { nearestAnimationEuler, rotateAnimationEuler } from './rotation.js';
import { createAnimationAssets } from './assets-controller.js';

export function createAnimationController({ state, $, sceneCanvas, sceneRenderer, snapshot, markDirty,
  renderScene, selectItem, clearSelectionTransformContext, escapeHtml, toast, snapValue, getAngleSnapStep, setMode, refreshTools = () => {} }) {
  let revision = 0, structureRevision = 0, poseRevision = 0, lastProject = null, lastSignature = '', playback = null, lastTime = 0;
  const activeClip = () => state.project.animations.find(clip => clip.uid === state.activeAnimationUid) || null;
  const selectWrittenKeys = (uids, frame) => {
    state.selectedAnimationKeys = [...new Set(uids)].map(uid => ({ clipUid: activeClip().uid, uid, frame }));
  };
  const groups = () => [...state.selectedUids].map(uid => state.project.getNode(uid)).filter(group => group?.type === 'group'
    && !state.project.getGroupChain(group.uid).some(parent => state.selectedUids.has(parent.uid)));
  const view = createAnimationView({ state, $, activeClip, escapeHtml });
  const assets = createAnimationAssets({ state, $, activeClip, toast, onImported(clips) {
    stopTimeline(); snapshot('core.animation.import');
    state.project.animations.push(...clips); state.activeAnimationUid = clips[0].uid;
    state.selectedAnimationKeys = []; state.timelineFrame = 0;
    if (state.mode !== 'animate') setMode?.('animate');
    const uid = Object.keys(clips[0].tracks)[0];
    if (uid) selectItem(uid);
    changed(true, true);
  } });
  function changed(persist = true, structure = false, dataChanged = persist) {
    poseRevision++;
    if (structure) structureRevision++;
    if (dataChanged) revision++;
    clearSelectionTransformContext();
    if (persist) { markDirty(); refreshTools(); }
    renderScene();
  }
  function commit(entries, frame = state.timelineFrame) {
    const clip = activeClip();
    if (!clip || !entries.length) return false;
    stopTimeline();
    const newKey = entries.some(({ uid, channel }) => !clip.tracks[uid]?.[channel]?.some(key => key.frame === frame));
    snapshot('core.animation.key');
    for (const { uid, channel, value } of entries) if (state.project.getNode(uid)?.type === 'group') setAnimationKey(clip, uid, channel, frame, value);
    selectWrittenKeys(entries.map(entry => entry.uid), frame);
    changed(true, newKey); return true;
  }
  function writeLive(drag, entries) {
    const channel = drag.tool === 'move' ? 'position' : drag.tool === 'resize' ? 'scale' : 'rotation';
    const updates = entries.filter(({ uid, value }) => {
      const baseline = drag.base.get(uid)[channel];
      if (!drag.keyedUids.has(uid) && !value.some((number, axis) => Math.abs(number - baseline[axis]) > 1e-9)) return false;
      const current = keyedChannel(drag.clip, uid, channel, drag.frame);
      return !current || value.some((number, axis) => typeof current[axis] !== 'number' || Math.abs(number - current[axis]) > 1e-9);
    });
    if (!updates.length) return false;
    const firstWrite = !drag.recording;
    if (firstWrite) { snapshot('core.animation.key'); drag.recording = true; }
    const newKey = updates.some(({ uid }) => !keyedChannel(drag.clip, uid, channel, drag.frame));
    for (const { uid, value } of updates) {
      setAnimationKey(drag.clip, uid, channel, drag.frame, value);
      drag.keyedUids.add(uid);
    }
    selectWrittenKeys([...drag.keyedUids], drag.frame);
    if (firstWrite) markDirty();
    changed(false, newKey, true);
    return true;
  }
  const interaction = createAnimationInteraction({ state, $, sceneCanvas, sceneRenderer, activeClip, groups, writeLive, changed, toast, snapValue, getAngleSnapStep });
  function stopTimeline() {
    state.timelinePlaying = false;
    if (playback !== null) cancelAnimationFrame(playback);
    playback = null;
    if (state.mode === 'animate') view.refresh(revision, structureRevision);
  }
  function playTimeline() {
    if (state.timelinePlaying) { stopTimeline(); return; }
    if (!activeClip()) return;
    if (state.timelineFrame >= activeClip().length) state.timelineFrame = 0;
    state.timelinePlaying = true; lastTime = performance.now();
    const project = state.project, clip = activeClip();
    const tick = now => {
      playback = null;
      if (!state.timelinePlaying || state.mode !== 'animate' || state.project !== project || activeClip() !== clip) return stopTimeline();
      const next = advanceAnimation(clip, state.timelineFrame, (now - lastTime) / 1000);
      state.timelineFrame = next.frame;
      lastTime = now; clearSelectionTransformContext(); renderScene();
      if (!next.playing) return stopTimeline();
      playback = requestAnimationFrame(tick);
    };
    playback = requestAnimationFrame(tick); view.refresh(revision, structureRevision);
  }
  function setFrame(frame, { snap = true } = {}) {
    stopTimeline();
    state.timelineFrame = Math.max(0, snap ? Math.round(frame) : frame);
    clearSelectionTransformContext(); renderScene();
  }
  function setEndFrame(frame) {
    const clip = activeClip(), end = constrainAnimationEnd(clip, frame);
    if (!clip || !Number.isFinite(end) || clip.length === end) return;
    stopTimeline(); snapshot('core.animation.end_frame');
    clip.length = end; changed(true, true);
  }
  function moveKey(uid, from, to, clampToEnd) {
    const clip = activeClip();
    if (!clip) return;
    const target = Math.max(0, Math.min(Math.round(to), clampToEnd ? clip.length : Infinity));
    if (!Number.isFinite(target) || target === from || !ANIMATION_CHANNELS.some(channel => clip.tracks[uid]?.[channel]?.some(key => key.frame === from))) return;
    snapshot('core.animation.key_move');
    moveAnimationKey(clip, uid, from, target, clampToEnd);
    state.selectedAnimationKeys = (state.selectedAnimationKeys || []).map(key => key.clipUid === clip.uid && key.uid === uid && key.frame === from ? { ...key, frame: target } : key);
    changed(true, true);
  }
  function selectKey(uid, frame, { toggle = false, add = false } = {}) {
    const keys = selectedAnimationKeys(state, activeClip());
    const selected = keys.some(key => key.uid === uid && key.frame === frame);
    if (toggle && selected) state.selectedAnimationKeys = keys.filter(key => key.uid !== uid || key.frame !== frame);
    else {
      const next = toggle || add ? keys : [];
      if (!next.some(key => key.uid === uid && key.frame === frame)) next.push({ clipUid: activeClip().uid, uid, frame });
      state.selectedAnimationKeys = next;
    }
    selectItem(uid); view.refresh(revision, structureRevision);
  }
  function clearKeys() {
    state.selectedAnimationKeys = [];
    view.refresh(revision, structureRevision);
  }
  function prepareScene() {
    if (lastProject !== state.project) {
      if (lastProject) lastProject.groups.forEach(group => setGroupAnimationPose(group, null));
      stopTimeline(); lastProject = state.project; lastSignature = ''; revision++;
      if (!activeClip()) state.activeAnimationUid = state.project.animations[0]?.uid || null;
      state.selectedAnimationKeys = selectedAnimationKeys(state, activeClip());
    }
    const clip = state.mode === 'animate' ? activeClip() : null;
    const signature = `${state.mode}:${clip?.uid}:${state.timelineFrame}:${revision}:${poseRevision}`;
    if (lastSignature !== signature) {
      lastSignature = signature;
      // Live drags already update the keys. Preview through the same sampler as
      // playback so fractional cursor times cannot change pose on pointer-up.
      for (const group of state.project.groups) setGroupAnimationPose(group, clip
        ? sampleGroup(clip, group.uid, state.timelineFrame) : null);
      clearSelectionTransformContext();
    }
    view.refresh(revision, structureRevision);
  }
  function applyAction(action, options) {
    if (!activeClip()) { toast('ui.animation-empty'); return false; }
    const axis = 'xyz'.indexOf(options.axis), entries = [], targets = groups();
    if (!targets.length) return false;
    const pivotOf = group => applyGroupTransforms(animationGroupPoint(group.pivot, group), state.project.getGroupChain(group.uid));
    const center = targets.reduce((sum, group) => sum.map((value, i) => value + pivotOf(group)[i] / targets.length), [0, 0, 0]);
    const operationCenter = options.base === 'origin' ? [0, 0, 0] : center;
    const inverseQuaternion = q => [-q[0], -q[1], -q[2], q[3]];
    const parentRotation = group => state.project.getGroupChain(group.uid).reduce((q, parent) => quaternionMultiply(q,
      quaternionFromEuler(animationGroupRotation(parent))), [0, 0, 0, 1]);
    for (const group of targets) {
      const pose = sampleGroup(activeClip(), group.uid, state.timelineFrame);
      const baseRotation = parentRotation(group);
      const worldRotation = quaternionMultiply(baseRotation, quaternionFromEuler(animationGroupRotation(group, pose)));
      const setWorldRotation = desired => { pose.rotation = animationPoseRotation(group,
        nearestAnimationEuler(quaternionMultiply(inverseQuaternion(baseRotation), desired), animationGroupRotation(group, pose))); };
      let channel, transformedPivot = null;
      if (action === 'flip' && axis >= 0) {
        channel = 'scale'; pose.scale[0] *= -1;
        const worldMirror = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; worldMirror[axis][axis] = -1;
        const localMirror = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]];
        const mirroredRotation = matrixMultiply(matrixMultiply(worldMirror, rotationMatrix(eulerFromQuaternion(worldRotation))), localMirror);
        setWorldRotation(quaternionFromEuler(matrixEuler(mirroredRotation)));
        entries.push({ uid: group.uid, channel: 'rotation', value: pose.rotation });
        transformedPivot = pivotOf(group).map((value, i) => i === axis ? 2 * operationCenter[i] - value : value);
      } else if (action === 'rotate' && axis >= 0) {
        channel = 'rotation';
        const rotation = [0, 0, 0]; rotation[axis] = Number(options.angle) < 0 ? -90 : 90;
        setWorldRotation(quaternionMultiply(quaternionFromEuler(rotation), worldRotation));
        transformedPivot = rotateVector(pivotOf(group).map((value, i) => value - operationCenter[i]), rotation)
          .map((value, i) => value + operationCenter[i]);
      }
      else if (action === 'center') {
        channel = 'position';
        const source = state.toolboxCenterBase === 'pivot' ? center : sceneRenderer.getSelectionBounds(state.project, state.selectedUids)?.center || center;
        const delta = source.map((value, i) => options.axis === 'all' || i === axis ? -value : 0);
        const local = animationLocalDelta(state.project, group, delta);
        pose.position = pose.position.map((value, i) => value + local[i]);
      } else if (action === 'compensate') {
        channel = 'rotation';
        const desired = eulerFromQuaternion(worldRotation);
        for (let i = 0; i < 3; i++) if (options.axis === 'all' || options.axis.includes('xyz'[i])) desired[i] = 0;
        setWorldRotation(quaternionFromEuler(desired));
      } else continue;
      if (transformedPivot) {
        const delta = transformedPivot.map((value, i) => value - pivotOf(group)[i]);
        if (delta.some(value => Math.abs(value) > 1e-8)) {
          const local = animationLocalDelta(state.project, group, delta);
          entries.push({ uid: group.uid, channel: 'position', value: pose.position.map((value, i) => value + local[i]) });
        }
      }
      entries.push({ uid: group.uid, channel, value: pose[channel] });
    }
    return commit(entries);
  }
  function openPreciseRotation(event, handle) {
    if (!activeClip()) { toast('ui.animation-empty'); return; }
    if (state.dragging?.type === 'animation-transform') interaction.finish({ type: 'pointercancel' });
    const viewport = $('#viewport'), bounds = viewport.getBoundingClientRect();
    viewport.querySelector('.animation-precise-rotation')?.remove();
    const field = document.createElement('div');
    field.className = 'precise-rotation-input animation-precise-rotation';
    field.style.left = `${Math.max(8, Math.min(bounds.width - 118, event.clientX - bounds.left + 14))}px`;
    field.style.top = `${Math.max(8, event.clientY - bounds.top - 32)}px`;
    field.innerHTML = '<input type="number" step="any" value="0" /><span>°</span>';
    viewport.append(field);
    const axis = /^[0-2]$/.test(handle.dataset.axis) ? Number(handle.dataset.axis) : null;
    const worldAxis = axis === null ? sceneRenderer.getCameraFrame().forward : state.gizmoAxes[axis].vector;
    const input = field.querySelector('input'); input.focus(); input.select();
    const dismiss = () => { field.remove(); document.removeEventListener('pointerdown', outside, true); };
    const outside = down => { if (!field.contains(down.target)) dismiss(); };
    document.addEventListener('pointerdown', outside, true);
    input.addEventListener('keydown', key => {
      if (key.key !== 'Enter' || !Number.isFinite(input.valueAsNumber)) return;
      key.preventDefault();
      const facing = worldAxis.reduce((sum, value, i) => sum + value * sceneRenderer.getCameraFrame().forward[i], 0);
      const angle = input.valueAsNumber * (facing < 0 ? -1 : 1);
      commit(groups().map(group => {
        const pose = sampleGroup(activeClip(), group.uid, state.timelineFrame);
        if (state.transformSpace === 'self' && state.rotationMode === 'euler' && axis !== null) pose.rotation[axis] += angle;
        else pose.rotation = animationPoseRotation(group, rotateAnimationEuler(animationGroupRotation(group, pose),
          normalize3(animationLocalDirection(state.project, group, worldAxis)), angle));
        return { uid: group.uid, channel: 'rotation', value: pose.rotation };
      }));
      dismiss();
    });
  }
  function bind() {
    $('#animationCreate').addEventListener('click', () => {
      snapshot('core.animation.create'); stopTimeline();
      let index = 1;
      while (state.project.animations.some(clip => clip.name === `animation_${index}`)) index++;
      const clip = { uid: crypto.randomUUID(), name: `animation_${index}`, fps: 24, length: 24, loop: 'loop', tracks: {} };
      state.project.animations.push(clip); state.activeAnimationUid = clip.uid; state.selectedAnimationKeys = []; state.timelineFrame = 0; changed(true, true);
    });
    $('#animationList').addEventListener('click', event => {
      const remove = event.target.closest('[data-animation-remove]'), select = event.target.closest('[data-animation-select]');
      if (remove) {
        snapshot('core.animation.remove'); stopTimeline();
        state.project.animations = state.project.animations.filter(clip => clip.uid !== remove.dataset.animationRemove);
        state.selectedAnimationKeys = [];
        if (!activeClip()) state.activeAnimationUid = state.project.animations[0]?.uid || null;
        state.timelineFrame = 0; changed(true, true);
      } else if (select) { stopTimeline(); state.activeAnimationUid = select.dataset.animationSelect; state.selectedAnimationKeys = []; state.timelineFrame = 0; refreshTools(); changed(false, true); }
    });
    $('#animationSettings').addEventListener('change', event => {
      const field = event.target.dataset.animationInfo, clip = activeClip();
      if (!clip || !field) return;
      if (field === 'length') { if (Number.isFinite(event.target.valueAsNumber)) setEndFrame(event.target.valueAsNumber); return; }
      snapshot('core.animation.information');
      if (field === 'name') clip.name = event.target.value.trim() || clip.name;
      else if (field === 'fps') {
        const ratio = setAnimationFps(clip, Number(event.target.value) || 24);
        state.timelineFrame *= ratio;
        state.selectedAnimationKeys = (state.selectedAnimationKeys || []).map(key => key.clipUid === clip.uid ? { ...key, frame: key.frame * ratio } : key);
      } else if (field === 'loop' && ['once', 'hold', 'loop'].includes(event.target.value)) clip.loop = event.target.value;
      changed(true, true);
    });
    $('#animationFrameProperties').addEventListener('input', event => {
      const input = event.target, channel = input.dataset.animationChannel, uid = input.dataset.groupUid;
      if (!channel || !activeClip() || !Number.isFinite(input.valueAsNumber)) return;
      const frame = Number(input.dataset.animationFrame);
      const value = keyedChannel(activeClip(), uid, channel, frame) || sampleGroup(activeClip(), uid, frame)[channel];
      value[Number(input.dataset.axis)] = input.valueAsNumber;
      commit([{ uid, channel, value }], frame);
    });
    $('#animationFrameProperties').addEventListener('click', event => {
      const button = event.target.closest('[data-animation-add-key]');
      if (button && activeClip()) {
        const frame = Number(button.dataset.animationFrame);
        commit([{ uid: button.dataset.groupUid, channel: button.dataset.animationAddKey,
          value: sampleGroup(activeClip(), button.dataset.groupUid, frame)[button.dataset.animationAddKey] }], frame);
      }
    });
    $('#animationPlay').addEventListener('click', playTimeline);
    $('#animationStart').addEventListener('click', () => setFrame(0));
    $('#animationEnd').addEventListener('click', () => setFrame(activeClip()?.length || 0));
    bindAnimationTimeline({ state, $, timeline: view.timeline, activeClip, selectItem, selectKey, clearKeys, setFrame, stopTimeline, moveKey, setEndFrame });
    $('#animationTimeline').addEventListener('keydown', event => {
      if (event.key !== 'Delete' || !activeClip()) return;
      const keys = selectedAnimationKeys(state, activeClip());
      if (!keys.length) return;
      event.preventDefault(); event.stopPropagation(); snapshot('core.animation.key_remove');
      for (const { uid, frame } of keys) for (const channel of ANIMATION_CHANNELS) {
        const track = activeClip().tracks[uid];
        if (track?.[channel]) track[channel] = track[channel].filter(key => key.frame !== frame);
      }
      for (const { uid } of keys) ensureAnimationStart(activeClip(), uid);
      state.selectedAnimationKeys = [];
      changed(true, true);
    });
  }
  bind();
  sceneRenderer.onAnimationMeshReady = () => { if (state.mode === 'animate') renderScene(); };
  return { activeClip, prepareScene, commit, applyAction, openPreciseRotation, playTimeline, stopTimeline, setFrame, ...assets,
    startTransform: interaction.start, moveTransform: interaction.move, endTransform: interaction.finish,
    updateTimelineUI: () => view.refresh(revision, structureRevision) };
}
