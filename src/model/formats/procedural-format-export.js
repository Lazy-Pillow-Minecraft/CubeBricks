import { exportedHierarchy, flattenedCube, vector } from './native-common.js';
import { rotatePoint } from '../../common/core/geometry-utils.js';
import { constrainJavaProceduralCube } from '../../common/core/procedural-format.js';

// Java groups are editor organization, not runtime bones. Collapse their poses
// into legal cube data while retaining the outline and its names/identities.
export function materializeJavaProceduralDocument(document, rules) {
  const groups = [];
  exportedHierarchy(document, (node, parents) => {
    if (Array.isArray(node.children)) {
      let pivot = vector(node.origin);
      for (const parent of [...parents].reverse()) pivot = rotatePoint(pivot, vector(parent.origin), vector(parent.rotation));
      groups.push([node, pivot]); return;
    }
    if (!node.from) return;
    // Inflation remains an independent property in bbmodel.
    const pose = flattenedCube({ ...node, inflate: 0 }, parents);
    const cube = { position: pose.from, size: pose.to.map((value, axis) => value - pose.from[axis]),
      pivot: pose.pivot, rotation: pose.rotation, faces: structuredClone(node.faces),
      uvMode: node.box_uv ? 'box' : 'face', uv: node.uv_offset || [0, 0], mirrorUv: node.mirror_uv,
      autoUv: node.autouv !== 0, inflate: Number(node.inflate) || 0, rescale: node.rescale && !pose.rescaleBaked };
    constrainJavaProceduralCube({ origin: [0, 0, 0], rotation: [0, 0, 0] }, cube, { rules, project: null, preserveFaceBasis: false });
    Object.assign(node, { from: cube.position, to: cube.position.map((value, axis) => value + cube.size[axis]),
      origin: cube.pivot, rotation: cube.rotation, faces: cube.faces, box_uv: false, rescale: cube.rescale, inflate: cube.inflate });
  });
  for (const [group, pivot] of groups) { group.origin = pivot; group.rotation = [0, 0, 0]; group.box_uv = false; }
  return document;
}
