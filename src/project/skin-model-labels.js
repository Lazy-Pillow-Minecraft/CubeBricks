// A renderer can attach one geometry to many entities. Name a library card
// from its geometry and part, never from the first entity that happens to use it.
const EXACT = {
  bee_stinger: ['蜂刺', '蜂刺', 'Bee Stinger'],
  spin_attack: ['旋转攻击效果', '旋轉攻擊效果', 'Spin Attack Effect'],
  item_sprite: ['物品平面', '物品平面', 'Item Sprite'],
  'boat.oak': ['船体', '船體', 'Boat Body'],
  'chest_boat.oak': ['箱船船体', '箱船船體', 'Chest Boat Body'],
  'chest_boat.bamboo': ['载箱竹筏', '載箱竹筏', 'Bamboo Raft with Chest'],
  'boat.bamboo': ['竹筏', '竹筏', 'Bamboo Raft'],
  cat_baby: ['猫／豹猫幼体共用模型', '貓／豹貓幼體共用模型', 'Baby Cat/Ocelot Shared Model'],
  'cat.baby': ['猫／豹猫幼体共用模型', '貓／豹貓幼體共用模型', 'Baby Cat/Ocelot Shared Model'],
  cow: ['牛类共用模型', '牛類共用模型', 'Cow Shared Model'],
  cow_baby: ['牛类幼体共用模型', '牛類幼體共用模型', 'Baby Cow Shared Model'],
  'cow.baby': ['牛类幼体共用模型', '牛類幼體共用模型', 'Baby Cow Shared Model'],
  'conduit.shell': ['潮涌核心外壳', '潮湧核心外殼', 'Conduit Shell'],
  player_head: ['玩家头颅', '玩家頭顱', 'Player Head'],
  dragon_head: ['末影龙头颅', '終界龍頭顱', 'Ender Dragon Head'],
  mob_head: ['生物头颅', '生物頭顱', 'Mob Head'],
  elytra: ['鞘翅', '鞘翅', 'Elytra'],
  elytra_baby: ['幼体鞘翅', '幼體鞘翅', 'Baby Elytra'],
  'horse.v3': ['马科共用模型', '馬科共用模型', 'Equine Shared Model'],
  'horse.baby': ['马科幼体共用模型', '馬科幼體共用模型', 'Baby Equine Shared Model'],
  horse_baby: ['马科幼体共用模型', '馬科幼體共用模型', 'Baby Equine Shared Model'],
  mule_baby: ['幼体驴／骡共用模型', '幼體驢／騾共用模型', 'Baby Donkey/Mule Shared Model'],
  'donkeymule.baby': ['幼体驴／骡共用模型', '幼體驢／騾共用模型', 'Baby Donkey/Mule Shared Model'],
  zombie_baby: ['幼体僵尸类共用模型', '幼體殭屍類共用模型', 'Baby Zombie Shared Model'],
  'zombie.baby': ['幼体僵尸类共用模型', '幼體殭屍類共用模型', 'Baby Zombie Shared Model'],
  'zombie.v1.8': ['僵尸类共用模型', '殭屍類共用模型', 'Zombie Shared Model'],
  zombie_horse: ['亡灵马共用模型', '亡靈馬共用模型', 'Undead Horse Shared Model'],
  'zombie_horse.saddle': ['亡灵马鞍', '亡靈馬鞍', 'Undead Horse Saddle'],
  stray: ['骷髅／流浪者共用模型', '骷髏／流浪者共用模型', 'Skeleton/Stray Shared Model'],
  hoglin: ['疣猪兽类共用模型', '豬布獸類共用模型', 'Hoglin Shared Model'],
  hoglin_baby: ['疣猪兽类幼体共用模型', '豬布獸類幼體共用模型', 'Baby Hoglin Shared Model'],
  'hoglin.baby': ['疣猪兽类幼体共用模型', '豬布獸類幼體共用模型', 'Baby Hoglin Shared Model'],
  piglin: ['猪灵类共用模型', '豬布林類共用模型', 'Piglin Shared Model'],
  'nautilus': ['鹦鹉螺类共用模型', '鸚鵡螺類共用模型', 'Nautilus Shared Model'],
  villager: ['村民／流浪商人共用模型', '村民／流浪商人共用模型', 'Villager/Wandering Trader Shared Model'],
  villager_v2: ['村民／流浪商人共用模型', '村民／流浪商人共用模型', 'Villager/Wandering Trader Shared Model'],
  minecart: ['矿车共用模型', '礦車共用模型', 'Minecart Shared Model'],
  'minecart.v1.8': ['矿车共用模型', '礦車共用模型', 'Minecart Shared Model'],
  fireball: ['火球共用模型', '火球共用模型', 'Fireball Shared Model'],
  'squid': ['鱿鱼共用模型', '魷魚共用模型', 'Squid Shared Model'],
  'squid_baby': ['幼体鱿鱼共用模型', '幼體魷魚共用模型', 'Baby Squid Shared Model'],
  'squid.baby': ['幼体鱿鱼共用模型', '幼體魷魚共用模型', 'Baby Squid Shared Model'],
  'guardian.v1.8': ['守卫者共用模型', '守衛者共用模型', 'Guardian Shared Model'],
  'spider.v1.8': ['蜘蛛共用模型', '蜘蛛共用模型', 'Spider Shared Model'],
  'evoker': ['灾厄村民共用模型', '窳民共用模型', 'Illager Shared Model'],
  tropicalfish_a: ['热带鱼 A 型', '熱帶魚 A 型', 'Tropical Fish Type A'],
  tropicalfish_b: ['热带鱼 B 型', '熱帶魚 B 型', 'Tropical Fish Type B'],
  'sheep.sheared.v1.8': ['已剪毛绵羊', '已剪毛綿羊', 'Sheared Sheep'],
  'skeleton.bogged': ['沼骸', '沼骸', 'Bogged'],
  'skeleton.stray.v1.8': ['流浪者', '流浪者', 'Stray'],
  'skeleton.wither.v1.8': ['凋灵骷髅', '凋靈骷髏', 'Wither Skeleton'],
  'slime.layers': ['史莱姆外层', '史萊姆外層', 'Slime Outer Layer'],
  'villager.witch.v1.8': ['女巫', '女巫', 'Witch'],
  zombie_nautilus_coral: ['僵尸鹦鹉螺珊瑚层', '殭屍鸚鵡螺珊瑚層', 'Zombie Nautilus Coral Layer'],
  'player_slim': ['玩家（纤细）', '玩家（纖細）', 'Player (Slim)'],
  'skin_pack.humanoid.custom': ['玩家皮肤模型', '玩家皮膚模型', 'Player Skin Model'],
  'skin_pack.humanoid.customslim': ['玩家皮肤模型（纤细）', '玩家皮膚模型（纖細）', 'Player Skin Model (Slim)']
};

const PARTS = {
  armor: ['护甲', '護甲', 'Armor'],
  saddle: ['鞍', '鞍', 'Saddle'],
  collar: ['项圈', '項圈', 'Collar'],
  decor: ['装饰', '裝飾', 'Decor'],
  wool: ['羊毛', '羊毛', 'Wool'],
  inner: ['内层', '內層', 'Inner Layer'],
  flower: ['花朵', '花朵', 'Flower'],
  ropes: ['缰绳', '韁繩', 'Ropes'],
  harness: ['挽具', '挽具', 'Harness'],
  charged: ['充能层', '充能層', 'Charged Layer'],
  eyes: ['眼睛层', '眼睛層', 'Eyes Layer'],
  pattern: ['花纹层', '花紋層', 'Pattern Layer']
};
const VARIANTS = {
  baby: ['幼体', '幼體', 'Baby'],
  warm: ['暖域', '暖域', 'Warm'],
  cold: ['寒域', '寒域', 'Cold'],
  small: ['小型', '小型', 'Small'],
  large: ['大型', '大型', 'Large']
};

function parseModelStem(stem) {
  const segments = stem.replace(/[._]v\d+(?:[._]\d+)*$/i, '').split(/[._]/);
  const parts = [], variants = [];
  while (segments.length > 1 && PARTS[segments.at(-1)]) parts.unshift(segments.pop());
  while (segments.length > 1 && VARIANTS[segments.at(-1)]) variants.unshift(segments.pop());
  while (segments.length > 1 && VARIANTS[segments[0]]) variants.unshift(segments.shift());
  const base = segments.join('_');
  return { base: { villagerzombie: 'zombie_villager', zombie_drowned: 'drowned' }[base] || base,
    parts, variants };
}

export function skinModelNames(modelStem, entityNames) {
  const exact = EXACT[modelStem];
  if (exact) return { zhHans: exact[0], zhHant: exact[1], en: exact[2] };
  const { base, parts, variants } = parseModelStem(modelStem);
  const subject = entityNames(`minecraft:${base}`);
  const result = {};
  for (const [language, index] of [['zhHans', 0], ['zhHant', 1], ['en', 2]]) {
    const prefix = variants.map(variant => VARIANTS[variant][index]).join(language === 'en' ? ' ' : '');
    const body = subject[language];
    const suffix = parts.map(part => PARTS[part][index]).join(language === 'en' ? ' ' : '');
    result[language] = language === 'en'
      ? [prefix, body, suffix].filter(Boolean).join(' ')
      : `${prefix}${body}${suffix}`;
  }
  return result;
}
