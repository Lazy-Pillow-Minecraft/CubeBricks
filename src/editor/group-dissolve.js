import { Group, refreshAutomaticNodeName } from '../model.js';
import { formatRules } from '../common/core/format-constraints.js';
import { transformPosition } from '../common/core/applied-transform.js';
import { rescaleRotationPoint } from '../common/core/geometry-utils.js';
import { materializeFormatCubeRotations } from '../model/format-materialization.js';
import { affineIdentity, groupChainMatrix, matrixEuler, matrixMultiply, matrixTranspose, matrixVector, rotationMatrix } from '../model/transform-math.js';
import { captureToolboxSelection, transformToolboxSelection } from './toolbox/model-transforms.js';

// Remove exactly one hierarchy layer. Capture the old world frames before
// touching membership, then re-express every descendant in its new parent
// frame. Without rotation compensation, retain the original local data and
// let removing this parent change the resulting world pose naturally.
// Child groups, Shapes, UVs, IDs and their attached stacks survive.
export function dissolveGroupInPlace(project, groupUid, { compensateRotation = true } = {}) {
  const group = project.getNode(groupUid);
  if (group?.type !== 'group') return null;
  const parent = project.getParentGroup(groupUid), siblings = parent ? parent.children : project.outliner;
  const index = siblings.indexOf(groupUid);
  if (index < 0) return null;
  const children = [...group.children];
  const capture = compensateRotation ? captureToolboxSelection(project, [group]) : { entries: [] };
  capture.entries = capture.entries.filter(entry => entry.node !== group);
  const rules = formatRules(project);
  // Restricted formats may move the inherited rotation into a legal bone.
  // Consume rescale first so moving that rotation does not resize the Cube.
  if (rules.moddedEntity || rules.javaBlock) for (const { node, data, sources } of capture.entries) {
    if (node.type !== 'cube' || !data.rescale) continue;
    // Java's format adapter materializes the Cube's own rescale before
    // applying inherited inflation; use the same order as its live preview.
    const inflate = (Number(data.inflate) || 0) + (rules.javaBlock ? 0 : sources[0]?.groupInflate || 0);
    const signs = data.size.map(value => value < 0 ? -1 : 1), previousPosition = data.position;
    const from = rescaleRotationPoint(data.position.map((value, axis) => value - signs[axis] * inflate), data.pivot, data.rotation, true);
    const to = rescaleRotationPoint(data.position.map((value, axis) => value + data.size[axis] + signs[axis] * inflate), data.pivot, data.rotation, true);
    data.position = from.map((value, axis) => value + signs[axis] * inflate);
    data.size = to.map((value, axis) => value - from[axis] - 2 * signs[axis] * inflate);
    if (data.appliedTransform?.position) data.appliedTransform.position = data.appliedTransform.position
      .map((value, axis) => value + data.position[axis] - previousPosition[axis]);
    data.rescale = node.rescale = false;
  }
  siblings.splice(index, 1, ...children);
  project.groups = project.groups.filter(node => node !== group);
  project.invalidateHierarchyIndex();
  if (compensateRotation) transformToolboxSelection(project, capture, affineIdentity());

  for (const { node, data, chain } of capture.entries) {
    if (!data.appliedTransform) continue;
    const basis = matrixMultiply(matrixTranspose(groupChainMatrix(project.getGroupChain(node.uid))), groupChainMatrix(chain));
    if (data.appliedTransform.rotation)
      node.appliedTransform.rotation = matrixEuler(matrixMultiply(basis, rotationMatrix(data.appliedTransform.rotation)));
    if (data.appliedTransform.position) {
      const offset = transformPosition(data).map((value, axis) => value - data.appliedTransform.position[axis]);
      const moved = matrixVector(basis, offset);
      node.appliedTransform.position = transformPosition(node).map((value, axis) => value - moved[axis]);
    }
  }
  for (const uid of children) {
    const child = project.getNode(uid);
    if (!child) continue;
    if ('inflate' in child) child.inflate += Number(group.inflate) || 0;
    for (const field of ['visible', 'shade', 'exported']) if (group[field] === false) child[field] = false;
    if (group.locked) child.locked = true;
    refreshAutomaticNodeName(project, child);
  }

  // Formats that cannot store a Cube's newly inherited rotation still need a
  // legal rotation bone. Reuse the export/bake adapter rather than erase it.
  const wrappers = rules.moddedEntity || rules.javaBlock
    ? materializeFormatCubeRotations(project, capture.entries.filter(entry => entry.node.type === 'cube')
      .map(entry => entry.node), data => new Group(data), rules) : [];
  const wrapperByChild = new Map(wrappers.map(wrapper => [wrapper.children[0], wrapper.uid]));
  return { children: children.map(uid => wrapperByChild.get(uid) || uid), parentUid: parent?.uid || null };
}
