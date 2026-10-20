import { BezierElement, CurveNode, chooseKnifeCutAxis, getKnifeFaceAxes, splitCubeAt } from '../model.js';
import { getEffectiveInflate } from '../render/webgl-renderer.js';

export function createKnifeController({ state, sceneCanvas, sceneRenderer, worldPointToCubeLocal,
  cubeLocalPointToWorld, snapValue, clamp, updateToolOptions, renderScene, renderAll,
  freezeCubeUvs, snapshot, markDirty, toast, isBezierElement, selected, selectItem, hexToRgb }) {
function getKnifeCandidate(event) {
  const rect = sceneCanvas.getBoundingClientRect();
  const hit = sceneRenderer.pickDetailed(state.project, event.clientX - rect.left, event.clientY - rect.top,
    true, { includeGenerated: !state.modifierResultGhost });
  if (hit?.generated) return null;
  const cube = hit && state.project.getNode(hit.uid);
  const faceAxes = hit && getKnifeFaceAxes(hit.faceName);
  if (!hit || cube?.type !== 'cube' || !faceAxes) return null;
  const localPoint = worldPointToCubeLocal(cube, hit.point);
  for (const axis of [faceAxes.horizontal, faceAxes.vertical]) {
    localPoint[axis] = clamp(snapValue(localPoint[axis], event), cube.position[axis], cube.position[axis] + cube.size[axis]);
  }
  return { uid: cube.uid, faceName: hit.faceName, localPoint, worldPoint: cubeLocalPointToWorld(cube, localPoint) };
}

function getKnifePreviewAxis() {
  if (!state.knifeSelection || !state.knifeHover
    || state.knifeSelection.uid !== state.knifeHover.uid
    || state.knifeSelection.faceName !== state.knifeHover.faceName) return null;
  const cube = state.project.getNode(state.knifeSelection.uid);
  return chooseKnifeCutAxis(state.knifeSelection.localPoint, state.knifeHover.localPoint,
    state.knifeSelection.faceName, cube);
}

function getKnifePreviewLabel(axis = getKnifePreviewAxis()) {
  const faceAxes = state.knifeSelection && getKnifeFaceAxes(state.knifeSelection.faceName);
  if (axis === null || !faceAxes) return null;
  return axis === faceAxes.horizontal ? '豎切' : '橫切';
}

function updateKnifeHover(event) {
  state.knifePointer = {
    clientX: event.clientX,
    clientY: event.clientY,
    shiftKey: Boolean(event.shiftKey),
    ctrlKey: Boolean(event.ctrlKey || event.metaKey)
  };
  const candidate = getKnifeCandidate(event);
  state.knifeHover = state.knifeSelection && candidate
    && (candidate.uid !== state.knifeSelection.uid || candidate.faceName !== state.knifeSelection.faceName)
    ? null
    : candidate;
  updateToolOptions();
  renderScene();
}

function refreshKnifeFromModifierEvent(event) {
  updateKnifeHover({
    ...state.knifePointer,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey || event.metaKey
  });
}

function cancelKnifeSelection(notify = true) {
  const hadSelection = Boolean(state.knifeSelection);
  state.knifeSelection = null;
  state.knifeHover = null;
  state.knifePointer = null;
  updateToolOptions();
  if (state.tool === 'knife') renderScene();
  if (notify && hadSelection) toast('已取消切割點');
}

function completeKnifeCut(cube, axis, coordinate) {
  snapshot('core.knife.cube');
  freezeCubeUvs(cube, true);
  const second = splitCubeAt(cube, axis, coordinate);
  if (!second) {
    state.history.pop();
    return toast('切割位置必須位於 Cube 內部');
  }
  state.project.elements.push(second);
  const parent = state.project.getParentGroup(cube.uid);
  const container = parent ? parent.children : state.project.outliner;
  const index = container.indexOf(cube.uid);
  container.splice(index < 0 ? container.length : index + 1, 0, second.uid);
  state.project.invalidateHierarchyIndex();
  const cutLabel = getKnifePreviewLabel(axis);
  state.knifeSelection = null;
  state.knifeHover = null;
  state.knifePointer = null;
  markDirty();
  renderAll();
  toast(`已${cutLabel || '完成切割'} ${cube.name}（${'XYZ'[axis]} 軸）`);
}

function splitBezierAtSegment(curve, segmentIndex) {
  if (!isBezierElement(curve) || segmentIndex < 1 || segmentIndex > curve.nodes.length - 3) {
    return toast('切割後兩端都必須至少保留兩個節點');
  }
  snapshot('core.knife.curve');
  const originalNodes = curve.nodes.map(node => new CurveNode(structuredClone(node), curve.dimension === 2));
  curve.nodes = originalNodes.slice(0, segmentIndex + 1);
  const second = new BezierElement({
    name: curve.name, unnamed: curve.unnamed,
    origin: [...curve.origin], rotation: [...curve.rotation],
    nodes: originalNodes.slice(segmentIndex + 1).map(node => structuredClone(node)),
    parameters: structuredClone(curve.parameters), autoUv: curve.autoUv,
    exported: curve.exported, locked: curve.locked, shade: curve.shade,
    visible: curve.visible, color: curve.color
  }, curve.dimension);
  state.project.elements.push(second);
  const parent = state.project.getParentGroup(curve.uid);
  const container = parent ? parent.children : state.project.outliner;
  const index = container.indexOf(curve.uid);
  container.splice(index < 0 ? container.length : index + 1, 0, second.uid);
  state.project.invalidateHierarchyIndex();
  state.selectedCurveNodeIndex = curve.nodes.length - 1;
  markDirty(); renderAll(); toast('已將貝塞爾元素斷開為兩段');
}

function useKnifePoint(event) {
  const rect = sceneCanvas.getBoundingClientRect();
  const activeCurve = isBezierElement(selected()) ? selected() : null;
  const curveHit = sceneRenderer.pickCurveSegment(state.project,
    event.clientX - rect.left, event.clientY - rect.top, activeCurve?.uid || null);
  if (curveHit) return splitBezierAtSegment(state.project.getNode(curveHit.uid), curveHit.segmentIndex);
  const candidate = getKnifeCandidate(event);
  if (!candidate) return toast(state.knifeSelection ? '第二點必須位於同一個 Cube 面上' : '刀具目前只能切割 Cube');
  const cube = state.project.getNode(candidate.uid);
  if (!state.knifeSelection) {
    if (cube.uid !== state.selectedUid) selectItem(cube.uid, { revealInOutliner: true });
    state.knifeSelection = candidate;
    state.knifeHover = candidate;
    updateToolOptions();
    renderScene();
    toast('已選擇切割點；再選橫切或豎切方向');
    return;
  }
  if (candidate.uid !== state.knifeSelection.uid || candidate.faceName !== state.knifeSelection.faceName) {
    return toast('第二點必須位於同一個 Cube 面上');
  }
  state.knifeHover = candidate;
  const axis = getKnifePreviewAxis();
  if (axis === null) return toast('這個吸附點無法建立有效切面');
  completeKnifeCut(cube, axis, state.knifeSelection.localPoint[axis]);
}

function cssLineColor(variable, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  const rgb = /^#[0-9a-f]{6}$/i.test(value) ? hexToRgb(value) : fallback;
  return [...rgb.map(channel => channel / 255), 1];
}

function offsetKnifePoint(cube, localPoint, faceName) {
  const axes = getKnifeFaceAxes(faceName);
  const point = [...localPoint];
  const center = cube.position[axes.normal] + cube.size[axes.normal] / 2;
  const fallbackSign = ['east', 'up', 'south'].includes(faceName) ? 1 : -1;
  point[axes.normal] += (Math.sign(point[axes.normal] - center) || fallbackSign) * .012;
  return point;
}

function pushKnifeLocalLine(lines, cube, faceName, start, end, color) {
  lines.push({
    start: cubeLocalPointToWorld(cube, offsetKnifePoint(cube, start, faceName)),
    end: cubeLocalPointToWorld(cube, offsetKnifePoint(cube, end, faceName)),
    color
  });
}

function pushKnifeCutLoop(lines, cube, cutAxis, coordinate, color) {
  const [firstAxis, secondAxis] = [0, 1, 2].filter(axis => axis !== cutAxis);
  const inflate = getEffectiveInflate(cube, state.project.getGroupChain(cube.uid));
  const direction = cube.size.map(value => value < 0 ? -1 : 1);
  const surfaceStart = cube.position.map((value, axis) => value - direction[axis] * inflate);
  const surfaceEnd = cube.position.map((value, axis) => value + cube.size[axis] + direction[axis] * inflate);
  const minimum = surfaceStart.map((value, axis) => Math.min(value, surfaceEnd[axis]));
  const maximum = surfaceStart.map((value, axis) => Math.max(value, surfaceEnd[axis]));
  const point = (first, second) => {
    const result = [0, 0, 0];
    result[cutAxis] = coordinate;
    result[firstAxis] = first;
    result[secondAxis] = second;
    return result;
  };
  const corners = [
    point(minimum[firstAxis], minimum[secondAxis]),
    point(maximum[firstAxis], minimum[secondAxis]),
    point(maximum[firstAxis], maximum[secondAxis]),
    point(minimum[firstAxis], maximum[secondAxis])
  ];
  const edges = [
    [0, 1, secondAxis, -1],
    [1, 2, firstAxis, 1],
    [2, 3, secondAxis, 1],
    [3, 0, firstAxis, -1]
  ];
  for (const [startIndex, endIndex, normalAxis, normalSign] of edges) {
    const start = [...corners[startIndex]], end = [...corners[endIndex]];
    start[normalAxis] += normalSign * .012;
    end[normalAxis] += normalSign * .012;
    lines.push({ start: cubeLocalPointToWorld(cube, start), end: cubeLocalPointToWorld(cube, end), color });
  }
}

function pushKnifeCross(lines, candidate, color) {
  if (!candidate) return;
  const cube = state.project.getNode(candidate.uid);
  const axes = cube && getKnifeFaceAxes(candidate.faceName);
  if (!cube || !axes) return;
  const shortest = Math.min(Math.abs(cube.size[axes.horizontal]), Math.abs(cube.size[axes.vertical]));
  const radius = Math.max(.18, Math.min(.52, shortest * .06 || .3));
  const thickness = Math.max(.012, Math.min(.026, radius * .05));
  for (const axis of [axes.horizontal, axes.vertical]) {
    const thicknessAxis = axis === axes.horizontal ? axes.vertical : axes.horizontal;
    for (const offset of [-thickness, 0, thickness]) {
      const start = [...candidate.localPoint], end = [...candidate.localPoint];
      start[axis] = clamp(start[axis] - radius, cube.position[axis], cube.position[axis] + cube.size[axis]);
      end[axis] = clamp(end[axis] + radius, cube.position[axis], cube.position[axis] + cube.size[axis]);
      start[thicknessAxis] = end[thicknessAxis] = clamp(candidate.localPoint[thicknessAxis] + offset,
        cube.position[thicknessAxis], cube.position[thicknessAxis] + cube.size[thicknessAxis]);
      pushKnifeLocalLine(lines, cube, candidate.faceName, start, end, color);
    }
  }
}

function buildKnifeOverlayLines() {
  if (state.tool !== 'knife') return [];
  const lines = [];
  const accent = cssLineColor('--accent', [230, 162, 13]);
  const selectedColor = cssLineColor('--selection-outline', [255, 240, 200]);
  if (state.knifeSelection) pushKnifeCross(lines, state.knifeSelection, selectedColor);
  else if (state.knifeHover) pushKnifeCross(lines, state.knifeHover, accent);
  const axis = getKnifePreviewAxis();
  if (axis === null || !state.knifeSelection) return lines;
  const cube = state.project.getNode(state.knifeSelection.uid);
  pushKnifeCutLoop(lines, cube, axis, state.knifeSelection.localPoint[axis], accent);
  return lines;
}

function buildEditorOverlayLines() {
  return buildKnifeOverlayLines();
}
return { getKnifePreviewLabel, updateKnifeHover, refreshKnifeFromModifierEvent,
  cancelKnifeSelection, useKnifePoint, buildEditorOverlayLines };
}
