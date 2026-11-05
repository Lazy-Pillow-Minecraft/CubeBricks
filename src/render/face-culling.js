import { isCubeFaceCulled } from '../common/core/geometry-utils.js';
import { formatRules } from '../common/core/format-constraints.js';

export const projectCullsBackfaces = project => Boolean(project?.cullFaces || formatRules(project).forceCullFaces);

// Use the same [0,2,1] winding as the surface triangles. Modifier rays are
// transformed into source space, matching the renderer's reflected winding.
export function faceAcceptsInteraction(face, project, direction = null) {
  if (isCubeFaceCulled(face.cube?.faces?.[face.faceName])) return false;
  if (!direction || !projectCullsBackfaces(project)) return true;
  const [a, b, c] = [face.quad[0], face.quad[2], face.quad[1]];
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return (uy * vz - uz * vy) * direction[0] + (uz * vx - ux * vz) * direction[1]
    + (ux * vy - uy * vx) * direction[2] < 0;
}

export function faceAcceptsCameraInteraction(face, project, camera) {
  if (!camera) return faceAcceptsInteraction(face, project);
  const direction = camera.projection === 'perspective'
    ? face.quad[0].map((value, axis) => value - camera.eye[axis]) : camera.forward;
  return faceAcceptsInteraction(face, project, direction);
}
