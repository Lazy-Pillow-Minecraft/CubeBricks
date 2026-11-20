import { animationGroupRotation, animationPoseRotation, animationLocalDelta, animationLocalDirection, sampleGroup } from './model.js';
import { dot3, cross3, normalize3 } from '../utils/math/vector3.js';
import { quaternionFromAxisAngle, quaternionFromEuler, quaternionMultiply, shortestAngleDelta } from '../utils/math/rotation.js';
import { nearestAnimationEuler } from './rotation.js';

export function createAnimationInteraction({ state, $, sceneCanvas, sceneRenderer, activeClip, groups, writeLive, changed, toast, snapValue, getAngleSnapStep }) {
  const intersect = (event, drag) => {
    const ray = sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top);
    const denominator = dot3(ray.direction, drag.normal);
    if (Math.abs(denominator) < 1e-8) return null;
    const distance = dot3(drag.origin.map((value, axis) => value - ray.origin[axis]), drag.normal) / denominator;
    return ray.origin.map((value, axis) => value + ray.direction[axis] * distance);
  };
  function start(event, axisIndex, captureTarget, kind = 'free', sign = 1, handleElement = null, axisKey, axisIndices = []) {
    if (!activeClip()) { toast('ui.animation-empty'); return; }
    const targets = groups();
    if (!targets.length) return;
    event.preventDefault(); event.stopPropagation();
    sceneCanvas.focus({ preventScroll: true });
    const frame = sceneRenderer.getCameraFrame(), origin = [...state.gizmoOrigin];
    const tool = state.tool === 'toolbox' ? 'resize' : state.tool;
    const axis = kind === 'rotate-view' ? frame.forward : state.gizmoAxes?.[axisIndex]?.vector || frame.right;
    const normal = kind.startsWith('plane') && axisIndices.length === 2
      ? normalize3(cross3(state.gizmoAxes[axisIndices[0]].vector, state.gizmoAxes[axisIndices[1]].vector))
      : tool === 'rotate' ? normalize3(axis)
        : axisIndex === null ? frame.forward
          : normalize3(frame.forward.map((value, index) => value - axis[index] * dot3(frame.forward, axis)));
    const drag = {
      type: 'animation-transform', tool, kind, axisIndex, axisIndices, axis, sign, normal, origin,
      project: state.project, clip: activeClip(), frame: state.timelineFrame,
      x: event.clientX, y: event.clientY, rect: sceneCanvas.getBoundingClientRect(),
      center: { ...state.gizmoCenter }, targets, captureTarget, handleElement, pointerId: event.pointerId,
      base: new Map(targets.map(group => [group.uid, sampleGroup(activeClip(), group.uid, state.timelineFrame)])),
      keyedUids: new Set(), recording: false,
      lastRotations: new Map(targets.map(group => [group.uid, sampleGroup(activeClip(), group.uid, state.timelineFrame).rotation])),
      angle: 0, lastAngle: Math.atan2(event.clientY - sceneCanvas.getBoundingClientRect().top - state.gizmoCenter.y, event.clientX - sceneCanvas.getBoundingClientRect().left - state.gizmoCenter.x)
    };
    drag.start = intersect(event, drag);
    drag.lastVector = drag.start?.map((value, index) => value - origin[index]);
    state.timelinePlaying = false;
    state.dragging = drag;
    sceneCanvas.classList.add(`is-${tool}`);
    captureTarget.setPointerCapture?.(event.pointerId);
    handleElement?.classList.add('active');
  }
  function move(event) {
    const drag = state.dragging;
    if (drag?.type !== 'animation-transform') return;
    if (drag.project !== state.project || drag.clip !== activeClip() || state.mode !== 'animate'
      || Math.abs(state.timelineFrame - drag.frame) > 1e-8) return finish({ ...event, type: 'pointercancel' });
    if (!drag.recording && event.clientX === drag.x && event.clientY === drag.y) return;
    const point = intersect(event, drag), dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    let delta = point && drag.start ? point.map((value, axis) => value - drag.start[axis]) : sceneRenderer.getCameraFrame().right.map(value => value * dx * .04);
    if (drag.axisIndex !== null && !drag.kind.startsWith('plane')) delta = drag.axis.map(value => value * dot3(delta, drag.axis) * drag.sign);
    if (drag.tool === 'rotate') {
      const vector = point?.map((value, axis) => value - drag.origin[axis]);
      if (vector && drag.lastVector && Math.abs(dot3(drag.axis, sceneRenderer.getCameraFrame().forward)) > .15) {
        drag.angle += Math.atan2(dot3(drag.axis, cross3(drag.lastVector, vector)), dot3(drag.lastVector, vector)) * 180 / Math.PI;
        drag.lastVector = vector;
      } else {
        const angle = Math.atan2(event.clientY - drag.rect.top - drag.center.y, event.clientX - drag.rect.left - drag.center.x);
        drag.angle += shortestAngleDelta(drag.lastAngle, angle) * 180 / Math.PI;
        drag.lastAngle = angle;
      }
    }
    const step = getAngleSnapStep(event), angle = Math.round(drag.angle / step) * step;
    const poses = new Map();
    for (const group of drag.targets) {
      const pose = structuredClone(drag.base.get(group.uid));
      if (drag.tool === 'move') {
        const local = animationLocalDelta(state.project, group, delta);
        pose.position = pose.position.map((value, axis) => snapValue(value + local[axis], event));
      } else if (drag.tool === 'resize') {
        const axes = drag.axisIndices.length ? drag.axisIndices : drag.axisIndex === null ? [0, 1, 2] : [drag.axisIndex];
        for (const axis of axes) pose.scale[axis] += drag.kind.startsWith('plane')
          ? dot3(delta, state.gizmoAxes[axis].vector) * .1 : drag.axisIndex === null ? -dy * .01 : dot3(delta, drag.axis) * .1;
      } else if (angle !== 0) {
        let localAxis = animationLocalDirection(state.project, group, drag.axis);
        localAxis = normalize3(localAxis);
        if (state.transformSpace === 'self' && drag.axisIndex !== null && state.rotationMode === 'euler') pose.rotation[drag.axisIndex] += angle;
        else pose.rotation = animationPoseRotation(group, nearestAnimationEuler(
          quaternionMultiply(quaternionFromAxisAngle(localAxis, angle), quaternionFromEuler(animationGroupRotation(group, pose))),
          animationGroupRotation(group, { rotation: drag.lastRotations.get(group.uid) })));
      }
      drag.lastRotations.set(group.uid, [...pose.rotation]);
      poses.set(group.uid, pose);
    }
    const tooltip = $('#transformTooltip'), viewport = $('#viewport').getBoundingClientRect();
    const channel = drag.tool === 'move' ? 'position' : drag.tool === 'resize' ? 'scale' : 'rotation';
    const first = drag.targets[0].uid, before = drag.base.get(first)[channel], after = poses.get(first)[channel];
    const difference = drag.tool === 'rotate' ? angle : after.map((value, i) => value - before[i])
      .reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, 0);
    tooltip.textContent = `${difference >= 0 ? '+' : ''}${Number(difference.toFixed(3))}${drag.tool === 'rotate' ? '°' : drag.tool === 'resize' ? '×' : ' px'}`;
    tooltip.style.right = 'auto';
    tooltip.style.left = `${Math.max(8, Math.min(viewport.width - 100, event.clientX - viewport.left + 14))}px`;
    tooltip.style.top = `${Math.max(8, event.clientY - viewport.top + 12)}px`;
    tooltip.hidden = false;
    if (!writeLive(drag, [...poses].map(([uid, pose]) => ({ uid, value: pose[channel] })))) changed(false);
  }
  function finish(event) {
    const drag = state.dragging;
    if (drag?.type !== 'animation-transform') return;
    if (event.type !== 'pointercancel' && Number.isFinite(event.clientX)) move(event);
    state.dragging = null;
    sceneCanvas.classList.remove('is-move', 'is-resize', 'is-rotate'); $('#transformTooltip').hidden = true;
    drag.handleElement?.classList.remove('active');
    if (drag.captureTarget.hasPointerCapture?.(drag.pointerId)) drag.captureTarget.releasePointerCapture(drag.pointerId);
    changed(Boolean(drag.recording && drag.project === state.project));
  }
  return { start, move, finish };
}
