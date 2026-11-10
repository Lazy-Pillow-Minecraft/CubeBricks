import { formatRules } from '../common/core/format-constraints.js';

// Groups without geometry-producing modifiers can move as one GPU transform.
// Restricted-format bounds and modifier frames keep their existing evaluated
// path until a constraint-aware multi-pose evaluator supplies their matrices.
export function canPreviewRigidGroup(project, node) {
  if (node?.type !== 'group') return false;
  // Separate static/selected draw calls cannot preserve a single global
  // transparency order during a preview transform. Keep that evaluated path.
  if (project.renderType?.startsWith('translucent')) return false;
  const rules = formatRules(project);
  if (rules.javaBlock || rules.bedrockBlock) return false;
  const generated = owner => owner.modifiers?.some(modifier => modifier.enabled && ['symmetry', 'element_copy'].includes(modifier.type));
  if (project.getGroupChain(node.uid).some(generated)) return false;
  const pending = [node], visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current.uid)) continue;
    visited.add(current.uid);
    if (generated(current)) return false;
    if (current.type === 'group') for (const uid of current.children) pending.push(project.getNode(uid));
  }
  return true;
}
