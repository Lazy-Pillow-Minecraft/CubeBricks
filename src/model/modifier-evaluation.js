// Resolve stack variants in world space for preview and baking.

import { modifierRegistry } from '../common/config/modifiers.js';
import { formatRules } from '../common/core/format-constraints.js';
import { invokeFormatHook } from '../common/core/format-hooks.js';
import { constrainElementCube } from '../common/core/procedural-format.js';
import { CubeOverlapIndex } from './cube-overlap-index.js';
import { cloneData } from './value-normalization.js';
import {
  affineAround, affineCompose, affineIdentity, affineInverse, affineIsIdentity,
  affineKey, affinePoint, applyGroupChainPoint, groupChainMatrix, inverseGroupChainPoint,
  matrixDeterminant, matrixEuler, matrixIdentity, matrixMultiply, matrixTranspose,
  matrixVector, rotationMatrix
} from './transform-math.js';

function symmetryExportAngles(modifier) {
  const count = Math.max(1, Math.min(256, Math.round(Number(modifier.copies) || 1)));
  if (modifier.distribution !== 'range') return Array.from({ length: count }, (_, index) => index * 360 / count);
  const start = Number(modifier.rangeStart) || 0, end = Number(modifier.rangeEnd) || 0;
  if (count === 1) return [start];
  return Array.from({ length: count }, (_, index) => start + (end - start) * index / (count - 1));
}

function rotationYMatrix(degrees) { return rotationMatrix([0, degrees, 0]); }

export function symmetryInstanceDefinitions(owner, modifier, frameMatrix) {
  const inverseFrame = matrixTranspose(frameMatrix);
  const worldMatrix = local => matrixMultiply(matrixMultiply(frameMatrix, local), inverseFrame);
  if (modifier.mode === 'axes') {
    const axes = ['x', 'y', 'z'].filter(axis => modifier.axes?.[axis]);
    if (!axes.length) return [{ matrix: matrixIdentity(), name: owner.name }];
    const definitions = [];
    const visit = (index, signs) => {
      if (index < axes.length) {
        visit(index + 1, { ...signs, [axes[index]]: 1 });
        visit(index + 1, { ...signs, [axes[index]]: -1 });
        return;
      }
      const diagonal = [signs.x || 1, signs.y || 1, signs.z || 1];
      const labels = [];
      if (modifier.axes.x) labels.push(diagonal[0] < 0 ? 'left' : 'right');
      if (modifier.axes.y) labels.push(diagonal[1] < 0 ? 'down' : 'up');
      if (modifier.axes.z) labels.push(diagonal[2] < 0 ? 'before' : 'front');
      definitions.push({ matrix: worldMatrix([[diagonal[0], 0, 0], [0, diagonal[1], 0], [0, 0, diagonal[2]]]), name: `${labels.join('_')}_${owner.name}` });
    };
    visit(0, {});
    return definitions;
  }
  const angles = symmetryExportAngles(modifier);
  if (modifier.mode === 'radial') return angles.map((angle, index) => ({
    matrix: worldMatrix(rotationYMatrix(angle)), name: `${owner.name}_${index + 1}`
  }));
  const reflection = [[1, 0, 0], [0, 1, 0], [0, 0, -1]];
  const definitions = [];
  angles.forEach((angle, index) => {
    const turn = rotationYMatrix(angle);
    definitions.push({ matrix: worldMatrix(turn), name: `${owner.name}_${index * 2 + 1}` });
    definitions.push({ matrix: worldMatrix(matrixMultiply(turn, reflection)), name: `${owner.name}_${index * 2 + 2}` });
  });
  return definitions;
}

export function modifierOwnerTransform(owner) {
  return {
    // Stack evaluation may use a plain owner snapshot without prototype
    // methods. Its explicit pivot still defines the same frame as preview.
    pivot: owner.pivot || owner.origin || owner.position || [0, 0, 0],
    rotation: owner.rotation || [0, 0, 0]
  };
}

export function symmetryWorldFrame(project, owner, modifier) {
  const chain = [...project.getGroupChain(owner.uid), modifierOwnerTransform(owner)];
  return {
    center: applyGroupChainPoint(modifier.anchor?.position || modifierOwnerTransform(owner).pivot, chain),
    matrix: matrixMultiply(groupChainMatrix(chain), rotationMatrix(modifier.anchor?.rotation || [0, 0, 0]))
  };
}

export function copyNodeAffine(project, owner, node) {
  const pivot = modifierOwnerTransform(owner).pivot;
  const base = symmetryWorldFrame(project, owner, { anchor: { position: pivot, rotation: [0, 0, 0] } });
  const parentChain = project.getGroupChain(owner.uid);
  const target = {
    center: applyGroupChainPoint(node.position, parentChain),
    matrix: matrixMultiply(groupChainMatrix(parentChain), rotationMatrix(node.rotation || [0, 0, 0]))
  };
  const matrix = matrixMultiply(target.matrix, matrixTranspose(base.matrix));
  const transformedPivot = matrixVector(matrix, base.center);
  return { matrix, translation: target.center.map((value, axis) => value - transformedPivot[axis]) };
}

export function rebaseCopyNode(project, oldOwner, newOwner, node, parentChain, bakedAfter = null) {
  const original = copyNodeAffine(project, oldOwner, node);
  // Baking a later modifier moves it into the physical Cube. A preceding
  // modifier must be conjugated through that baked transform so its effect
  // still occurs before the baked one in world space.
  const operation = bakedAfter
    ? affineCompose(bakedAfter, affineCompose(original, affineInverse(bakedAfter)))
    : original;
  const ownerChain = [...parentChain, modifierOwnerTransform(newOwner)];
  const base = {
    center: applyGroupChainPoint(newOwner.pivot, ownerChain),
    matrix: groupChainMatrix(ownerChain)
  };
  const position = inverseGroupChainPoint(affinePoint(operation, base.center), parentChain);
  const rotation = matrixEuler(matrixMultiply(matrixTranspose(groupChainMatrix(parentChain)),
    matrixMultiply(operation.matrix, base.matrix)));
  return { ...cloneData(node), position, rotation };
}

export function sourceCubeEntries(project, element) {
  if (element.type === 'locator' || element.type === 'node') return [];
  const cubes = typeof element.toCubes === 'function' ? element.toCubes(project) : element.type === 'cube' ? [constrainElementCube(project, element)] : [];
  const chain = project.getGroupChain(element.uid);
  const chainFrames = [...chain].reverse().map(group => ({ pivot: group.pivot, matrix: rotationMatrix(group.rotation || [0, 0, 0]) }));
  const groupInflate = chain.reduce((sum, group) => sum + (Number(group.inflate) || 0), 0);
  const offset = element.type === 'cube' ? [0, 0, 0] : element.origin || [0, 0, 0];
  const ownerRotation = element.type === 'cube' ? [0, 0, 0] : element.rotation || [0, 0, 0];
  const ownerOrigin = element.type === 'cube' ? element.pivot : element.pivot || element.origin || [0, 0, 0];
  return cubes.map((cube, index) => ({
    cube, index, offset, ownerRotation, ownerOrigin, chain, chainFrames, groupInflate
  }));
}

export function sourceWorldVertices(source) {
  if (source.worldVertices) return source.worldVertices;
  const { cube, offset, ownerRotation, ownerOrigin, chain } = source;
  const inflate = (Number(cube.inflate) || 0) + (source.groupInflate
    ?? chain.reduce((sum, group) => sum + (Number(group.inflate) || 0), 0));
  const direction = cube.size.map(value => value < 0 ? -1 : 1);
  const from = cube.position.map((value, axis) => value + offset[axis] - direction[axis] * inflate);
  const to = cube.position.map((value, axis) => value + offset[axis] + cube.size[axis] + direction[axis] * inflate);
  const pivot = cube.pivot.map((value, axis) => value + offset[axis]);
  const cubeMatrix = rotationMatrix(cube.rotation || [0, 0, 0]);
  const ownerMatrix = rotationMatrix(ownerRotation);
  const groupFrames = source.chainFrames
    || [...chain].reverse().map(group => ({ pivot: group.pivot, matrix: rotationMatrix(group.rotation || [0, 0, 0]) }));
  let transform = affineCompose(affineAround(ownerMatrix, ownerOrigin), affineAround(cubeMatrix, pivot));
  for (const frame of groupFrames) transform = affineCompose(affineAround(frame.matrix, frame.pivot), transform);
  const points = [];
  for (const x of [from[0], to[0]]) for (const y of [from[1], to[1]]) for (const z of [from[2], to[2]]) {
    points.push(affinePoint(transform, [x, y, z]));
  }
  source.worldVertices = points;
  return points;
}

export function cubeVertexKey(source, affine = null) {
  const points = sourceWorldVertices(source);
  const keys = new Array(points.length);
  const matrix = affine?.matrix, translation = affine?.translation;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const x = matrix ? matrix[0][0] * point[0] + matrix[0][1] * point[1] + matrix[0][2] * point[2] + translation[0] : point[0];
    const y = matrix ? matrix[1][0] * point[0] + matrix[1][1] * point[1] + matrix[1][2] * point[2] + translation[1] : point[1];
    const z = matrix ? matrix[2][0] * point[0] + matrix[2][1] * point[1] + matrix[2][2] * point[2] + translation[2] : point[2];
    keys[index] = `${Math.round(x * 100000) / 100000},${Math.round(y * 100000) / 100000},${Math.round(z * 100000) / 100000}`;
  }
  // Coincident vertices do not make positive and negative Cubes equivalent.
  // Compare each local size sign; modifier reflections already compensate
  // their winding and must not change the source Cube's sign signature.
  return `${source.cube.size.map(value => Math.sign(value)).join(',')}:${keys.sort().join('|')}`;
}

export function originalCubeKeys(project, sourcesByUid = null, excludedUids = null) {
  const keys = new CubeOverlapIndex(sourceWorldVertices);
  for (const element of project.elements) {
    if (excludedUids?.has(element.uid)) continue;
    if (element.visible === false || project.getGroupChain(element.uid).some(group => group.visible === false)) continue;
    const sources = sourceCubeEntries(project, element);
    sourcesByUid?.set(element.uid, sources);
    for (const source of sources) keys.add(keys.key(source));
  }
  return keys;
}

export function variantIgnoresDuplicates(owners, variant) {
  return owners.some(owner => (owner.modifiers || []).some(modifier =>
    variant.modifierUids.includes(modifier.uid) && modifier.ignoreDuplicateCubes));
}

export function modifierEvaluationOwners(project, element, terminalOwner = null, includeTerminal = true) {
  const owners = [element, ...project.getGroupChain(element.uid).reverse()];
  if (!terminalOwner) return owners;
  const index = owners.findIndex(owner => owner.uid === terminalOwner.uid);
  if (index < 0) return [];
  return owners.slice(0, index + (includeTerminal ? 1 : 0));
}

export function evaluateModifierStack(project, owners, initialVariants = null, evaluation = new Map()) {
  let variants = initialVariants || [{ affine: affineIdentity(), modifierUids: [], names: [] }];
  const rules = formatRules(project);
  for (const owner of owners) {
    for (const original of owner.modifiers || []) {
      if (!original?.enabled) continue;
      if (modifierRegistry.get(original.type)?.supportsFormat(rules) === false) continue;
      const modifier = modifierRegistry.get(original.type)?.hasFormatHook ? cloneData(original) : original;
      invokeFormatHook('modifier', modifier.type, modifier, { phase: 'parameters', rules, owner, project, evaluation });
      if (modifier.type === 'element_copy') {
        const definitions = [{ affine: affineIdentity(), name: null, nodeUid: null },
        ...(modifier.nodes || []).map((node, index) => ({ affine: copyNodeAffine(project, owner, node), name: `copy_${index + 1}`, nodeUid: node.uid }))];
        variants = variants.flatMap(variant => definitions.map(definition => ({
          affine: affineCompose(definition.affine, variant.affine),
          modifierUids: definition.name ? [...variant.modifierUids, modifier.uid] : [...variant.modifierUids],
          names: definition.name ? [...variant.names, definition.name] : [...variant.names],
          copyNodeUid: definition.nodeUid || variant.copyNodeUid,
          copyOwnerUid: definition.nodeUid ? owner.uid : variant.copyOwnerUid,
          copyModifierUid: definition.nodeUid ? modifier.uid : variant.copyModifierUid
        })));
        continue;
      }
      if (modifier.type !== 'symmetry') continue;
      const frame = symmetryWorldFrame(project, owner, modifier);
      const definitions = symmetryInstanceDefinitions(owner, modifier, frame.matrix);
      variants = variants.flatMap(variant => definitions.map(definition => {
        const operation = affineAround(definition.matrix, frame.center);
        return {
          affine: affineCompose(operation, variant.affine),
          modifierUids: [...variant.modifierUids, modifier.uid],
          names: [...variant.names, definition.name],
          copyNodeUid: variant.copyNodeUid, copyOwnerUid: variant.copyOwnerUid,
          copyModifierUid: variant.copyModifierUid
        };
      }));
    }
  }
  return variants;
}

// Describe render-only symmetry instances without duplicating any Cube or mesh.
// The renderer reuses the source element ranges already uploaded to the GPU and
// applies these world-space matrices at draw time.
export function buildModifierRenderInstances(project) {
  if (![...project.elements, ...project.groups].some(owner =>
    owner.modifiers?.some(modifier => modifier?.enabled && ['symmetry', 'element_copy'].includes(modifier.type)))) return [];
  const byTransform = new Map();
  const sourceUidsByInstance = new WeakMap();
  const sourcesByUid = new Map();
  const variantsByOwners = new Map();
  const deduplicate = [...project.elements, ...project.groups].some(owner =>
    owner.modifiers?.some(modifier => modifier?.enabled && modifier.type === 'symmetry' && modifier.ignoreDuplicateCubes));
  const occupied = deduplicate ? originalCubeKeys(project, sourcesByUid) : null;
  for (const element of project.elements) {
    const owners = modifierEvaluationOwners(project, element);
    if (element.visible === false || owners.some(owner => owner.visible === false)) continue;
    const activeOwners = owners.filter(owner => owner.modifiers?.some(modifier => modifier?.enabled));
    const ownersKey = JSON.stringify(activeOwners.map(owner => owner.uid));
    let variants = variantsByOwners.get(ownersKey);
    if (!variants) {
      variants = evaluateModifierStack(project, activeOwners);
      variantsByOwners.set(ownersKey, variants);
    }
    for (const variant of variants) {
      if (affineIsIdentity(variant.affine)) continue;
      const key = affineKey(variant.affine);
      let instance = byTransform.get(key);
      if (!instance) {
        instance = {
          key,
          groupUid: owners.at(-1)?.uid || element.uid,
          modifierUid: variant.modifierUids.join(':'),
          modifierUids: [...variant.modifierUids],
          copyNodeUid: variant.copyNodeUid, copyOwnerUid: variant.copyOwnerUid,
          copyModifierUid: variant.copyModifierUid,
          sourceUids: [],
          cubeIndices: {},
          matrix: variant.affine.matrix.map(row => [...row]),
          translation: [...variant.affine.translation],
          reflected: matrixDeterminant(variant.affine.matrix) < 0
        };
        byTransform.set(key, instance);
        sourceUidsByInstance.set(instance, new Set());
      }
      let sources = sourcesByUid.get(element.uid);
      if (!sources) {
        sources = sourceCubeEntries(project, element);
        sourcesByUid.set(element.uid, sources);
      }
      const ignoreDuplicates = variantIgnoresDuplicates(owners, variant);
      const include = sources.filter(source => {
        if (!occupied) return true;
        const vertexKey = occupied.key(source, variant.affine);
        if (ignoreDuplicates && occupied.has(vertexKey)) return false;
        occupied.add(vertexKey);
        return true;
      }).map(source => source.index);
      if (!sources.length || include.length) {
        const sourceUidSet = sourceUidsByInstance.get(instance);
        if (!sourceUidSet.has(element.uid)) {
          sourceUidSet.add(element.uid);
          instance.sourceUids.push(element.uid);
        }
        if (sources.length && occupied) instance.cubeIndices[element.uid] = [...new Set([
          ...(instance.cubeIndices[element.uid] || []), ...include
        ])];
      }
    }
  }
  return [...byTransform.values()];
}
