export function indexFaces(faces) {
  const index = new Map();
  for (const face of faces || []) index.set(`${face.uid}::${face.faceName}`, face);
  return index;
}

export function buildFaceBvh(faces, leafSize = 8) {
  if (!faces?.length) return null;
  const entries = faces.map(face => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    updateFaceBounds(face.quad, min, max);
    return { face, min, max, center: min.map((value, axis) => (value + max[axis]) / 2) };
  });
  const build = list => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const entry of list) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], entry.min[axis]);
      max[axis] = Math.max(max[axis], entry.max[axis]);
    }
    if (list.length <= leafSize) return { min, max, entries: list };
    const extent = max.map((value, axis) => value - min[axis]);
    const axis = extent.indexOf(Math.max(...extent));
    list.sort((left, right) => left.center[axis] - right.center[axis]);
    const middle = Math.floor(list.length / 2);
    return { min, max, left: build(list.slice(0, middle)), right: build(list.slice(middle)) };
  };
  const root = build(entries);
  const entriesByUid = new Map();
  const visit = (node, parent = null, depth = 0) => {
    node.parent = parent;
    node.depth = depth;
    if (node.entries) {
      for (const entry of node.entries) {
        entry.leaf = node;
        if (!entriesByUid.has(entry.face.uid)) entriesByUid.set(entry.face.uid, []);
        entriesByUid.get(entry.face.uid).push(entry);
      }
    } else {
      visit(node.left, node, depth + 1);
      visit(node.right, node, depth + 1);
    }
  };
  visit(root);
  root.entriesByUid = entriesByUid;
  root.refitCount = 0;
  return root;
}

function updateFaceBounds(quad, min, max) {
  min[0] = min[1] = min[2] = Infinity;
  max[0] = max[1] = max[2] = -Infinity;
  for (const point of quad) for (let axis = 0; axis < 3; axis++) {
    if (point[axis] < min[axis]) min[axis] = point[axis];
    if (point[axis] > max[axis]) max[axis] = point[axis];
  }
  for (let axis = 0; axis < 3; axis++) { min[axis] -= 1e-6; max[axis] += 1e-6; }
}

export function refitFaceBvh(root, changedUids) {
  if (!root?.entriesByUid || root.refitCount >= 32) return false;
  const affected = new Set();
  for (const uid of changedUids) {
    for (const entry of root.entriesByUid.get(uid) || []) {
      updateFaceBounds(entry.face.quad, entry.min, entry.max);
      for (let axis = 0; axis < 3; axis++) {
        entry.center[axis] = (entry.min[axis] + entry.max[axis]) / 2;
      }
      for (let node = entry.leaf; node; node = node.parent) affected.add(node);
    }
  }
  // Descendants must be updated before their ancestors.
  for (const node of [...affected].sort((left, right) => right.depth - left.depth)) {
    const children = node.entries || [node.left, node.right];
    for (let axis = 0; axis < 3; axis++) {
      node.min[axis] = Math.min(...children.map(entry => entry.min[axis]));
      node.max[axis] = Math.max(...children.map(entry => entry.max[axis]));
    }
  }
  root.refitCount++;
  return true;
}

function rayBoundsDistance(origin, direction, min, max, maximum = Infinity) {
  let near = 0, far = maximum;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-10) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
      continue;
    }
    let first = (min[axis] - origin[axis]) / direction[axis];
    let second = (max[axis] - origin[axis]) / direction[axis];
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (far < near) return null;
  }
  return far >= 0 ? near : null;
}

export function queryFaceBvh(root, ray, maximum = Infinity) {
  if (!root) return [];
  const candidates = [];
  const firstDistance = rayBoundsDistance(ray.origin, ray.direction, root.min, root.max, maximum);
  if (firstDistance === null) return candidates;
  const stack = [{ node: root, distance: firstDistance }];
  while (stack.length) {
    const { node } = stack.pop();
    if (node.entries) {
      for (const entry of node.entries) {
        const distance = rayBoundsDistance(ray.origin, ray.direction, entry.min, entry.max, maximum);
        if (distance !== null) candidates.push({ face: entry.face, distance });
      }
      continue;
    }
    const leftDistance = rayBoundsDistance(ray.origin, ray.direction, node.left.min, node.left.max, maximum);
    const rightDistance = rayBoundsDistance(ray.origin, ray.direction, node.right.min, node.right.max, maximum);
    if (leftDistance !== null && rightDistance !== null) {
      if (leftDistance <= rightDistance) {
        stack.push({ node: node.right, distance: rightDistance }, { node: node.left, distance: leftDistance });
      } else stack.push({ node: node.left, distance: leftDistance }, { node: node.right, distance: rightDistance });
    } else if (leftDistance !== null) stack.push({ node: node.left, distance: leftDistance });
    else if (rightDistance !== null) stack.push({ node: node.right, distance: rightDistance });
  }
  candidates.sort((left, right) => left.distance - right.distance);
  return candidates.map(entry => entry.face);
}

