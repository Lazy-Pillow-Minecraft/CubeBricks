import { ConfigRegistry, ConfigScope, ConfigType } from '../core/config-registry.js';

export const AppLanguage = Object.freeze({
  TRADITIONAL_CHINESE: 'zh-Hant',
  SIMPLIFIED_CHINESE: 'zh-Hans',
  ENGLISH: 'en'
});

export const ConfigKey = Object.freeze({
  LANGUAGE: 'application.language',
  SNAP: 'editor.snap-subdivisions',
  ALLOW_NEGATIVE_SIZE: 'editor.allow-negative-size',
  SHIFT_SNAP_MODE: 'editor.snap-shift-mode',
  SHIFT_SNAP_VALUE: 'editor.snap-shift-value',
  CTRL_SNAP_MODE: 'editor.snap-ctrl-mode',
  CTRL_SNAP_VALUE: 'editor.snap-ctrl-value',
  SHIFT_CTRL_SNAP_MODE: 'editor.snap-shift-ctrl-mode',
  SHIFT_CTRL_SNAP_VALUE: 'editor.snap-shift-ctrl-value',
  SYMMETRY: 'editor.symmetry',
  ALPHA_LOCK: 'paint.alpha-lock',
  PROJECTION: 'viewport.projection',
  PREVIEW_SHADE: 'viewport.preview-shade',
  SHOW_GEOMETRY_ONLY: 'viewport.show-geometry-only',
  SHOW_GRID: 'viewport.show-grid',
  SHOW_WIREFRAME: 'viewport.show-wireframe'
});

export const LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze({ value: AppLanguage.TRADITIONAL_CHINESE, label: '繁體中文' }),
  Object.freeze({ value: AppLanguage.SIMPLIFIED_CHINESE, label: '简体中文' }),
  Object.freeze({ value: AppLanguage.ENGLISH, label: 'English' })
]);

const storage = typeof window !== 'undefined' ? window.localStorage : null;

function migrateSnapModifierDefaults(targetStorage) {
  if (!targetStorage) return;
  try {
    const key = 'cubebricks.config';
    const persisted = JSON.parse(targetStorage.getItem(key) || '{}');
    if (Number(persisted.version || 0) >= 2) return;
    const values = persisted.values && typeof persisted.values === 'object' ? persisted.values : {};
    values[ConfigKey.SHIFT_SNAP_MODE] = 'multiplier';
    values[ConfigKey.CTRL_SNAP_MODE] = 'multiplier';
    values[ConfigKey.SHIFT_CTRL_SNAP_MODE] = 'multiplier';
    targetStorage.setItem(key, JSON.stringify({ ...persisted, version: 2, values }));
  } catch {
    // Invalid persisted data is ignored by the registry and replaced on the
    // next successful settings change.
  }
}

migrateSnapModifierDefaults(storage);

export const configRegistry = new ConfigRegistry({ storage });

configRegistry.register({
  id: ConfigKey.LANGUAGE,
  type: ConfigType.ENUM,
  scope: ConfigScope.APPLICATION,
  defaultValue: AppLanguage.TRADITIONAL_CHINESE,
  options: LANGUAGE_OPTIONS,
  description: 'CubeBricks user-interface language.'
});

configRegistry.registerMany([
  {
    id: ConfigKey.SNAP,
    type: ConfigType.NUMBER,
    scope: ConfigScope.APPLICATION,
    defaultValue: 16,
    validate: value => value > 0,
    description: 'Transform snap subdivisions; the step is 16 divided by this value.'
  },
  { id: ConfigKey.ALLOW_NEGATIVE_SIZE, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: false, description: 'Allow cube dimensions to cross zero into negative values.' },
  { id: ConfigKey.SHIFT_SNAP_MODE, type: ConfigType.ENUM, scope: ConfigScope.APPLICATION, defaultValue: 'multiplier', options: [{ value: 'value', label: '數值' }, { value: 'multiplier', label: '乘數' }], description: 'How Shift modifies snap subdivisions.' },
  { id: ConfigKey.SHIFT_SNAP_VALUE, type: ConfigType.NUMBER, scope: ConfigScope.APPLICATION, defaultValue: 4, validate: value => value > 0, description: 'Shift snap value or multiplier.' },
  { id: ConfigKey.CTRL_SNAP_MODE, type: ConfigType.ENUM, scope: ConfigScope.APPLICATION, defaultValue: 'multiplier', options: [{ value: 'value', label: '數值' }, { value: 'multiplier', label: '乘數' }], description: 'How Ctrl modifies snap subdivisions.' },
  { id: ConfigKey.CTRL_SNAP_VALUE, type: ConfigType.NUMBER, scope: ConfigScope.APPLICATION, defaultValue: 8, validate: value => value > 0, description: 'Ctrl snap value or multiplier.' },
  { id: ConfigKey.SHIFT_CTRL_SNAP_MODE, type: ConfigType.ENUM, scope: ConfigScope.APPLICATION, defaultValue: 'multiplier', options: [{ value: 'value', label: '數值' }, { value: 'multiplier', label: '乘數' }], description: 'How Shift+Ctrl modifies snap subdivisions.' },
  { id: ConfigKey.SHIFT_CTRL_SNAP_VALUE, type: ConfigType.NUMBER, scope: ConfigScope.APPLICATION, defaultValue: 64, validate: value => value > 0, description: 'Shift+Ctrl snap value or multiplier.' },
  { id: ConfigKey.SYMMETRY, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: false, description: 'Mirror editing across the X axis.' },
  { id: ConfigKey.ALPHA_LOCK, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: false, description: 'Preserve texture alpha while painting.' },
  {
    id: ConfigKey.PROJECTION,
    type: ConfigType.ENUM,
    scope: ConfigScope.APPLICATION,
    defaultValue: 'perspective',
    options: [{ value: 'perspective', label: '透視' }, { value: 'orthographic', label: '正交' }],
    description: 'Viewport camera projection.'
  },
  { id: ConfigKey.PREVIEW_SHADE, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: true, description: 'Enable face shading in the viewport when the element also allows shading.' },
  { id: ConfigKey.SHOW_GEOMETRY_ONLY, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: false, description: 'Hide helper objects such as locators without changing their individual visibility.' },
  { id: ConfigKey.SHOW_GRID, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: true, description: 'Show the viewport floor grid.' },
  { id: ConfigKey.SHOW_WIREFRAME, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: false, description: 'Show model wireframe bounds.' }
]);

export function getLanguageLabel(language = configRegistry.get(ConfigKey.LANGUAGE)) {
  return LANGUAGE_OPTIONS.find(option => option.value === language)?.label || language;
}

const ENGLISH_UI = Object.freeze({
  '未保存': 'Unsaved', '主選單': 'Main menu', '新建': 'New', '打開': 'Open', '保存': 'Save', '撤銷': 'Undo', '重做': 'Redo', 'CubeBricks 設定': 'CubeBricks Settings',
  '編輯': 'Edit', '繪畫': 'Paint', '動畫': 'Animate', '設定': 'Settings', '導出': 'Export',
  '工具欄': 'Toolbar', '工具': 'Tools', '目前工具參數': 'Current tool options', '工具參數': 'Tool options',
  '移動': 'Move', '縮放': 'Scale', '旋轉': 'Rotate', '新增方塊': 'Add cube', '新增形狀': 'Add shape', '新增 Locator': 'Add locator', '畫筆': 'Brush',
  '移動樞軸': 'Move pivot', '頂點捕捉': 'Vertex snap', '刀具切割': 'Knife', '切割軸': 'Cut axis',
  '沿 X 軸切割': 'Cut along X', '沿 Y 軸切割': 'Cut along Y', '沿 Z 軸切割': 'Cut along Z',
  '先選來源頂點': 'Select source vertex', '再選目標頂點': 'Select target vertex',
  '頂點捕捉模式': 'Vertex snap mode', '移動捕捉': 'Move snap', '縮放捕捉': 'Scale snap', '旋轉捕捉': 'Rotate snap',
  '頂點旋轉模式': 'Vertex rotation mode', '繞 X 軸': 'Around X', '繞 Y 軸': 'Around Y', '繞 Z 軸': 'Around Z',
  '沿最長軸': 'Longest axis', '最長軸': 'Longest', '繞樞軸點自由對齊': 'Free alignment around pivot', '樞軸點': 'Pivot',
  '選中項樞軸點': 'Selected item pivot', '已取消來源頂點': 'Source vertex cleared',
  '縮放捕捉目前只適用於 Cube': 'Scale snap currently supports cubes only', '這個物件不能旋轉捕捉': 'This object cannot use rotation snap',
  '所選頂點無法建立旋轉方向': 'The selected vertices cannot define a rotation',
  '已移動至目標頂點': 'Moved to target vertex', '已縮放至目標頂點': 'Scaled to target vertex', '已旋轉對齊目標頂點': 'Rotated to target vertex',
  '請先選擇目前物件的來源頂點': 'Select a source vertex on the current object first',
  '目標頂點必須位於目前選取範圍之外': 'The target vertex must be outside the current selection',
  '已捕捉至目標頂點': 'Snapped to target vertex', '刀具目前只能切割 Cube': 'The knife currently cuts cubes only',
  '切割位置必須位於 Cube 內部': 'The cut must be inside the cube',
  '選擇切割點': 'Select a cut point', '選擇橫切或豎切': 'Choose a horizontal or vertical cut',
  '豎切': 'Vertical cut', '橫切': 'Horizontal cut', '已取消切割點': 'Cut point cleared',
  '第二點必須位於同一個 Cube 面上': 'The second point must be on the same cube face',
  '已選擇切割點；再選橫切或豎切方向': 'Cut point selected; choose a horizontal or vertical direction',
  '這個吸附點無法建立有效切面': 'This snap point cannot define a valid cut plane',
  '變換坐標系': 'Transform space', '全局': 'Global', '父級': 'Parent', '自身': 'Local',
  '全局坐標系': 'Global space', '父級坐標系': 'Parent space', '自身坐標系': 'Local space',
  '自身旋轉模式': 'Local rotation mode', '姿態': 'Pose', '歐拉角': 'Euler',
  '姿態模式：沿物件目前姿態的局部軸旋轉': 'Pose mode: rotate along the object’s current local axes',
  '歐拉角模式：按 Z → Y → X 層級直接調整歐拉角': 'Euler mode: edit angles directly in Z → Y → X hierarchy',
  '縮放手柄長度': 'Scale gizmo length', '貼合': 'Bounds', '固定': 'Fixed',
  '手柄貼合物體幾何範圍': 'Fit gizmo to geometry bounds', '手柄使用和移動工具相同的固定視覺長度': 'Use the same fixed relative length as the move gizmo',
  '切換吸附精度': 'Cycle snap precision', '吸附': 'Snap', '全局選項': 'Global options',
  '面陰影': 'Shading', '僅幾何': 'Geometry only', '對稱': 'Symmetry', '鎖透明': 'Alpha lock',
  '全局開啟或關閉面陰影預覽；不會覆蓋物件自身的陰影設定': 'Toggle viewport shading globally without overriding per-object shading',
  '只顯示 Cube 和 Shape；暫時隱藏 Locator 等輔助物件': 'Show only cubes and shapes; temporarily hide helpers such as locators',
  '沿 X 軸對稱編輯': 'Mirror edits across the X axis', '繪畫時鎖定透明度': 'Preserve alpha while painting',
  '左側停靠區': 'Left dock', '右側停靠區': 'Right dock', '底部停靠區': 'Bottom dock',
  '貼圖': 'Textures', '導入貼圖': 'Import texture', '折疊或展開面板': 'Collapse or expand panel', '折疊／展開': 'Collapse / expand',
  '視圖模式': 'View mode', '透視': 'Perspective', '正交': 'Orthographic', '實體著色': 'Entity shading', '貼圖預覽': 'Texture preview', '動畫預覽': 'Animation preview',
  '聚焦': 'Focus', '網格': 'Grid', '邊界線框': 'Bounds wireframe', '實心': 'Solid', '實心 Mipped': 'Solid Mipped',
  '半透明': 'Translucent', '半透明 Mipped': 'Translucent Mipped', '背面剔除': 'Back-face culling', '剔除': 'Cull',
  '變換手柄': 'Transform gizmo', 'Locator 標記': 'Locator marker', '目前：線框': 'Current: Wireframe', '目前：體塊': 'Current: Solid', '目前：紋理': 'Current: Textured',
  '目前渲染模式：線框': 'Current render mode: Wireframe', '目前渲染模式：體塊': 'Current render mode: Solid', '目前渲染模式：紋理': 'Current render mode: Textured',
  '線框': 'Wireframe', '體塊': 'Solid', '紋理': 'Textured', '座標軸': 'Axes', '頂視圖': 'Top view', '右視圖': 'Right view', '正視圖': 'Front view',
  '中鍵': 'Middle mouse', 'Shift + 中鍵': 'Shift + Middle mouse', '平移': 'Pan', '滾輪': 'Wheel', '中心': 'Origin',
  '色卡': 'Palette', '時間軸': 'Timeline', '輸出': 'Output', '模型色卡': 'Model palette', '新增一行': 'Add row', '項目已就緒。': 'Project ready.',
  '物件屬性': 'Object properties', '場景層級': 'Scene hierarchy', '新增組': 'Add group', '搜尋物件或 UID': 'Search objects or UID',
  '基本': 'Basic', '立方體': 'Cube', '程序化形狀': 'Procedural shape', '組': 'Group', '名稱': 'Name', '可見': 'Visible',
  '幾何': 'Geometry', '重置': 'Reset', '位置': 'Position', '尺寸': 'Size', '樞軸': 'Pivot', '膨脹': 'Inflate',
  'UV 模式': 'UV mode', '箱型 UV': 'Box UV', '逐面 UV': 'Per-face UV', '形狀參數': 'Shape parameters',
  '半徑': 'Radius', '高度': 'Height', '邊數': 'Sides', '生成 Cube': 'Generated cubes', 'Locator 變換': 'Locator transform',
  '組變換': 'Group transform', '直接子項': 'Direct children', '外觀': 'Appearance', '預覽色': 'Preview color', '材質色': 'Material color',
  '刪除物件': 'Delete object', '刪除組及其內容': 'Delete group and contents', '選擇一個 Cube、Shape 或組來編輯。': 'Select a cube, shape, or group to edit.',
  '選擇一個 Cube、Shape、Locator 或組來編輯。': 'Select a cube, shape, locator, or group to edit.', '已新增 Locator': 'Locator added',
  '一般': 'General', '所有選項即時生效，並通過配置註冊表保存在這台電腦上。': 'All options apply immediately and are saved on this computer through the configuration registry.',
  '設定分類': 'Settings categories', '介面、視口與編輯行為': 'Interface, viewport, and editing behavior', '介面語言': 'Interface language',
  '視口投影': 'Viewport projection', '顯示網格': 'Show grid', '線框邊界': 'Wireframe bounds', '僅顯示幾何': 'Show geometry only',
  '面陰影預覽': 'Shading preview', '對稱編輯': 'Symmetry editing', '鎖定透明度': 'Lock alpha',
  '吸附步長為 16 ÷ 精度；16 = 1px，32 = 0.5px': 'Snap step is 16 ÷ precision; 16 = 1px, 32 = 0.5px',
  '允許負尺寸': 'Allow negative size', '關閉時 Cube 最小尺寸為 0': 'When disabled, the minimum cube size is 0', '吸附精度': 'Snap precision',
  '直接數值': 'Absolute value', '默認乘數': 'Default multiplier', '默認 4': 'Default 4', '默認 8': 'Default 8', '默認 64': 'Default 64',
  '顏色、圓角與介面縮放': 'Colors, corner radius, and UI scale', '強調色': 'Accent', '背景色': 'Background', '面板色': 'Panel',
  '視窗色': 'Viewport', '選中邊框': 'Selection outline', '圓角': 'Corner radius', '介面縮放': 'UI scale',
  '苔原': 'Moss', '琥珀': 'Amber', '熔岩': 'Ember', '深海': 'Slate', '恢復預設': 'Restore defaults', '完成': 'Done', '外觀已套用': 'Appearance applied',
  '聚焦選中物件': 'Focus selected object', '回到場景中心': 'Return to scene origin', '隱藏網格': 'Hide grid', '顯示網格': 'Show grid',
  '隱藏邊界線框': 'Hide bounds wireframe', '顯示邊界線框': 'Show bounds wireframe', '設為目前貼圖': 'Set as current texture',
  '在繪畫模式打開': 'Open in Paint mode', '導入新貼圖': 'Import new texture', '新增色卡行': 'Add palette row',
  '改用離散色卡': 'Use discrete palette', '啟用連續漸變': 'Enable continuous gradient', '隱藏': 'Hide', '顯示': 'Show',
  '展開組': 'Expand group', '折疊組': 'Collapse group', '刪除': 'Delete', '角度': 'Angle', '距離': 'Distance'
});

const SIMPLIFIED_PHRASES = Object.freeze({
  '物件': '对象', '貼圖': '贴图', '默認': '默认', '坐標': '坐标', '全局': '全局', '程序化': '程序化',
  '色階': '色阶', '搜尋': '搜索', '介面': '界面', '設定': '设置', '註冊表': '注册表',
  '目前': '当前', '著色': '着色', '視窗色': '视口色'
});

const SIMPLIFIED_CHARS = Object.freeze({
  '體':'体','開':'开','關':'关','閉':'闭','陰':'阴','顯':'显','圖':'图','層':'层','編':'编','輯':'辑','繪':'绘','畫':'画','動':'动','導':'导','檔':'档','儲':'储','復':'复','設':'设','覽':'览','縮':'缩','態':'态','級':'级','軸':'轴','長':'长','圍':'围','線':'线','僅':'仅','鎖':'锁','稱':'称','變':'变','換':'换','擇':'择','組':'组','場':'场','間':'间','輸':'输','項':'项','參':'参','數':'数','塊':'块','刪':'删','除':'除','見':'见','幾':'几','樞':'枢','脹':'胀','狀':'状','徑':'径','邊':'边','質':'质','預':'预','選':'选','語':'语','網':'网','負':'负','許':'许','顔':'颜','顏':'颜','圓':'圆','強':'强','調':'调','熔':'熔','還':'还','應':'应','過':'过','這':'这','臺':'台','電':'电','腦':'脑','獨':'独','當':'当','與':'与','後':'后','會':'会','啟':'启','連':'连','續':'续','離':'离','內':'内','實':'实','視':'视','點':'点','擊':'击','進':'进','階':'阶','構':'构','則':'则','個':'个','處':'处','從':'从','標':'标','記':'记','題':'题','樣':'样','細':'细','節':'节','類':'类','別':'别','載':'载','務':'务','優':'优','勢':'势','據':'据','墊':'垫','疊':'叠','寬':'宽','釋':'释','權':'权','傳':'传','統':'统','築':'筑','擁':'拥','護':'护','隱':'隐','響':'响','極':'极','遠':'远','習':'习','萬':'万','屬':'属','為':'为','時':'时','種':'种','並':'并','註':'注','冊':'册','觀':'观','對':'对','滾':'滚','輪':'轮','鍵':'键','頂':'顶','單':'单','銷':'销','欄':'栏','轉':'转','筆':'笔','蓋':'盖','暫':'暂','輔':'辅','側':'侧','區':'区','紋':'纹','帶':'带','巢':'巢','匯':'汇','總':'总',
  '來':'来','歐':'欧','貼':'贴','範':'范','覺':'觉','緒':'绪','沒':'没','漸':'渐','無':'无','讀':'读','張':'张','敗':'败','認':'认','義':'义','請':'请','須':'须','於':'于','繞':'绕','齊':'齐','適':'适','豎':'竖','橫':'横'
});

function toSimplified(source) {
  let result = source;
  for (const [traditional, simplified] of Object.entries(SIMPLIFIED_PHRASES)) result = result.replaceAll(traditional, simplified);
  return [...result].map(character => SIMPLIFIED_CHARS[character] || character).join('');
}

export function translateUiText(source, language = configRegistry.get(ConfigKey.LANGUAGE)) {
  const text = String(source ?? '');
  if (language === AppLanguage.TRADITIONAL_CHINESE) return text;
  if (language === AppLanguage.SIMPLIFIED_CHINESE) return toSimplified(text);
  if (language !== AppLanguage.ENGLISH) return text;
  if (ENGLISH_UI[text]) return ENGLISH_UI[text];
  let match = text.match(/^(\d+) 行 · 每行獨立設定$/);
  if (match) return `${match[1]} rows · configured independently`;
  match = text.match(/^吸附 (.+) · (.+)px$/);
  if (match) return `Snap ${match[1]} · ${match[2]}px`;
  match = text.match(/^介面語言：(.*)$/);
  if (match) return `Interface language: ${match[1]}`;
  match = text.match(/^已沿 ([XYZ]) 軸切割 (.+)$/);
  if (match) return `Cut ${match[2]} along the ${match[1]} axis`;
  match = text.match(/^預覽：(豎切|橫切)$/);
  if (match) return `Preview: ${match[1] === '豎切' ? 'vertical cut' : 'horizontal cut'}`;
  match = text.match(/^已(豎切|橫切|完成切割) (.+)（([XYZ]) 軸）$/);
  if (match) return `${match[1] === '豎切' ? 'Vertically cut' : match[1] === '橫切' ? 'Horizontally cut' : 'Cut'} ${match[2]} on the ${match[3]} axis`;
  match = text.match(/^樞軸 (.+)$/);
  if (match) return `Pivot ${match[1]}`;
  match = text.match(/^(.+) 個$/);
  if (match) return match[1];
  return text;
}

let activeLanguage = AppLanguage.TRADITIONAL_CHINESE;
let languageObserver = null;
const textSources = new WeakMap();
const attributeSources = new WeakMap();
const TRANSLATED_ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'data-tooltip'];

function translateTextNode(node) {
  const current = node.nodeValue || '';
  const trimmed = current.trim();
  if (!trimmed) return;
  const previousSource = textSources.get(node);
  const knownTranslation = previousSource !== undefined && Object.values(AppLanguage)
    .some(language => translateUiText(previousSource, language) === trimmed);
  const source = previousSource === undefined || !knownTranslation ? trimmed : previousSource;
  textSources.set(node, source);
  const translated = translateUiText(source, activeLanguage);
  const next = current.replace(trimmed, translated);
  if (next !== current) node.nodeValue = next;
}

function translateElementAttributes(element) {
  let sources = attributeSources.get(element);
  if (!sources) { sources = {}; attributeSources.set(element, sources); }
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    if (!element.hasAttribute(attribute)) continue;
    const current = element.getAttribute(attribute);
    const previousSource = sources[attribute];
    const knownTranslation = previousSource !== undefined && Object.values(AppLanguage)
      .some(language => translateUiText(previousSource, language) === current);
    const source = previousSource === undefined || !knownTranslation ? current : previousSource;
    sources[attribute] = source;
    const translated = translateUiText(source, activeLanguage);
    if (translated !== current) element.setAttribute(attribute, translated);
  }
}

function translateSubtree(root) {
  if (!root) return;
  if (root.nodeType === 3) { translateTextNode(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  if (root.nodeType === 1) translateElementAttributes(root);
  const walker = document.createTreeWalker(root, 5);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) translateTextNode(node);
    else translateElementAttributes(node);
  }
}

export function applyLanguage(language = configRegistry.get(ConfigKey.LANGUAGE)) {
  if (typeof document === 'undefined') return;
  activeLanguage = language;
  document.documentElement.lang = language;
  document.documentElement.dir = 'ltr';
  translateSubtree(document);
  if (!languageObserver && typeof MutationObserver !== 'undefined') {
    languageObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateTextNode(mutation.target);
        else if (mutation.type === 'attributes') translateElementAttributes(mutation.target);
        else mutation.addedNodes.forEach(translateSubtree);
      }
    });
    languageObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATED_ATTRIBUTES
    });
  }
}
