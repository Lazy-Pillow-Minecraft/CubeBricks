import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { operationIndex, requireOperation } from '../src/common/core/operation-registry.js';
import { modifierRegistry } from '../src/common/config/modifiers.js';
import { operatorRegistry } from '../src/common/config/operators.js';

test('every direct snapshot has an operation ID and every literal ID is indexed', async () => {
  const source = (await Promise.all([
    '../src/app.js',
    '../src/project/journal-controller.js',
    '../src/screen/inspector-controller.js',
    '../src/screen/gizmo-controller.js',
    '../src/screen/uv-preview-controller.js',
    '../src/screen/palette/controller.js',
    '../src/screen/color-picker/controller.js'
  ]
    .map(path => readFile(new URL(path, import.meta.url), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /\bsnapshot\(\s*\)/, 'A snapshot call has no operation ID');
  const literalIds = [...source.matchAll(/\bsnapshot\('([^']+)'\)/g)].map(match => match[1]);
  for (const id of literalIds) assert.equal(requireOperation(id), id);
  const notedIds = [...source.matchAll(/\bnoteJournalOperation\('([^']+)'\)/g)].map(match => match[1]);
  for (const id of notedIds) assert.equal(requireOperation(id), id);
  assert.ok(literalIds.length > 30);
});

test('modifier and operator operation IDs are generated from registered types', () => {
  for (const registry of [modifierRegistry, operatorRegistry]) {
    const namespace = registry === modifierRegistry ? 'modifier' : 'operator';
    for (const definition of registry.definitions.values()) {
      for (const verb of ['add', 'remove', 'toggle', 'change', 'move', 'bake', 'transform']) {
        assert.equal(requireOperation(`${namespace}.${definition.id}.${verb}`), `${namespace}.${definition.id}.${verb}`);
      }
    }
  }
  const ids = operationIndex().map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('inspector fields, vectors and shape parameters have individual indexed IDs', () => {
  for (const key of ['name', 'unnamed', 'visible', 'shade', 'autoUv', 'uvMode', 'uvNormalized',
    'exported', 'locked', 'inflate', 'handlesEnabled', 'symmetricHandles', 'preserveSubdivisionEdits']) {
    const id = `core.element.field.${key.toLowerCase()}`;
    assert.equal(requireOperation(id), id);
  }
  for (const key of ['position', 'origin', 'pivot', 'rotation', 'size', 'handleIn', 'handleOut']) {
    const id = `core.element.vector.${key.toLowerCase()}`;
    assert.equal(requireOperation(id), id);
  }
  for (const key of ['radius', 'height', 'sides', 'innerRadius', 'thickness', 'angleStep', 'segmentLength']) {
    const id = `core.shape.parameter.${key.toLowerCase()}`;
    assert.equal(requireOperation(id), id);
  }
});
