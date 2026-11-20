import { exportedHierarchy } from './native-common.js';

// Geometry and animation must share the exact same allocation order, including
// a synthetic root for loose elements and names changed by deduplication.
export function bedrockBoneNames(document) {
  const names = new Map(), used = new Set();
  let rootName = null;
  const unique = value => {
    const base = String(value || 'bone').replace(/[^a-zA-Z0-9_.-]/g, '_');
    let name = base, suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    used.add(name); return name;
  };
  exportedHierarchy(document, (node, parents) => {
    if (Array.isArray(node.children)) names.set(node.uuid, unique(node.name));
    else if (!parents.length && rootName === null) rootName = unique('root');
  });
  return { names, rootName };
}
