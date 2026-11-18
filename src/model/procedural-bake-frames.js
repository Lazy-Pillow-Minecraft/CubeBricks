import { copyNodeAffine, modifierOwnerTransform, symmetryWorldFrame } from './modifier-evaluation.js';
import { affinePoint, groupChainMatrix, inverseGroupChainPoint, matrixEuler,
  matrixMultiply, matrixTranspose } from './transform-math.js';

// An envelope's baked root moves to its head and adopts its tangent. Geometry
// compensation alone is insufficient: attached modifier/operator frames must
// still describe the same operations in world space after that change.
export function captureBakeFrames(project, owner) {
  return [...(owner.modifiers || []), ...(owner.operators || [])].map(entry => entry.type === 'element_copy'
    ? { uid: entry.uid, copies: (entry.nodes || []).map(node => ({ uid: node.uid, affine: copyNodeAffine(project, owner, node) })) }
    : entry.anchor ? { uid: entry.uid, frame: symmetryWorldFrame(project, owner, entry) } : null).filter(Boolean);
}

export function restoreBakeFrames(project, owner, savedFrames) {
  if (!savedFrames.length) return;
  const parentChain = project.getGroupChain(owner.uid);
  const ownerChain = [...parentChain, modifierOwnerTransform(owner)];
  const inverseOwnerOrientation = matrixTranspose(groupChainMatrix(ownerChain));
  const entries = [...(owner.modifiers || []), ...(owner.operators || [])];
  for (const saved of savedFrames) {
    const entry = entries.find(value => value.uid === saved.uid);
    if (!entry) continue;
    if (saved.frame) {
      entry.anchor.position = inverseGroupChainPoint(saved.frame.center, ownerChain);
      entry.anchor.rotation = matrixEuler(matrixMultiply(inverseOwnerOrientation, saved.frame.matrix));
    } else if (saved.copies) {
      const base = symmetryWorldFrame(project, owner, {
        anchor: { position: modifierOwnerTransform(owner).pivot, rotation: [0, 0, 0] }
      });
      const inverseParentOrientation = matrixTranspose(groupChainMatrix(parentChain));
      for (const node of entry.nodes || []) {
        const original = saved.copies.find(value => value.uid === node.uid);
        if (!original) continue;
        node.position = inverseGroupChainPoint(affinePoint(original.affine, base.center), parentChain);
        node.rotation = matrixEuler(matrixMultiply(inverseParentOrientation,
          matrixMultiply(original.affine.matrix, base.matrix)));
      }
    }
  }
}
