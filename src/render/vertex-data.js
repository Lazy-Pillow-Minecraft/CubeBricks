// Each vertex stores position, color, normal and UV in 12 consecutive floats.

export const FACE_TRIANGLE_SLOTS = [0, 2, 1, 2, 3, 1];

export function pushVertex(target, position, color, normal = [0, 0, 0], uv = [0, 0]) {
  target.push(position[0], position[1], position[2], color[0], color[1], color[2], color[3], normal[0], normal[1], normal[2], uv[0], uv[1]);
}

export function indexFacesByUid(faces) {
  const byUid = new Map();
  for (const face of faces) {
    let entries = byUid.get(face.uid);
    if (!entries) {
      entries = [];
      byUid.set(face.uid, entries);
    }
    entries.push(face);
  }
  return byUid;
}

export function mergeAdjacentVertexRanges(ranges) {
  const sorted = ranges.map(range => ({ ...range })).sort((left, right) => left.start - right.start);
  const merged = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && previous.start + previous.count === range.start) previous.count += range.count;
    else merged.push(range);
  }
  return merged;
}

export function complementVertexRanges(totalCount, excludedUids, rangesByUid, extraRanges = []) {
  if (!excludedUids?.size && !extraRanges.length) return totalCount ? [{ start: 0, count: totalCount }] : [];
  const excluded = [...(excludedUids || [])]
    .map(uid => rangesByUid.get(uid))
    .concat(extraRanges)
    .filter(range => range?.count)
    .sort((left, right) => left.start - right.start);
  const merged = [];
  for (const range of excluded) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.start + last.count) {
      last.count = Math.max(last.start + last.count, range.start + range.count) - last.start;
    } else merged.push({ ...range });
  }
  const visible = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) visible.push({ start: cursor, count: range.start - cursor });
    cursor = Math.max(cursor, range.start + range.count);
  }
  if (cursor < totalCount) visible.push({ start: cursor, count: totalCount - cursor });
  return visible;
}

export function patchVertexArrays(targetVertices, targetRanges, sourceVertices, sourceRanges, uids) {
  for (const uid of uids) {
    const target = targetRanges.get(uid), source = sourceRanges.get(uid);
    if (!target?.count) continue;
    const sourceStart = source.start * 12;
    const targetStart = target.start * 12;
    for (let index = 0; index < source.count * 12; index++) targetVertices[targetStart + index] = sourceVertices[sourceStart + index];
  }
}

export function collectVertexRanges(vertices, ranges) {
  const list = Array.isArray(ranges) ? ranges : [...ranges];
  const output = new Array(list.reduce((total, range) => total + range.count * 12, 0));
  let cursor = 0;
  for (const range of list) {
    const end = (range.start + range.count) * 12;
    for (let index = range.start * 12; index < end; index++) output[cursor++] = vertices[index];
  }
  return output;
}
