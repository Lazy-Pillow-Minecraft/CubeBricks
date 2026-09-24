import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ConfigRegistry, ConfigScope, ConfigType } from '../src/core/config-registry.js';
import { ConfigKey, configRegistry as appConfigRegistry, translateUiText } from '../src/config/app-config.js';

const memory = new Map();
const storage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value)
};

const registry = new ConfigRegistry({ storage, storageKey: 'test.config' });
registry.register({
  id: 'application.language',
  type: ConfigType.ENUM,
  scope: ConfigScope.APPLICATION,
  defaultValue: 'zh-Hant',
  options: [{ value: 'zh-Hant' }, { value: 'zh-Hans' }, { value: 'en' }]
});

let observed;
registry.subscribe('application.language', change => { observed = change; });
assert.equal(registry.get('application.language'), 'zh-Hant');
assert.equal(registry.set('application.language', 'en'), 'en');
assert.equal(observed.previousValue, 'zh-Hant');
assert.throws(() => registry.set('application.language', 'fr'), TypeError);

const restored = new ConfigRegistry({ storage, storageKey: 'test.config' });
restored.register(registry.getDefinition('application.language'));
assert.equal(restored.get('application.language'), 'en');
assert.deepEqual(restored.exportValues(), { 'application.language': 'en' });

assert.equal(appConfigRegistry.getDefinition(ConfigKey.SHIFT_SNAP_MODE).defaultValue, 'multiplier');
assert.equal(appConfigRegistry.getDefinition(ConfigKey.CTRL_SNAP_MODE).defaultValue, 'multiplier');
assert.equal(appConfigRegistry.getDefinition(ConfigKey.SHIFT_CTRL_SNAP_MODE).defaultValue, 'multiplier');
assert.equal(translateUiText('物件屬性', 'zh-Hans'), '对象属性');
assert.equal(translateUiText('歐拉角模式：按 Z → Y → X 層級直接調整歐拉角', 'zh-Hans'), '欧拉角模式：按 Z → Y → X 层级直接调整欧拉角');
assert.equal(translateUiText('目前沒有可聚焦的物件', 'zh-Hans'), '当前没有可聚焦的对象');
assert.equal(translateUiText('無法讀取這張圖片', 'zh-Hans'), '无法读取这张图片');
assert.equal(translateUiText('物件屬性', 'en'), 'Object properties');
assert.equal(translateUiText('3 行 · 每行獨立設定', 'en'), '3 rows · configured independently');
assert.equal(translateUiText('預覽：豎切', 'en'), 'Preview: vertical cut');
assert.equal(translateUiText('已豎切 head（X 軸）', 'en'), 'Vertically cut head on the X axis');

const uiSource = ['src/index.html', 'src/app.js', 'src/ui/dock-manager.js']
  .map(file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
  .join('\n');
const traditionalUiGlyphs = new Set([...'體開關閉陰顯圖層編輯繪畫動導檔儲復設覽縮態級軸長圍線僅鎖稱變換擇組場間輸項參數塊刪見幾樞脹狀徑邊質預選語網負許顏圓強調還應過這臺電腦獨當與後會啟連續離內實視點擊進階構則個處從標題樣細節類別載務優勢據墊疊寬釋權傳統築擁護隱響極遠習萬屬為時種並註冊觀對滾輪鍵頂單銷欄轉筆蓋暫輔側區紋帶巢匯總來歐貼範覺緒沒漸無讀張敗認義著請須於繞齊適豎橫']);
const simplifiedUiSource = translateUiText(uiSource, 'zh-Hans');
const leftovers = [...new Set([...simplifiedUiSource].filter(character => traditionalUiGlyphs.has(character)))];
assert.deepEqual(leftovers, [], `Simplified UI still contains Traditional Chinese glyphs: ${leftovers.join(' ')}`);

console.log('Config registry tests passed.');
