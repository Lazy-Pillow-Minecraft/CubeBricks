import assert from 'node:assert/strict';
import { CubeBricksProject } from '../src/model.js';
import { ModelFormatId, modelFormatRegistry } from '../src/common/config/model-formats.js';
import { availableUvModes, newProjectDefaults, prepareNewProjectData } from '../src/project/new-project-options.js';

const java = modelFormatRegistry.get(ModelFormatId.JAVA_BLOCK_ITEM);
const bedrock = modelFormatRegistry.get(ModelFormatId.BEDROCK_ENTITY);
assert.deepEqual(availableUvModes(java).map(mode => mode.value), ['face']);
assert.deepEqual(availableUvModes(bedrock).map(mode => mode.value), ['box', 'face']);
assert.equal(newProjectDefaults(java, 'zh-Hans').snap, 16);

const configured = prepareNewProjectData(java, 'zh-Hans', {
  name: '  Test Block  ', textureWidth: 32, textureHeight: 64, snap: 8,
  uvMode: 'face', javaBlockVersion: '1.21.6-1.21.10',
  historyLimit: 25, description: 'A test project'
});
const project = new CubeBricksProject(configured);
assert.equal(project.name, 'Test Block');
assert.deepEqual(project.textureSize, [32, 64]);
assert.equal(project.snap.subdivisions, 8);
assert.equal(project.uvMode, 'face');
assert.equal(project.formatData.javaBlockVersion, '1.21.6-1.21.10');
assert.equal(project.historyLimit, 25);
assert.equal(project.formatData.projectDescription, 'A test project');
assert.throws(() => prepareNewProjectData(java, 'zh-Hans', {
  name: 'bad', textureWidth: 16, textureHeight: 16, snap: 16, uvMode: 'box'
}), /UV/);

const bedrockProject = new CubeBricksProject(prepareNewProjectData(bedrock, 'zh-Hans', {
  name: 'Entity', textureWidth: 128, textureHeight: 64, snap: 32, uvMode: 'face'
}));
assert.equal(bedrockProject.uvMode, 'face');
assert.equal(bedrockProject.snap.subdivisions, 32);
console.log('New project options pass.');
