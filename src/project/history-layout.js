const TAU = Math.PI * 2;

// Iterative radial cladogram: chronological siblings, shared ancestry inside,
// tips around the outer rim. Long linear histories never recurse on the stack.
export function layoutProjectHistory(graph, radius = 440) {
  const nodes = new Map((graph?.nodes || []).map(node => [node.sequence, { ...node, children: [], depth: 0, leaves: 0 }]));
  const roots = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.parent);
    if (parent) parent.children.push(node); else roots.push(node);
  }
  roots.sort((a, b) => a.sequence - b.sequence);
  for (const node of nodes.values()) node.children.sort((a, b) => a.sequence - b.sequence);
  const virtualCenter = roots.length > 1 || roots.some(node => node.detached);
  const ordered = [], queue = roots.map(node => ({ node, depth: virtualCenter ? 1 : 0 }));
  let maxDepth = 1;
  for (let index = 0; index < queue.length; index++) {
    const { node, depth } = queue[index];
    node.depth = depth;
    maxDepth = Math.max(maxDepth, depth);
    ordered.push(node);
    for (const child of node.children) queue.push({ node: child, depth: depth + 1 });
  }
  for (let index = ordered.length - 1; index >= 0; index--) {
    const node = ordered[index];
    node.leaves = node.children.length ? node.children.reduce((sum, child) => sum + child.leaves, 0) : 1;
    node.descendants = 1 + node.children.reduce((sum, child) => sum + child.descendants, 0);
  }
  const totalLeaves = roots.reduce((sum, node) => sum + node.leaves, 0) || 1;
  const gap = totalLeaves > 1 ? TAU / totalLeaves : 0;
  let next = 0;
  const spans = roots.map(node => {
    const start = next;
    next += node.leaves;
    return { node, start };
  });
  const points = [], byId = new Map();
  for (let index = 0; index < spans.length; index++) {
    const { node, start } = spans[index];
    const angle = totalLeaves === 1 ? -Math.PI / 2 : -Math.PI / 2 + (start + (node.leaves - 1) / 2) * gap;
    const distance = node.children.length ? node.depth / maxDepth * radius : (node.depth ? radius : 0);
    const point = {
      ...node, angle, radius: distance, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance,
      tip: node.children.length === 0, current: node.sequence === graph.current,
      canDelete: nodes.size > 1, canPrune: node.descendants < nodes.size
    };
    points.push(point);
    byId.set(node.sequence, point);
    let childStart = start;
    for (const child of node.children) {
      spans.push({ node: child, start: childStart });
      childStart += child.leaves;
    }
  }
  // Forks fix the radial structure, while tips lie on the rim. Redistribute
  // each uninterrupted chain across its whole straight segment, including
  // the extra distance to the rim, rather than stretching only its last edge.
  for (const end of points) {
    if (end.children.length === 1) continue;
    const run = [end];
    let parent = byId.get(end.parent);
    while (parent && parent.children.length === 1 && (virtualCenter || byId.has(parent.parent))) {
      run.push(parent);
      parent = byId.get(parent.parent);
    }
    const start = parent?.radius || 0, step = (end.radius - start) / run.length;
    for (let index = 0; index < run.length; index++) {
      const point = run[index];
      point.radius = start + step * (run.length - index);
      point.x = Math.cos(point.angle) * point.radius;
      point.y = Math.sin(point.angle) * point.radius;
    }
  }
  let path = '', detachedPath = '', edgeCount = 0;
  for (const node of points) {
    const parent = byId.get(node.parent);
    if (!parent) {
      if (virtualCenter) detachedPath += `M0,0L${node.x},${node.y}`;
      continue;
    }
    edgeCount++;
    const ax = Math.cos(node.angle) * parent.radius, ay = Math.sin(node.angle) * parent.radius;
    const delta = node.angle - parent.angle;
    path += `M${parent.x},${parent.y}`;
    if (parent.radius && Math.abs(delta) > 1e-9)
      path += `A${parent.radius},${parent.radius} 0 ${Math.abs(delta) > Math.PI ? 1 : 0} ${delta >= 0 ? 1 : 0} ${ax},${ay}`;
    path += `L${node.x},${node.y}`;
  }
  const buckets = new Map(), cell = 24;
  for (const point of points) {
    const key = `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)}`;
    const bucket = buckets.get(key) || [];
    bucket.push(point);
    buckets.set(key, bucket);
  }
  return { points, byId, path, detachedPath, virtualCenter, edgeCount, tipCount: totalLeaves, buckets, cell };
}

export function nearestHistoryNode(layout, x, y, radius) {
  if (!layout) return null;
  let closest = null, distance = radius * radius;
  const { cell, buckets } = layout;
  for (let row = Math.floor((y - radius) / cell); row <= Math.floor((y + radius) / cell); row++)
    for (let column = Math.floor((x - radius) / cell); column <= Math.floor((x + radius) / cell); column++)
      for (const node of buckets.get(`${column},${row}`) || []) {
        const squared = (node.x - x) ** 2 + (node.y - y) ** 2;
        if (squared <= distance) {
          closest = node;
          distance = squared;
        }
      }
  return closest;
}
