function boundsOf(points) {
  if (!points.length) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], point[axis]);
    max[axis] = Math.max(max[axis], point[axis]);
  }
  return { min, max };
}

function unionBounds(boxes) {
  return boundsOf(boxes.filter(Boolean).flatMap(box => [box.min, box.max]));
}

function shifted(box, amount) {
  return { min: box.min.map((value, axis) => value + amount[axis]),
    max: box.max.map((value, axis) => value + amount[axis]) };
}

// Groups are indivisible at their parent's level. Nested groups are laid out
// first, then sibling centres are dilated from their common centre in 3D.
// A common scale preserves symmetry on X, Y and Z, rather than forcing all
// groups into one row and breaking models mirrored around another axis.
export function buildPaintExplodeOffsets(project, ownerPoints, gap = 2) {
  const offsets = new Map();
  const groups = new Map((project.groups || []).map(group => [group.uid, group]));
  const boxes = new Map([...ownerPoints].map(([uid, points]) => [uid, boundsOf(points)]));
  const visiting = new Set();
  const shiftItem = (item, amount) => {
    if (amount.every(value => Math.abs(value) < 1e-9)) return;
    for (const uid of item.uids) {
      const previous = offsets.get(uid) || [0, 0, 0];
      offsets.set(uid, previous.map((value, axis) => value + amount[axis]));
    }
    item.box = shifted(item.box, amount);
  };
  const center = box => box.min.map((value, axis) => (value + box.max[axis]) / 2);
  const pack = (items, originalCenter) => {
    if (!items.length) return null;
    // Exact coincident centres have no radial direction. Give only those a
    // deterministic, centred seed; all other groups retain their direction.
    const coincident = [];
    for (const item of items) {
      const at = center(item.box);
      let bucket = coincident.find(entry => entry.center.every((value, axis) => Math.abs(value - at[axis]) < 1e-6));
      if (!bucket) { bucket = { center: at, items: [] }; coincident.push(bucket); }
      bucket.items.push(item);
    }
    for (const bucket of coincident) {
      if (bucket.items.length < 2) continue;
      const total = bucket.items.reduce((sum, item) => sum + item.box.max[0] - item.box.min[0], 0)
        + gap * (bucket.items.length - 1);
      let cursor = bucket.center[0] - total / 2;
      for (const item of bucket.items) {
        shiftItem(item, [cursor - item.box.min[0], 0, 0]);
        cursor += item.box.max[0] - item.box.min[0] + gap;
      }
    }
    let scale = 1, degenerate = false;
    for (let first = 0; first < items.length; first++) for (let second = first + 1; second < items.length; second++) {
      const a = items[first], b = items[second];
      const ca = center(a.box), cb = center(b.box);
      let required = Infinity;
      for (let axis = 0; axis < 3; axis++) {
        const distance = Math.abs(ca[axis] - cb[axis]);
        if (distance < 1e-8) continue;
        const widths = (a.box.max[axis] - a.box.min[axis] + b.box.max[axis] - b.box.min[axis]) / 2;
        required = Math.min(required, (widths + gap + 1e-6) / distance);
      }
      if (Number.isFinite(required)) scale = Math.max(scale, required);
      else degenerate = true;
    }
    if (degenerate) {
      items.sort((a, b) => center(a.box)[0] - center(b.box)[0]);
      const total = items.reduce((sum, item) => sum + item.box.max[0] - item.box.min[0], 0)
        + gap * (items.length - 1);
      let cursor = originalCenter[0] - total / 2;
      for (const item of items) {
        shiftItem(item, [cursor - item.box.min[0], 0, 0]);
        cursor += item.box.max[0] - item.box.min[0] + gap;
      }
      return unionBounds(items.map(item => item.box));
    }
    for (const item of items) {
      const at = center(item.box);
      shiftItem(item, at.map((value, axis) => (value - originalCenter[axis]) * (scale - 1)));
    }
    return unionBounds(items.map(item => item.box));
  };
  const visit = childUids => {
    const core = [], children = [];
    for (const uid of childUids || []) {
      const group = groups.get(uid);
      if (group) {
        if (visiting.has(uid)) continue;
        visiting.add(uid);
        const item = visit(group.children);
        visiting.delete(uid);
        if (item) children.push(item);
      } else if (boxes.get(uid)) core.push(uid);
    }
    const coreBox = unionBounds(core.map(uid => boxes.get(uid)));
    const items = coreBox ? [{ box: coreBox, uids: core }, ...children] : children;
    const original = unionBounds(items.map(item => item.box));
    if (!original) return null;
    return { box: pack(items, center(original)),
      uids: items.flatMap(item => item.uids) };
  };
  visit(project.outliner || []);
  return offsets;
}

export function applyPaintExplodeOffsets(geometry, offsets) {
  for (const face of geometry.faces) face.modelQuad = face.quad.map(point => [...point]);
  const moveVertices = (vertices, ranges) => {
    for (const [uid, range] of ranges) {
      const move = offsets.get(uid);
      if (!move) continue;
      for (let index = range.start * 12; index < (range.start + range.count) * 12; index += 12)
        for (let axis = 0; axis < 3; axis++) vertices[index + axis] += move[axis];
    }
  };
  moveVertices(geometry.triangles, geometry.triangleRanges);
  moveVertices(geometry.edges, geometry.edgeRanges);
  moveVertices(geometry.helpers, geometry.helperRanges);
  const seen = new Set();
  for (const [uid, points] of geometry.ownerPoints) {
    const move = offsets.get(uid);
    if (!move) continue;
    for (const point of points) {
      if (seen.has(point)) continue;
      seen.add(point);
      for (let axis = 0; axis < 3; axis++) point[axis] += move[axis];
    }
  }
  for (const face of geometry.faces) {
    const move = offsets.get(face.uid) || [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) face.center[axis] += move[axis];
  }
  // These arrays share corner references with ownerPoints, so no second move.
  const bounds = unionBounds([...geometry.ownerPoints.values()].map(boundsOf));
  geometry.bounds = bounds ? { ...bounds,
    center: bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2) } : null;
}
