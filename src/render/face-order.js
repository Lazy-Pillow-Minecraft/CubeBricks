export function faceCameraDepth(face, eye, forward) {
  return (face.center[0] - eye[0]) * forward[0]
    + (face.center[1] - eye[1]) * forward[1]
    + (face.center[2] - eye[2]) * forward[2];
}

export function facesRemainDepthSorted(faces, eye, forward) {
  if (!faces.length) return true;
  let previousDepth = faceCameraDepth(faces[0], eye, forward);
  for (let index = 1; index < faces.length; index++) {
    const nextDepth = faceCameraDepth(faces[index], eye, forward);
    // Coplanar faces retain the last stable order. Only an actual crossing
    // requires a new sort; equality otherwise causes endless buffer uploads.
    if (previousDepth < nextDepth) return false;
    previousDepth = nextDepth;
  }
  return true;
}

export function sortFacesByDepth(faces, eye, forward) {
  return faces
    .map((face, index) => ({ face, index, depth: faceCameraDepth(face, eye, forward) }))
    .sort((left, right) => right.depth - left.depth || left.index - right.index)
    .map(entry => entry.face);
}
