// Build CPU-side geometry and vertex ranges for the viewport buffers.

import { applyGroupTransforms, getEffectiveInflate, hasAssignedFaceTexture, isCubeFaceCulled, rescaleRotationPoint, rotatePoint, UV_PREVIEW_CULLED_UV } from '../common/core/geometry-utils.js';
import { constrainElementCube } from '../common/core/procedural-format.js';
import { tiledFaceReference, tiledFaceRegions } from '../common/core/texture-features.js';
import { FACE_TRIANGLE_SLOTS, pushVertex } from './vertex-data.js';
import { createAtlasFaceUvs, getFaceUv, textureLayoutEntry } from './face-uv.js';
import { averagePoints, cross, hexToRgb, normalize, subtract } from './viewport-math.js';

export const GRID_MAJOR_COLOR = Object.freeze([.43, .34, .5, .38]);

// Each face is expressed in Blockbench's four UV vertex slots:
// top-left, top-right, bottom-left, bottom-right. The triangle order mirrors
// Blockbench's BoxGeometry index order: 0,2,1 and 2,3,1.
const FACE_LAYOUTS = Object.freeze({
  south: [7, 6, 4, 5],
  north: [2, 3, 1, 0],
  east: [6, 2, 5, 1],
  west: [3, 7, 0, 4],
  up: [3, 2, 7, 6],
  down: [4, 5, 0, 1]
});

const FACE_PREVIEW_COLORS = Object.freeze({
  north: [0.91, 0.38, 0.35],
  south: [0.94, 0.67, 0.28],
  east: [0.27, 0.65, 0.92],
  west: [0.62, 0.43, 0.86],
  up: [0.48, 0.82, 0.42],
  down: [0.28, 0.50, 0.48]
});

const UNTEXTURED_UV_SENTINEL = -1000000;

export function normalizeSelectedNodeUids(selection) {
  if (!selection) return new Set();
  if (typeof selection === 'string') return new Set([selection]);
  return new Set(selection);
}

export function getDynamicElementUids(project, selection) {
  const dynamic = new Set();
  const visit = uid => {
    const node = project.getNode(uid);
    if (!node) return;
    if (node.type === 'group') node.children.forEach(visit);
    else dynamic.add(node.uid);
  };
  normalizeSelectedNodeUids(selection).forEach(visit);
  return dynamic;
}

export function collectLockedState(project) {
  const nodes = new Map([...project.elements, ...project.groups].map(node => [node.uid, node]));
  const elementUids = new Set(project.elements.map(element => element.uid));
  const uids = new Set(project.elements.filter(element => element.locked).map(element => element.uid));
  const visitedGroups = new Map();
  const visit = (uid, inheritedLocked = false) => {
    const node = nodes.get(uid);
    if (!node || node.type !== 'group') return;
    const locked = inheritedLocked || node.locked === true;
    const previous = visitedGroups.get(uid);
    if (previous === true || previous === locked) return;
    visitedGroups.set(uid, locked);
    for (const childUid of node.children) {
      if (elementUids.has(childUid)) {
        const child = nodes.get(childUid);
        if (locked || child?.locked) uids.add(childUid);
      } else visit(childUid, locked);
    }
  };
  project.outliner.forEach(uid => visit(uid, false));
  project.groups.forEach(group => visit(group.uid, false));
  return { uids, nodes };
}

export function buildElementGeometry(project, elements, selection, selectionOutline = [1, 1, 1], faceDistinct = false, textureLayout = null) {
  const selectedUids = normalizeSelectedNodeUids(selection);
  const triangles = [];
  const faces = [];
  const edges = [];
  const helpers = [];
  const ownerPoints = new Map();
  const boundsPoints = [];
  const triangleRanges = new Map();
  const edgeRanges = new Map();
  const helperRanges = new Map();
  const cubeTriangleRanges = new Map();
  const cubeEdgeRanges = new Map();
  const cubePoints = new Map();
  for (const element of elements) {
    const triangleStart = triangles.length / 12;
    const edgeStart = edges.length / 12;
    const helperStart = helpers.length / 12;
    const elementCubeTriangles = [], elementCubeEdges = [];
    const elementCubePoints = [];
    const finishRanges = () => {
      triangleRanges.set(element.uid, { start: triangleStart, count: triangles.length / 12 - triangleStart });
      edgeRanges.set(element.uid, { start: edgeStart, count: edges.length / 12 - edgeStart });
      helperRanges.set(element.uid, { start: helperStart, count: helpers.length / 12 - helperStart });
      cubeTriangleRanges.set(element.uid, elementCubeTriangles);
      cubeEdgeRanges.set(element.uid, elementCubeEdges);
      cubePoints.set(element.uid, elementCubePoints);
    };
    const subdivisionOwner = element.subdivisionOwnerUid && project.getNode(element.subdivisionOwnerUid);
    const groupChain = project.getGroupChain(subdivisionOwner?.uid || element.uid);
    const selectedByGroup = groupChain.some(group => selectedUids.has(group.uid));
    const selectedForBounds = selectedUids.has(element.uid) || selectedByGroup;
    if (element.type === 'locator' || element.type === 'node') {
      const geometry = element.type === 'locator' ? locatorGeometry(element, groupChain) : nodeElementGeometry(element, groupChain);
      if (element.visible) helpers.push(...geometry.lines);
      if (element.visible) ownerPoints.set(element.uid, geometry.points);
      if (element.visible || selectedForBounds) boundsPoints.push(...geometry.points);
      finishRanges();
      continue;
    }
    if (element.type === 'bezier2d' || element.type === 'bezier3d') {
      const curveGeometry = bezierHelperGeometry(element, groupChain);
      if (element.visible) helpers.push(...curveGeometry.lines);
    }
    const cubes = subdivisionOwner
      ? [{
        cube: element,
        offset: subdivisionOwner.origin || [0, 0, 0],
        ownerRotation: subdivisionOwner.rotation || [0, 0, 0],
        ownerOrigin: subdivisionOwner.pivot || subdivisionOwner.origin || [0, 0, 0],
        groupChain,
        textureSize: project.textureSize,
        shade: element.shade !== false && subdivisionOwner.shade !== false
      }]
      : typeof element.toCubes === 'function'
        ? element.toCubes(project).map((cube, cubeIndex) => ({
          cube,
          cubeIndex,
          offset: element.origin,
          ownerRotation: element.rotation,
          ownerOrigin: element.pivot || element.origin,
          groupChain,
          textureSize: project.textureSize,
          shade: element.shade
        }))
        : [{
          cube: constrainElementCube(project, element),
          offset: [0, 0, 0],
          ownerRotation: [0, 0, 0],
          ownerOrigin: element.pivot,
          groupChain,
          textureSize: project.textureSize,
          shade: element.shade
        }];

    if (!element.visible) {
      if (selectedForBounds) boundsPoints.push(...cubes.flatMap(cubeWorldCorners));
      finishRanges();
      continue;
    }

    for (const entry of cubes) {
      const cubeTriangleStart = triangles.length / 12;
      const cubeEdgeStart = edges.length / 12;
      const geometry = cubeGeometry(entry, element.color, selectedForBounds, selectionOutline, faceDistinct, textureLayout);
      triangles.push(...geometry.triangles);
      faces.push(...geometry.faces.map(face => ({
        ...face, uid: element.uid, cube: entry.cube,
        cubeUid: entry.cube.uid || element.uid,
        cubeIndex: entry.cubeIndex ?? entry.cube.subdivisionIndex ?? null
      })));
      edges.push(...geometry.edges);
      elementCubeTriangles.push({ start: cubeTriangleStart, count: triangles.length / 12 - cubeTriangleStart });
      elementCubeEdges.push({ start: cubeEdgeStart, count: edges.length / 12 - cubeEdgeStart });
      elementCubePoints.push(geometry.corners);
      if (!ownerPoints.has(element.uid)) ownerPoints.set(element.uid, []);
      ownerPoints.get(element.uid).push(...geometry.corners);
      boundsPoints.push(...geometry.corners);
    }
    finishRanges();
  }
  const bounds = geometryBounds(boundsPoints);
  return {
    triangles, faces, edges, helpers, ownerPoints, triangleRanges, edgeRanges, helperRanges,
    cubeTriangleRanges, cubeEdgeRanges, cubePoints, bounds, boundsPoints
  };
}

export function geometryBounds(points) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const point of points) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], point[axis]);
      maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
    found = true;
  }
  if (!found) return null;
  return {
    min: minimum,
    max: maximum,
    center: minimum.map((value, axis) => (value + maximum[axis]) / 2)
  };
}

function locatorGeometry(locator, groupChain) {
  const origin = locator.position || [0, 0, 0];
  const points = [applyGroupTransforms(origin, groupChain)];
  return { lines: [], points };
}

export function nodeLocalPoint(element, point) {
  const translated = point.map((value, axis) => value + element.origin[axis]);
  return rotatePoint(translated, element.origin, element.rotation || [0, 0, 0]);
}

function appendLine(lines, start, end, color = [1, 1, 1, .9]) {
  pushVertex(lines, start, color);
  pushVertex(lines, end, color);
}

function curveNodeMark(node, transformPoint) {
  const lines = [], points = [];
  const center = transformPoint(node.position);
  const oriented = offset => transformPoint(rotatePoint(
    node.position.map((value, axis) => value + offset[axis]), node.position, node.rotation || [0, 0, 0]));
  const rawDirection = node.directionVector || (node.handlesEnabled ? node.handleOut : null) || [0, 0, 1];
  const directionLength = Math.hypot(...rawDirection) || 1;
  const directionEnd = oriented(rawDirection.map(value => value / directionLength * 1.25));
  appendLine(lines, center, directionEnd);
  points.push(center, directionEnd);
  let previous = oriented([.38, 0, 0]);
  for (let index = 1; index <= 20; index++) {
    const angle = index / 20 * Math.PI * 2;
    const next = oriented([Math.cos(angle) * .38, 0, Math.sin(angle) * .38]);
    appendLine(lines, previous, next, [1, 1, 1, .78]);
    points.push(next);
    previous = next;
  }
  if (node.handlesEnabled) {
    const handleIn = oriented(node.handleIn);
    const handleOut = oriented(node.handleOut);
    appendLine(lines, handleIn, center, [1, 1, 1, .58]);
    appendLine(lines, center, handleOut, [1, 1, 1, .58]);
    points.push(handleIn, handleOut);
  }
  return { lines, points };
}

function nodeElementGeometry(element, groupChain) {
  const node = {
    position: element.position,
    rotation: element.rotation,
    handlesEnabled: element.handlesEnabled,
    handleIn: element.handleIn,
    handleOut: element.handleOut
  };
  const transformPoint = point => applyGroupTransforms(point, groupChain);
  return curveNodeMark(node, transformPoint);
}

function bezierHelperGeometry(element, groupChain) {
  const lines = [], points = [];
  const transformPoint = point => applyGroupTransforms(nodeLocalPoint(element, point), groupChain);
  const sampled = element.sampleCurve();
  for (let index = 0; index < sampled.length - 1; index++) {
    const start = transformPoint(sampled[index].point);
    const end = transformPoint(sampled[index + 1].point);
    appendLine(lines, start, end, [1, 1, 1, .7]);
    points.push(start, end);
  }
  element.nodes.forEach((node, index) => {
    const resolved = element.resolvedNodeState(index);
    const directionVector = index < element.nodes.length - 1
      ? resolved.localHandleOut
      : resolved.localHandleIn.map(value => -value);
    const geometry = curveNodeMark({
      ...node,
      rotation: resolved.rotation,
      handleIn: resolved.localHandleIn,
      handleOut: resolved.localHandleOut,
      directionVector
    }, transformPoint);
    lines.push(...geometry.lines);
    points.push(...geometry.points);
  });
  return { lines, points };
}

export function mergeOwnerPoints(staticPoints, dynamicPoints) {
  const merged = new Map();
  for (const [uid, points] of staticPoints) merged.set(uid, points);
  for (const [uid, points] of dynamicPoints) merged.set(uid, points);
  return merged;
}

export function createSignedCubeCorners(position, size, inflate = 0) {
  const direction = size.map(value => value < 0 ? -1 : 1);
  const from = position.map((value, axis) => value - direction[axis] * inflate);
  const to = position.map((value, axis) => value + size[axis] + direction[axis] * inflate);
  return [
    [from[0], from[1], from[2]], [to[0], from[1], from[2]], [to[0], to[1], from[2]], [from[0], to[1], from[2]],
    [from[0], from[1], to[2]], [to[0], from[1], to[2]], [to[0], to[1], to[2]], [from[0], to[1], to[2]]
  ];
}

function cubeGeometry(entry, color, selected, selectionOutline = [1, 1, 1], faceDistinct = false, textureLayout = null) {
  const corners = cubeWorldCorners(entry);
  const { cube, offset, ownerRotation, ownerOrigin, groupChain, textureSize, shade } = entry;

  const edgeBoost = selected ? 1.08 : 1;
  const triangles = [], faceBatches = [];
  for (const [faceName, quadIndices] of Object.entries(FACE_LAYOUTS)) {
    const faceData = cube.faces?.[faceName];
    // A face without a texture remains renderable using the same display
    // colour as solid mode. Only an explicitly culled face is omitted.
    if (isCubeFaceCulled(faceData)) continue;
    const culledPreview = faceData?._uvPreviewCulled === true;
    const textured = !culledPreview && hasAssignedFaceTexture(faceData);
    const indices = FACE_TRIANGLE_SLOTS.map(slot => quadIndices[slot]);
    const a = corners[indices[0]], b = corners[indices[1]], c = corners[indices[2]];
    const normal = normalize(cross(subtract(b, a), subtract(c, a)));
    const sourceColor = getCubeFaceDisplayColor(color, faceName, faceDistinct);
    const faceColor = sourceColor.map(channel => Math.min(1, channel * edgeBoost));
    const faceUv = culledPreview ? Array.from({ length: 6 }, () => [UV_PREVIEW_CULLED_UV, UV_PREVIEW_CULLED_UV]) : textured
      ? getFaceUv(cube, faceName, textureSize, textureLayout)
      : Array.from({ length: 6 }, () => [UNTEXTURED_UV_SENTINEL, UNTEXTURED_UV_SENTINEL]);
    const faceVertices = [];
    const textureEntry = textureLayoutEntry(textureLayout, faceData?.texture);
    const quad = quadIndices.map(index => corners[index]);
    if (textured && textureEntry?.mode === 'tiled') {
      const regions = tiledFaceRegions(cube, faceName);
      const point = (u, v) => quad[0].map((value, axis) => value + (quad[1][axis] - value) * u + (quad[2][axis] - value) * v);
      for (const region of regions) {
        const tileEntry = textureLayout.byReference.get(tiledFaceReference(cube, faceName, textureEntry, region));
        if (!tileEntry) continue;
        const points = [point(region.x / region.faceWidth, region.y / region.faceHeight), point((region.x + region.width) / region.faceWidth, region.y / region.faceHeight), point(region.x / region.faceWidth, (region.y + region.height) / region.faceHeight), point((region.x + region.width) / region.faceWidth, (region.y + region.height) / region.faceHeight)];
        const uvs = createAtlasFaceUvs([0, 0, tileEntry.width, tileEntry.height], 0, tileEntry, [textureLayout.width, textureLayout.height]);
        FACE_TRIANGLE_SLOTS.forEach((slot, index) => pushVertex(faceVertices, points[slot], [...faceColor, selected ? 2 : 1], shade === false ? [0, 0, 0] : normal, uvs[index]));
      }
    } else indices.forEach((index, vertexIndex) => pushVertex(faceVertices, corners[index], [...faceColor, selected ? 2 : 1], shade === false ? [0, 0, 0] : normal, faceUv[vertexIndex]));
    triangles.push(...faceVertices);
    faceBatches.push({ faceName, quad, vertices: faceVertices, center: averagePoints(quad) });
  }
  const edges = [], edgeColor = selected ? [...selectionOutline, 1] : [.46, .56, .4, 1];
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
    pushVertex(edges, corners[a], edgeColor);
    pushVertex(edges, corners[b], edgeColor);
  }
  return { triangles, faces: faceBatches, edges, corners };
}

export function getCubeFaceDisplayColor(color, faceName, faceDistinct = false) {
  return faceDistinct ? FACE_PREVIEW_COLORS[faceName] : hexToRgb(color);
}

function cubeWorldCorners(entry) {
  const { cube, offset, ownerRotation, ownerOrigin, groupChain } = entry;
  const inflate = getEffectiveInflate(cube, groupChain);
  const start = cube.position.map((value, axis) => value + offset[axis]);
  const cubePivot = cube.pivot.map((value, axis) => value + offset[axis]);
  return createSignedCubeCorners(start, cube.size, inflate)
    .map(point => rescaleRotationPoint(point, cubePivot, cube.rotation || [0, 0, 0], cube.rescale))
    .map(point => rotatePoint(point, cubePivot, cube.rotation || [0, 0, 0]))
    .map(point => rotatePoint(point, ownerOrigin, ownerRotation || [0, 0, 0]))
    .map(point => applyGroupTransforms(point, groupChain));
}

export function gridGeometry(subdivisions = 16, javaBlock = false) {
  const fine = [], major = [], direction = [];
  const floorY = -.025;
  const shift = javaBlock ? 8 : 0;
  const majorColor = GRID_MAJOR_COLOR;
  const fineColor = [.46, .37, .54, .28];
  for (const coordinate of [-24, -8, 8, 24]) {
    pushVertex(major, [coordinate + shift, floorY, -24 + shift], majorColor);
    pushVertex(major, [coordinate + shift, floorY, 24 + shift], majorColor);
    pushVertex(major, [-24 + shift, floorY, coordinate + shift], majorColor);
    pushVertex(major, [24 + shift, floorY, coordinate + shift], majorColor);
  }

  const count = Math.max(1, Math.min(512, Number(subdivisions) || 16));
  const step = 16 / count;
  for (let index = 1; index < count; index++) {
    const coordinate = -8 + shift + index * step;
    if (Math.abs(coordinate) < .00001) continue;
    pushVertex(fine, [coordinate, floorY, -8 + shift], fineColor);
    pushVertex(fine, [coordinate, floorY, 8 + shift], fineColor);
    pushVertex(fine, [-8 + shift, floorY, coordinate], fineColor);
    pushVertex(fine, [8 + shift, floorY, coordinate], fineColor);
  }
  pushVertex(fine, [shift, floorY, -8 + shift], fineColor);
  pushVertex(fine, [shift, floorY, shift], fineColor);
  pushVertex(fine, [-8 + shift, floorY, shift], fineColor);
  pushVertex(fine, [shift, floorY, shift], fineColor);

  const addLine = (a, b, color) => {
    pushVertex(direction, a, color);
    pushVertex(direction, b, color);
  };
  const red = [.96, .18, .28, .9], blue = [.18, .42, 1, .9], marker = [.55, .43, .65, .72];
  addLine([0, floorY + .004, 0], [javaBlock ? 16 : 8, floorY + .004, 0], red);
  addLine([0, floorY + .004, 0], [0, floorY + .004, javaBlock ? 16 : 8], blue);
  const y = floorY + .006;
  // Minecraft north is negative Z. Keep the N and arrow centred above the central cell.
  addLine([shift - .45, y, shift - 8.65], [shift - .45, y, shift - 9.75], marker);
  addLine([shift - .45, y, shift - 9.75], [shift + .45, y, shift - 8.65], marker);
  addLine([shift + .45, y, shift - 8.65], [shift + .45, y, shift - 9.75], marker);
  addLine([shift - .42, y, shift - 10.15], [shift, y, shift - 10.57], marker);
  addLine([shift, y, shift - 10.57], [shift + .42, y, shift - 10.15], marker);
  return { fine, major, direction };
}

export function boundsWireGeometry(points, color = [.82, 1, .48, .68]) {
  if (!points.length) return [];
  const min = [...points[0]];
  const max = [...points[0]];
  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    for (let axis = 0; axis < 3; axis++) {
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
  }
  const corners = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]
  ];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const vertices = [];
  for (const [a, b] of edges) {
    pushVertex(vertices, corners[a], color);
    pushVertex(vertices, corners[b], color);
  }
  return vertices;
}
