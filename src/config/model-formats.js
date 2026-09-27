import { ModelFormatRegistry } from '../core/model-format-registry.js';

export const ModelFormatId = Object.freeze({
  GENERIC: 'generic_model',
  IMAGE: 'image',
  JAVA_BLOCK_ITEM: 'java_block_item',
  BEDROCK_ENTITY: 'bedrock_entity',
  BEDROCK_BLOCK: 'bedrock_block',
  MODDED_ENTITY: 'modded_entity',
  MINECRAFT_SKIN: 'minecraft_skin',
  GECKOLIB: 'geckolib_animated_model'
});

const cubeCapabilities = Object.freeze({
  elements: ['cube', 'shape', 'group'],
  meshes: false,
  locators: false,
  animation: false,
  texturePainting: true,
  boxUv: true,
  faceUv: true
});

export const modelFormatRegistry = new ModelFormatRegistry();

const standardSnap = Object.freeze({ subdivisions: 16 });

modelFormatRegistry.registerMany([
  {
    id: ModelFormatId.GENERIC,
    name: '通用模型',
    description: '自由建模與多面體編輯',
    category: 'general',
    icon: 'generic',
    blockbenchFormat: 'free',
    aliases: ['generic', 'free_model'],
    status: 'placeholder',
    placeholderReason: '多面體編輯尚未實現',
    snap: standardSnap,
    defaults: { uvMode: 'face', textureSize: [16, 16], renderType: 'cutout', cullFaces: false },
    capabilities: { ...cubeCapabilities, elements: ['cube', 'mesh', 'shape', 'group', 'locator'], meshes: true, locators: true, animation: true }
  },
  {
    id: ModelFormatId.IMAGE,
    name: '圖像',
    description: '建立或編輯二維圖像',
    category: 'general',
    icon: 'image',
    blockbenchFormat: 'image',
    status: 'placeholder',
    placeholderReason: '圖像編輯尚未實現',
    snap: standardSnap,
    defaults: { uvMode: 'face', textureSize: [16, 16], renderType: 'cutout', cullFaces: false },
    capabilities: { elements: [], meshes: false, locators: false, animation: false, texturePainting: true, boxUv: false, faceUv: false }
  },
  {
    id: ModelFormatId.JAVA_BLOCK_ITEM,
    name: 'Java 版方塊/物品',
    description: 'Minecraft Java 方塊與物品模型',
    category: 'minecraft',
    icon: 'java-block',
    blockbenchFormat: 'java_block',
    aliases: ['java_block_item'],
    snap: standardSnap,
    defaults: { uvMode: 'face', textureSize: [16, 16], renderType: 'cutout', cullFaces: true },
    capabilities: { ...cubeCapabilities }
  },
  {
    id: ModelFormatId.BEDROCK_ENTITY,
    name: 'Bedrock 版實體',
    description: 'Minecraft Bedrock 實體幾何',
    category: 'minecraft',
    icon: 'bedrock-entity',
    blockbenchFormat: 'bedrock',
    aliases: ['bedrock_entity'],
    snap: standardSnap,
    defaults: { uvMode: 'box', textureSize: [64, 64], renderType: 'cutout', cullFaces: false },
    capabilities: { ...cubeCapabilities, elements: ['cube', 'shape', 'group', 'locator'], locators: true, animation: true }
  },
  {
    id: ModelFormatId.BEDROCK_BLOCK,
    name: 'Bedrock 版方塊',
    description: 'Minecraft Bedrock 方塊幾何',
    category: 'minecraft',
    icon: 'bedrock-block',
    blockbenchFormat: 'bedrock_block',
    snap: standardSnap,
    defaults: { uvMode: 'box', textureSize: [16, 16], renderType: 'cutout', cullFaces: true },
    capabilities: { ...cubeCapabilities }
  },
  {
    id: ModelFormatId.MODDED_ENTITY,
    name: '模組版實體',
    description: 'Minecraft Java 模組實體模型',
    category: 'minecraft',
    icon: 'modded-entity',
    blockbenchFormat: 'modded_entity',
    aliases: ['java_entity'],
    snap: standardSnap,
    defaults: { uvMode: 'box', textureSize: [64, 32], renderType: 'cutout', cullFaces: false },
    capabilities: { ...cubeCapabilities, elements: ['cube', 'shape', 'group', 'locator'], locators: true, animation: true }
  },
  {
    id: ModelFormatId.MINECRAFT_SKIN,
    name: 'Minecraft 皮膚',
    description: 'Minecraft 玩家皮膚模型',
    category: 'minecraft',
    icon: 'skin',
    blockbenchFormat: 'skin',
    aliases: ['minecraft_skin'],
    snap: standardSnap,
    defaults: { uvMode: 'box', textureSize: [64, 64], renderType: 'cutout', cullFaces: false },
    capabilities: { ...cubeCapabilities }
  },
  {
    id: ModelFormatId.GECKOLIB,
    name: 'GeckoLib Animated Model',
    description: 'GeckoLib 動畫實體模型',
    category: 'minecraft',
    icon: 'geckolib',
    blockbenchFormat: 'geckolib_model',
    aliases: ['geckolib', 'geckolib_animated_model'],
    snap: standardSnap,
    defaults: { uvMode: 'box', textureSize: [64, 64], renderType: 'cutout', cullFaces: false },
    capabilities: { ...cubeCapabilities, elements: ['cube', 'shape', 'group', 'locator'], locators: true, animation: true }
  }
]);

export function resolveModelFormatId(value) {
  return modelFormatRegistry.resolve(value, ModelFormatId.GENERIC)?.id || ModelFormatId.GENERIC;
}

export function createModelProjectData(formatId, context = {}) {
  return modelFormatRegistry.createDefaults(formatId, context);
}
