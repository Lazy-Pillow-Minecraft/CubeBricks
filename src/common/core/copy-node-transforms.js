// Copy nodes are siblings of their owner. Moving the owner leaves them alone;
// moving an ancestor must translate them alongside that ancestor's contents.
const nodeKey = (modifier, node) => `${modifier.uid}:${node.uid}`;

export function captureSiblingCopyNodes(owner) {
  return new Map((owner.modifiers || []).filter(modifier => modifier.type === 'element_copy')
    .flatMap(modifier => (modifier.nodes || []).map(node => [nodeKey(modifier, node), [...node.position]])));
}

export function translateSiblingCopyNodes(owner, delta, baseline = null) {
  for (const modifier of owner.modifiers || []) {
    if (modifier.type !== 'element_copy') continue;
    for (const node of modifier.nodes || []) {
      const start = baseline ? baseline.get(nodeKey(modifier, node)) : node.position;
      if (start) node.position = start.map((value, axis) => value + delta[axis]);
    }
  }
}
