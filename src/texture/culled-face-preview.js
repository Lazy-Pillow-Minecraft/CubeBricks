import { isCubeFaceCulled } from '../common/core/geometry-utils.js';

const FACES = ['north', 'east', 'south', 'west', 'up', 'down'];
export function createUvPreviewElement(source) {
  let hasCulledFaces = false;
  const previewCube = cube => {
    const preview = Object.assign(Object.create(cube), { visible: true, locked: false, modifiers: [] });
    preview.faces = Object.fromEntries(FACES.map(name => {
      const face = cube.faces?.[name];
      if (!isCubeFaceCulled(face)) return [name, face ? { ...face } : face];
      hasCulledFaces = true;
      // This visual placeholder remains pickable in UV Preview for restoring
      // the real face. No texture, UV rotation or face tint is rendered on it.
      return [name, { enabled: true, _uvPreviewCulled: true }];
    }));
    return preview;
  };
  const element = source.type === 'cube' ? previewCube(source)
    : Object.assign(Object.create(source), { visible: true, locked: false, modifiers: [] });
  if (source.type !== 'cube' && typeof element.toCubes === 'function') {
    const cubes = element.toCubes().map(previewCube);
    element.toCubes = () => cubes;
  }
  return { element, hasCulledFaces };
}
