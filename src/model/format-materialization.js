import { constrainCube } from '../common/core/format-constraints.js';
import { foldJavaCubeRotation } from '../utils/math/cube-quarter-turn.js';

// Java entity boxes have no rotation field. Preserve their orientation with
// a bone at the same pivot, retaining the original cube identity underneath.
export function materializeFormatCubeRotations(project, cubes, createGroup, rules = { moddedEntity: true }) {
  const groups = [];
  for (const cube of cubes) {
    const legalCube = !rules.javaBlock || !rules.singleAxisRotation || foldJavaCubeRotation(cube, { ...rules, strict: true });
    const rotation = [...(cube.rotation || [0, 0, 0])];
    if ((!legalCube || rules.moddedEntity) && rotation.some(value => Math.abs(value) > 1e-7)) {
      const parent = project.getParentGroup(cube.uid), siblings = parent ? parent.children : project.outliner;
      const index = siblings.indexOf(cube.uid);
      if (index < 0) continue;
      const group = createGroup({
        name: cube.name, unnamed: false, pivot: [...cube.pivot], rotation,
        children: [cube.uid], uvMode: rules.moddedEntity ? 'box' : 'face', autoUv: rules.moddedEntity || cube.autoUv,
        modifiers: cube.modifiers, operators: cube.operators, appliedTransform: cube.appliedTransform,
        visible: cube.visible, locked: cube.locked, exported: cube.exported, shade: cube.shade
      });
      cube.rotation = [0, 0, 0];
      cube.modifiers = [];
      cube.operators = [];
      cube.appliedTransform = null;
      siblings.splice(index, 1, group.uid);
      project.groups.push(group);
      groups.push(group);
      project.invalidateHierarchyIndex();
    }
    if (rules.moddedEntity) constrainCube(cube, { moddedEntity: true, allowCubeRotation: false, allowBoxUv: true, allowFaceUv: false });
  }
  return groups;
}
