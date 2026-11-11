// Copy the verified, deduplicated entity templates into the application bundle.
// The extraction itself stays in build/; only editor-ready files are shipped.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isSharedHumanoidArmor } from '../src/project/skin-catalog.js';
import { skinTextureBindings } from '../src/project/skin-texture-bindings.js';
import { skinModelNames } from '../src/project/skin-model-labels.js';

const root = path.resolve('build/minecraft-entity-models');
const output = path.resolve('src/assets/skin-library');
const previousCatalog = fs.existsSync(path.join(output, 'catalog.json'))
  ? JSON.parse(fs.readFileSync(path.join(output, 'catalog.json'))) : { entries: [] };
const previousEntries = new Map(previousCatalog.entries.map(entry => [entry.id, entry]));
const source = JSON.parse(fs.readFileSync(path.join(root, 'index.json')));
const previews = JSON.parse(fs.readFileSync(path.join(root, 'preview-index.json')));
const editions = { java: 'java-26.3', bedrock: 'bedrock-1.26.63.1' };
const indexFile = 'D:/MCLDownload/Game/.minecraft/assets/indexes/1.18.json';
const objectRoot = 'D:/MCLDownload/Game/.minecraft/assets/objects';
const bedrockLang = 'C:/XboxGames/Minecraft for Windows/Content/data/resource_packs/vanilla/texts';

function javaLanguage(language) {
  try {
    const assets = JSON.parse(fs.readFileSync(indexFile));
    const hash = assets.objects[`minecraft/lang/${language}.json`].hash;
    return JSON.parse(fs.readFileSync(path.join(objectRoot, hash.slice(0, 2), hash)));
  } catch { return {}; }
}

function bedrockLanguage(language) {
  try {
    return Object.fromEntries(fs.readFileSync(path.join(bedrockLang, `${language}.lang`), 'utf8')
      .split(/\r?\n/).map(line => line.split(/\t?#/, 1)[0])
      .filter(line => line.includes('=')).map(line => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1).replace(/\\n/g, ' ').trim()];
      }));
  } catch { return {}; }
}

const zhHansJava = javaLanguage('zh_cn'), zhHantJava = javaLanguage('zh_tw');
const zhHansBedrock = bedrockLanguage('zh_CN'), zhHantBedrock = bedrockLanguage('zh_TW');
let enJava = {};
try {
  enJava = JSON.parse(execFileSync('tar', ['-xOf', path.join(root, 'java-source/26.3.jar'),
    'assets/minecraft/lang/en_us.json'], { maxBuffer: 8 * 1024 * 1024 }).toString());
} catch { /* The readable identifier is a safe fallback on other machines. */ }

const humanize = value => value.replace(/^minecraft:/, '').replace(/[_./#-]+/g, ' ')
  .replace(/\b\w/g, letter => letter.toUpperCase());
const localizedFallback = {
  bell: ['钟', '鐘'], acacia_boat: ['金合欢木船', '相思木船'], bamboo_raft: ['竹筏', '竹筏'],
  book: ['书', '書'], chest: ['箱子', '儲物箱'], conduit: ['潮涌核心', '潮湧核心'],
  creeper_head: ['苦力怕的头', '苦力怕頭顱'], decorated_pot_base: ['饰纹陶罐', '飾紋陶罐'],
  double_chest_left: ['大型箱子（左）', '大型儲物箱（左）'],
  double_chest_right: ['大型箱子（右）', '大型儲物箱（右）'],
  dragon_skull: ['末影龙的头', '終界龍頭顱'], piglin_head: ['猪灵的头', '豬布林頭顱'],
  shield: ['盾牌', '盾牌'], shulker_box: ['潜影盒', '界伏盒'],
  standing_banner: ['旗帜', '旗幟'], wall_banner: ['墙上旗帜', '牆上旗幟'],
  agent: ['智能体', '代理人'], bed: ['床', '床'], skull: ['头颅', '頭顱'],
  harness: ['挽具', '挽具'], humanoid: ['人形模型', '人形模型'], spyglass: ['望远镜', '望遠鏡'],
  sulfur_cube: ['硫方怪', '硫方怪'], chest_boat: ['箱船', '箱船'],
  villagerzombie: ['僵尸村民', '殭屍村民'], zombie_villager: ['僵尸村民', '殭屍村民'],
  zombie_drowned: ['溺尸', '沉屍'], tropicalfish_a: ['热带鱼 A 型', '熱帶魚 A 型'],
  tropicalfish_b: ['热带鱼 B 型', '熱帶魚 B 型'], camel_husk: ['尸壳骆驼', '屍殼駱駝'],
  happy_ghast: ['善念恶魂', '快樂幽靈'], undead_horse: ['亡灵马', '亡靈馬'],
  dragon: ['末影龙', '終界龍'], irongolem: ['铁傀儡', '鐵傀儡'],
  llamaspit: ['羊驼唾沫', '羊駝唾沫'], polarbear: ['北极熊', '北極熊'],
  snowgolem: ['雪傀儡', '雪人'], wind_charge: ['风弹', '風彈'],
  witherboss: ['凋灵', '凋靈']
};
function entityNames(id) {
  const name = id.replace(/^minecraft:/, '');
  const keys = [`entity.minecraft.${name}`, `entity.${name}.name`, `entity.${name}`];
  const get = (...dictionaries) => keys.map(key => dictionaries.find(dict => dict[key])?.[key]).find(Boolean);
  return {
    zhHans: get(zhHansJava, zhHansBedrock) || localizedFallback[name]?.[0] || humanize(name),
    zhHant: get(zhHantJava, zhHantBedrock) || localizedFallback[name]?.[1] || humanize(name),
    en: get(enJava) || humanize(name)
  };
}

const entries = [];
for (const [edition, folder] of Object.entries(editions)) {
  const details = JSON.parse(fs.readFileSync(path.join(root, folder, 'index.json')));
  const version = source.editions[edition].version;
  for (const [model, modelInfo] of Object.entries(details.models)) {
    const sourceModel = JSON.parse(fs.readFileSync(path.join(root, folder, model)));
    const expectedRatio = sourceModel.resolution.width / sourceModel.resolution.height;
    const bindings = skinTextureBindings(edition, model, details);
    const aliases = [...new Set(bindings.map(binding => binding.entityId))];
    const bindingByTexture = new Map(bindings.map(binding => [binding.id, binding]));
    const textureIds = new Set([modelInfo.defaultTexture, ...bindings.map(binding => binding.id)].filter(Boolean));
    for (const skin of Object.values(details.playerSkins || {})) if (skin.model === model)
      textureIds.add(skin.texture || skin.defaultTexture);
    const modelStem = path.basename(model, '.bbmodel');
    const names = skinModelNames(modelStem, entityNames);
    const variant = modelStem;
    const textures = [...textureIds].filter(Boolean).map(id => {
      const info = details.textures[id];
      if (!info?.file || info.size && Math.abs(info.size[0] / info.size[1] - expectedRatio) > 1e-6
        && id !== modelInfo.defaultTexture) return null;
      return { id, name: humanize(path.basename(id, '.png')), file: `${folder}/${info.file}`,
        size: info.size || null, ...(bindingByTexture.get(id)?.entityId
          ? { entityId: bindingByTexture.get(id).entityId } : {}) };
    }).filter(Boolean);
    const cover = previews.editions[edition].models[model]?.file || null;
    const id = `${edition}:${model}`;
    const previous = previousEntries.get(id);
    const record = { id, edition, version, model: `${folder}/${model}`,
      cover, entityIds: aliases, names, variant,
      textures: textures.map(texture => ({ ...texture,
        ...(previous?.textures.find(old => old.id === texture.id)?.preview
          ? { preview: previous.textures.find(old => old.id === texture.id).preview } : {}) })),
      ...(previous?.templatePreview ? { templatePreview: previous.templatePreview } : {}),
      defaultTextureId: modelInfo.defaultTexture || textures[0]?.id || null };
    if (edition === 'java' && aliases.length > 1) {
      const layers = new Map();
      for (const [entityId, entity] of Object.entries(details.entities || {})) {
        for (const [key, part] of Object.entries(entity.layers || {})) {
          if (part?.model !== model || key.endsWith('#main') || !part.group) continue;
          const owners = layers.get(part.group) || new Set();
          owners.add(entityId);
          layers.set(part.group, owners);
        }
      }
      if (layers.size) record.conditionalLayers = [...layers].map(([groupId, entityIds]) =>
        ({ groupId, entityIds: [...entityIds] }));
    }
    if (!isSharedHumanoidArmor(record)) entries.push(record);
  }
}

fs.mkdirSync(output, { recursive: true });
for (const folder of Object.values(editions)) {
  for (const category of ['models', 'previews', 'textures']) {
    const target = path.join(output, folder, category);
    fs.mkdirSync(target, { recursive: true });
    for (const file of fs.readdirSync(path.join(root, folder, category)))
      fs.copyFileSync(path.join(root, folder, category, file), path.join(target, file));
  }
}
fs.writeFileSync(path.join(output, 'catalog.json'), JSON.stringify({ version: 1, entries }, null, 2));
console.log(`Prepared ${entries.length} skin templates (${Object.keys(editions).join(', ')}).`);
