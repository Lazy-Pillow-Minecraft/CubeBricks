import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSkinProject } from '../src/project/skin-project.js';
import { ModelFormatId } from '../src/common/config/model-formats.js';
import { isSharedHumanoidArmor } from '../src/project/skin-catalog.js';

const catalog = JSON.parse(fs.readFileSync('src/assets/skin-library/catalog.json'));
assert.equal(catalog.entries.length, 330);
assert(!catalog.entries.some(isSharedHumanoidArmor), 'shared player armor models stay out of the skin picker');
const skin = (edition, variant) => {
  const record = catalog.entries.find(entry => entry.edition === edition && entry.variant === variant);
  assert(record, `${edition}/${variant} exists`);
  return record;
};
const textureNames = record => record.textures.map(texture => texture.id.split('/').at(-1));
assert.deepEqual(textureNames(skin('java', 'bee')).sort(),
  ['bee.png', 'bee_angry.png', 'bee_angry_nectar.png', 'bee_nectar.png'].sort());
assert.deepEqual(textureNames(skin('java', 'bee_baby')).sort(),
  ['bee_baby.png', 'bee_angry_baby.png', 'bee_angry_nectar_baby.png', 'bee_nectar_baby.png'].sort());
assert.equal(skin('java', 'axolotl_baby').textures.length, 5, 'baby axolotl keeps its five colors');
assert.equal(skin('bedrock', 'rabbit.v2').textures.length, 7, 'adult rabbit keeps seven colors');
assert.equal(skin('bedrock', 'rabbit.baby').textures.length, 7, 'baby rabbit keeps seven colors');
assert.deepEqual(textureNames(skin('bedrock', 'chicken.v1.12')).sort(),
  ['chicken', 'chicken_warm'].sort(), 'shared temperate/warm geometry keeps both textures');
assert.deepEqual(textureNames(skin('bedrock', 'chicken.cold')), ['chicken_cold']);
assert.deepEqual(textureNames(skin('bedrock', 'chicken.baby')).sort(),
  ['chicken_temperate_baby', 'chicken_warm_baby', 'chicken_cold_baby'].sort());
assert.deepEqual(textureNames(skin('bedrock', 'cow.warm')), ['cow_warm']);
assert.deepEqual(textureNames(skin('bedrock', 'copper_golem.flower')), ['copper_golem_flower']);
assert(!textureNames(skin('bedrock', 'horse.v3')).some(name => /baby|markings|armor/.test(name)),
  'adult horse geometry does not offer baby or equipment layers');
assert(!textureNames(skin('bedrock', 'villager_v2')).some(name => /baby|biome|profession|level/.test(name)),
  'villager body does not offer its overlay layers as body skins');
assert.deepEqual(textureNames(skin('java', 'llama')).sort(),
  ['llama_creamy.png', 'llama_brown.png', 'llama_gray.png', 'llama_white.png', 'trader_llama.png'].sort(),
  'llama body does not offer its decorative equipment colors');
assert.equal(skin('java', 'llama.decor').textures.length, 16,
  'llama decor keeps its own sixteen equipment colors');
assert(!textureNames(skin('java', 'horse_armor')).some(name => name.includes('overlay')),
  'horse armor overlay is not a standalone body texture');
assert.equal(skin('java', 'bee_stinger').names.zhHans, '蜂刺');
assert.equal(skin('java', 'elytra').names.zhHans, '鞘翅');
assert.equal(skin('java', 'horse_armor').names.zhHans, '马护甲');
assert.equal(skin('bedrock', 'horse.v3').names.zhHans, '马科共用模型');
assert.equal(skin('bedrock', 'item_sprite').names.zhHans, '物品平面');
const stray = skin('java', 'stray');
const strayModel = JSON.parse(fs.readFileSync(`src/assets/skin-library/${stray.model}`));
const straySkeleton = createSkinProject(stray, strayModel, { textureMode: 'game',
  gameTexture: { id: 'minecraft:textures/entity/skeleton/skeleton.png' } });
assert.equal(straySkeleton.project.groups.find(group => group.name === 'Outer layer')?.visible, false,
  'skeleton variant hides the stray-only outer layer');
const drownedBaby = skin('java', 'zombie_baby');
const drownedBabyModel = JSON.parse(fs.readFileSync(`src/assets/skin-library/${drownedBaby.model}`));
const drownedSkin = createSkinProject(drownedBaby, drownedBabyModel, { textureMode: 'game',
  gameTexture: { id: 'minecraft:textures/entity/zombie/drowned_baby.png' } });
assert.equal(drownedSkin.project.groups.find(group => group.name === 'Drowned outer layer')?.visible, true,
  'drowned baby variant shows its own outer layer');
let painted = 0;
const canvases = [];
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = {
      width: 0, height: 0,
      getContext() { return {
        fillRect() { painted++; }, strokeRect() {},
        set fillStyle(_value) {}, set strokeStyle(_value) {}, set lineWidth(_value) {}
      }; },
      toDataURL() { return 'data:image/png;base64,template'; }
    };
    canvases.push(canvas);
    return canvas;
  }
};
for (const edition of ['java', 'bedrock']) {
  const record = catalog.entries.find(entry => entry.edition === edition && entry.variant === 'allay');
  assert(record);
  const source = JSON.parse(fs.readFileSync(`src/assets/skin-library/${record.model}`));
  const originalUv = source.elements.map(element => ({ uv: element.uv_offset, faces: element.faces }));
  const { project, textureAssets } = createSkinProject(record, source, { textureMode: 'template' });
  assert.equal(project.formatId, ModelFormatId.MINECRAFT_SKIN);
  assert.equal(project.formatData.skinTemplate.edition, edition);
  assert.equal(textureAssets[0].source, 'data:image/png;base64,template');
  assert(painted > 0, 'template paints the existing UV regions');
  assert.deepEqual(source.elements.map(element => ({ uv: element.uv_offset, faces: element.faces })), originalUv,
    'template creation does not change source UV');
  const game = createSkinProject(record, source, { textureMode: 'game',
    gameTexture: { id: 'alternate', source: 'data:image/png;base64,game' } });
  assert.equal(game.textureAssets[0].source, 'data:image/png;base64,game');
  assert.equal(game.project.formatData.skinTemplate.gameTexture, 'alternate');
}
const ghast = catalog.entries.find(entry => entry.id === 'java:models/ghast.bbmodel');
const ghastSource = JSON.parse(fs.readFileSync(`src/assets/skin-library/${ghast.model}`));
const ghastTemplate = createSkinProject(ghast, ghastSource, { textureMode: 'template' });
assert.equal(canvases.at(-1).width, ghastSource.textures[0].width,
  'high-resolution templates retain the original raster dimensions');
assert.equal(ghastTemplate.textureAssets[0].uvWidth, ghastSource.textures[0].uv_width,
  'high-resolution templates keep the logical UV dimensions');
for (const record of catalog.entries) {
  assert(fs.existsSync(`src/assets/skin-library/${record.cover}`), `${record.id}: cover exists`);
  assert(fs.existsSync(`src/assets/skin-library/${record.templatePreview}`), `${record.id}: template preview exists`);
  for (const texture of record.textures) {
    assert(fs.existsSync(`src/assets/skin-library/${texture.file}`), `${record.id}: game texture exists`);
    assert(fs.existsSync(`src/assets/skin-library/${texture.preview}`), `${record.id}: game texture preview exists`);
  }
  const source = JSON.parse(fs.readFileSync(`src/assets/skin-library/${record.model}`));
  const before = painted;
  assert(createSkinProject(record, source, { textureMode: 'template' }).textureAssets.length > 0,
    `${record.id}: creates a paintable texture`);
  assert(painted > before, `${record.id}: has UV faces for its template`);
}
console.log('Skin project templates preserve Java and Bedrock UVs.');
