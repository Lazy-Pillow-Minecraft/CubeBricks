import { ConfigRegistry, ConfigScope, ConfigType } from '../core/config-registry.js';

export const AppLanguage = Object.freeze({
  TRADITIONAL_CHINESE: 'zh-Hant',
  SIMPLIFIED_CHINESE: 'zh-Hans',
  ENGLISH: 'en'
});

export const ConfigKey = Object.freeze({
  LANGUAGE: 'application.language',
  SEPARATE_UV_MODE: 'editor.separate-uv-mode',
  SNAP: 'editor.snap-subdivisions',
  ALLOW_NEGATIVE_SIZE: 'editor.allow-negative-size',
  SHIFT_SNAP_MODE: 'editor.snap-shift-mode',
  SHIFT_SNAP_VALUE: 'editor.snap-shift-value',
  CTRL_SNAP_MODE: 'editor.snap-ctrl-mode',
  CTRL_SNAP_VALUE: 'editor.snap-ctrl-value',
  SHIFT_CTRL_SNAP_MODE: 'editor.snap-shift-ctrl-mode',
  SHIFT_CTRL_SNAP_VALUE: 'editor.snap-shift-ctrl-value',
  ALPHA_LOCK: 'paint.alpha-lock',
  PROJECTION: 'viewport.projection',
  PREVIEW_SHADE: 'viewport.preview-shade',
  SHOW_PLAYER_REFERENCE: 'viewport.show-player-reference',
  PLAYER_REFERENCE_TEXTURE: 'viewport.player-reference-texture',
  SHOW_GEOMETRY_ONLY: 'viewport.show-geometry-only',
  MODIFIER_RESULT_GHOST: 'viewport.modifier-result-ghost',
  SHOW_GRID: 'viewport.show-grid',
  SHOW_WIREFRAME: 'viewport.show-wireframe',
  CUBE_BIRTH_MS: 'viewport.cube-birth-ms',
  CUBE_DEATH_MS: 'viewport.cube-death-ms',
  LOCKED_DEFAULT_ALPHA: 'viewport.locked-default-alpha',
  LOCKED_HOVER_FADE: 'viewport.locked-hover-fade',
  LOCKED_HOVER_ALPHA: 'viewport.locked-hover-alpha',
  LOCKED_HOVER_RADIUS: 'viewport.locked-hover-radius'
});

export const LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze({ value: AppLanguage.TRADITIONAL_CHINESE, label: '繁體中文' }),
  Object.freeze({ value: AppLanguage.SIMPLIFIED_CHINESE, label: '简体中文' }),
  Object.freeze({ value: AppLanguage.ENGLISH, label: 'English' })
]);

const storage = typeof window !== 'undefined' ? window.localStorage : null;

export function migrateConfigDefaults(targetStorage) {
  if (!targetStorage) return;
  try {
    const key = 'cubebricks.config';
    const persisted = JSON.parse(targetStorage.getItem(key) || '{}');
    const version = Number(persisted.version || 0);
    if (version >= 3) return;
    const values = persisted.values && typeof persisted.values === 'object' ? persisted.values : {};
    if (version < 2) {
      values[ConfigKey.SHIFT_SNAP_MODE] = 'multiplier';
      values[ConfigKey.CTRL_SNAP_MODE] = 'multiplier';
      values[ConfigKey.SHIFT_CTRL_SNAP_MODE] = 'multiplier';
    }
    // Version 2 shipped 25 as the hover-fade default. Only migrate that exact
    // former default so an explicitly chosen percentage is otherwise retained.
    if (version < 3 && values[ConfigKey.LOCKED_HOVER_ALPHA] === 25) {
      values[ConfigKey.LOCKED_HOVER_ALPHA] = 50;
    }
    targetStorage.setItem(key, JSON.stringify({ ...persisted, version: 3, values }));
  } catch {
    // Invalid persisted data is ignored by the registry and replaced on the
    // next successful settings change.
  }
}

migrateConfigDefaults(storage);

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
  { id: ConfigKey.SEPARATE_UV_MODE, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: false, description: 'Separate UV editing from model editing into its own workspace mode.' },
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
  { id: ConfigKey.SHOW_PLAYER_REFERENCE, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: false, description: 'Show the non-editable player scale reference in the viewport.' },
  { id: ConfigKey.PLAYER_REFERENCE_TEXTURE, type: ConfigType.OBJECT, scope: ConfigScope.APPLICATION, defaultValue: { name: '內置玩家紋理', source: '' }, validate: value => typeof value.name === 'string' && typeof value.source === 'string', description: 'Custom skin used by the non-editable player reference.' },
  { id: ConfigKey.SHOW_GEOMETRY_ONLY, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: false, description: 'Hide helper objects such as locators without changing their individual visibility.' },
  { id: ConfigKey.MODIFIER_RESULT_GHOST, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: false, description: 'Display generated modifier results at 75% opacity and disable their selection.' },
  { id: ConfigKey.SHOW_GRID, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: true, description: 'Show the viewport floor grid.' },
  { id: ConfigKey.SHOW_WIREFRAME, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: false, description: 'Show model wireframe bounds.' },
  { id: ConfigKey.CUBE_BIRTH_MS, type: ConfigType.NUMBER, scope: ConfigScope.APPLICATION, defaultValue: 60, validate: value => value >= 0 && value <= 500, description: 'Cube appearance animation in milliseconds; zero disables it.' },
  { id: ConfigKey.CUBE_DEATH_MS, type: ConfigType.NUMBER, scope: ConfigScope.APPLICATION, defaultValue: 60, validate: value => value >= 0 && value <= 500, description: 'Cube disappearance animation in milliseconds; zero disables it.' },
  { id: ConfigKey.LOCKED_DEFAULT_ALPHA, type: ConfigType.NUMBER, scope: ConfigScope.APPLICATION, defaultValue: 100, validate: value => value >= 0 && value <= 100, description: 'Opacity percentage used for locked viewport objects.' },
  { id: ConfigKey.LOCKED_HOVER_FADE, type: ConfigType.BOOLEAN, scope: ConfigScope.APPLICATION, defaultValue: true, description: 'Fade a locked object while the pointer is over it.' },
  { id: ConfigKey.LOCKED_HOVER_ALPHA, type: ConfigType.NUMBER, scope: ConfigScope.APPLICATION, defaultValue: 50, validate: value => value >= 0 && value <= 100, description: 'Opacity percentage at the center of the pointer fade region.' },
  { id: ConfigKey.LOCKED_HOVER_RADIUS, type: ConfigType.NUMBER, scope: ConfigScope.APPLICATION, defaultValue: 120, validate: value => value >= 8 && value <= 2048, description: 'Screen-space radius in pixels for the locked-object pointer fade region.' }
]);

export function getLanguageLabel(language = configRegistry.get(ConfigKey.LANGUAGE)) {
  return LANGUAGE_OPTIONS.find(option => option.value === language)?.label || language;
}

const ENGLISH_UI = Object.freeze({
  '項目首頁': 'Project home', '工作項目': 'Workspace projects', '新建模型': 'New model',
  '選擇格式開始製作': 'Choose a format to get started', '繼續上次的工作，或從左側新建模型。': 'Continue a project or create a model from the left.',
  '重新整理': 'Refresh', '本機工作項目只在桌面版顯示。': 'Local projects are available in the desktop app.',
  '尚無工作項目。從左側選擇模型格式開始吧。': 'No projects yet. Choose a model format on the left to begin.',
  '未保存的工作項目': 'Unsaved working project', '個元素': 'elements',
  '繪畫選區': 'Paint selection', '選區': 'Selection', '拉框': 'Rectangle', '塗抹': 'Brush',
  '自由圈選': 'Freehand lasso', '清除選區': 'Clear selection', '選區跟隨繪畫對稱': 'Apply paint symmetry to selection',
  '像素變換': 'Pixel transform', '操作': 'Action', '自由旋轉': 'Free rotation',
  '複製像素：關': 'Copy pixels: off', '複製像素：開': 'Copy pixels: on',
  'Cube 出現動畫': 'Cube appearance animation', 'Cube 消失動畫': 'Cube disappearance animation',
  '旋轉時解除 90° 吸附': 'Disable 90° snapping while rotating',
  '保留原像素，下次變換時複製選中像素': 'Keep original pixels and duplicate the selection on the next transform',
  '項目列表讀取失敗': 'Could not load the project list', '打開工作項目失敗': 'Could not open the working project',
  '↥ 導入': '↥ Import', '＋ 新建': '+ New', '＋ 新增一行': '+ Add row', '▰＋ 組': '▰+ Group',
  '◇ 交點顯示': '◇ Show intersections', '交點顯示': 'Show intersections',
  '1.21.11+ · 無限制': '1.21.11+ · Unrestricted',
  '1.21.6 – 1.21.10 · 自由角度／單軸': '1.21.6–1.21.10 · Free angle / one axis',
  '1.9 – 1.21.5 · 22.5°／單軸': '1.9–1.21.5 · 22.5° / one axis',
  'Java 方塊／物品版本': 'Java block/item version', '決定 Cube 旋轉限制': 'Sets cube rotation limits',
  '上': 'Up', '下': 'Down', '北': 'North', '南': 'South', '東': 'East', '西': 'West',
  '上面': 'Top face', '下面': 'Bottom face', '北面': 'North face', '南面': 'South face', '東面': 'East face', '西面': 'West face',
  '上下鏡像': 'Mirror up/down', '左右鏡像': 'Mirror left/right',
  '不同來源的面維持獨立佔位': 'Keep faces from different sources in separate slots',
  '勾選下次要恢復的分頁。取消勾選會刪除該項目的本機工作記錄，不會刪除已保存的模型檔。': 'Select the tabs to keep for next time. Unselected local working records are deleted; saved model files are not.',
  '另存為 PNG': 'Save as PNG', '複製到剪切板': 'Copy to clipboard', '透明背景模型截圖預覽': 'Transparent model capture preview',
  '右視圖 (+X)': 'Right view (+X)', '左視圖 (−X)': 'Left view (−X)', '正視圖 (+Z)': 'Front view (+Z)',
  '背視圖 (−Z)': 'Back view (−Z)', '頂視圖 (+Y)': 'Top view (+Y)', '底視圖 (−Y)': 'Bottom view (−Y)',
  '左鍵下一檔，右鍵上一檔': 'Left-click for next snap; right-click for previous',
  '平均分': 'Even spacing', '自定義': 'Custom', '按曲線長度': 'By curve length',
  '未選擇面': 'No face selected', '生成物以 75% 可見度的獨立圖層顯示，後方模型與網格可透出；同時禁止選取及頂點捕捉': 'Show generated objects on a separate 75%-visible layer so models and grid show through; disable selection and vertex snapping.',
  '用不同半透明顏色區分六個面': 'Distinguish the six faces with translucent colors',
  '在 UV 預覽中選面後自動聚焦貼圖窗口': 'Focus the texture window after selecting a face in UV preview',
  '多邊形柱體': 'Polygonal prism', '色卡，選中色塊後可按 Delete 刪除': 'Palette; select a swatch and press Delete to remove it',
  '吸附 1.0': 'Snap 1.0', '更改位置': 'Change location', '建立': 'Create', '按 Cube 建立連續六面展開': 'Unwrap six faces continuously per cube',
  '生成物以 75% 可見度的獨立圖層顯示': 'Show generated objects at 75% visibility',
  '貼圖操作': 'Texture actions', '場景層級操作': 'Outliner actions', '圖層與貼圖模式': 'Layers and texture modes',
  '修改器結果虛化': 'Fade modifier results', '無貼圖': 'No texture', '新增 Shape': 'Add shape',
  '對稱修改器輔助網格': 'Mirror modifier guide grid', '截屏模型': 'Capture model',
  '漸變分段類別': 'Gradient segment mode', '漸變預覽': 'Gradient preview',
  '模式選項': 'Mode options', '確認並關閉': 'Confirm and close', '選中 UV 參數': 'Selected UV coordinates',
  '選中全部上面': 'Select all top faces', '選中全部下面': 'Select all bottom faces',
  '選中全部北面': 'Select all north faces', '選中全部南面': 'Select all south faces',
  '選中全部東面': 'Select all east faces', '選中全部西面': 'Select all west faces',
  '選中面 UV 操作': 'Selected-face UV actions', '選中面的平鋪': 'Tiling for selected face',
  '選中面標記': 'Selected-face marker', '選面後聚焦 UV': 'Focus UV after face selection',
  '默認開啟': 'Enabled by default', '縮略模式': 'Compact mode',
  '縮略模式：只保留選色': 'Compact mode: color picking only', '關閉軟體': 'Close application',
  '讀取中…': 'Loading…', '顯示選中元素邊線與周圍元素的三維交點（僅作目標）': 'Show 3D edge intersections around selected elements (targets only)',
  'UV 尺寸會按照項目基礎吸附分辨率四捨五入；非零邊長至少分配 1px，並由大到小自左上角打包。': 'UV dimensions are rounded using the project base snap; nonzero edges get at least 1 px and are packed largest-first from the top-left.',
  'UV 面之間保留像素': 'Leave pixels between UV faces', 'UV 面選擇': 'UV face selection',
  'UV 預覽選項': 'UV preview options', 'UV 編輯區': 'UV editing area',
  '上移': 'Move up', '下移': 'Move down', '工作空間已切換；新項目使用 projects/，Shape 包從 shapepacks/ 載入': 'Workspace changed. New projects use projects/ and shape packs load from shapepacks/.',
  '已下載模型截圖': 'Model capture downloaded', '已建立並連接新節點': 'Created and connected a new node',
  '已剪切選中項': 'Cut selection', '已將貝塞爾元素斷開為兩段': 'Split the Bezier element in two',
  '已將樞軸移至目標頂點（幾何保持不動）': 'Moved the pivot to the target vertex without moving geometry',
  '已就地複製選中項': 'Duplicated selection in place', '已貼上元素': 'Pasted elements',
  '已進入細分編輯；其他物件已虛化': 'Entered Subdivision Edit; other objects are faded',
  '已新增 Cube': 'Cube added', '已新增組': 'Group added',
  '已導出 .bbmodel（目前瀏覽器不支援格式選擇）': 'Exported .bbmodel; format selection is unavailable in this browser',
  '已導出 .bbmodel（程序化物件已轉為 Cube 組）': 'Exported .bbmodel; procedural objects were converted to cube groups',
  '已導出 .cbmodel': 'Exported .cbmodel', '已複製選中項': 'Copied selection',
  '元素剪貼簿是空的': 'The element clipboard is empty', '內半徑': 'Inner radius',
  '分配 UV': 'Assign UV', '分配貼圖': 'Assign texture', '切割 Cube': 'Cut cube',
  '切割後兩端都必須至少保留兩個節點': 'Each side of the cut must retain at least two nodes',
  '切換': 'Switch', '切換元素可見性': 'Toggle element visibility', '切換元素選項': 'Toggle element options',
  '切斷曲線': 'Split curve', '加入參考圖': 'Add reference image', '可見性': 'Visibility',
  '正在建立面關聯…': 'Building face relations…', '正在截取屏幕內模型…': 'Capturing model visible on screen…',
  '正在離屏渲染模型…': 'Rendering model offscreen…', '生成貼圖模板': 'Generate texture template',
  '目前 Java 版本只允許單軸旋轉，請拖動 X、Y 或 Z 軸圓環': 'This Java version only permits one-axis rotation. Drag the X, Y, or Z ring.',
  '目前沒有可建立模板的 Cube': 'There are no cubes available for a template',
  '目前沒有可聚焦的物件': 'There is no object to focus',
  '目前變更尚未寫入工作記錄': 'Current changes have not been saved to the working journal',
  '交點只能作為目標點，請先選普通頂點或樞軸點': 'Intersections can only be targets. Select a regular vertex or pivot first.',
  '先選擇一個物件': 'Select an object first', '再選目標頂點或交點': 'Select a target vertex or intersection',
  '向內延伸距離': 'Inward extension distance',
  '刪除元素': 'Delete element', '刪除曲線節點': 'Delete curve node', '刪除參考圖': 'Delete reference image',
  '刪除圖層': 'Delete layer', '刪除顏色': 'Delete color', '在此新增漸變節點': 'Add a gradient node here',
  '至少保留一行色卡': 'Keep at least one palette row', '色彩空間預覽網格無法建立': 'Could not create the color-space preview grid',
  '完成細分編輯': 'Finish Subdivision Edit', '折疊停靠區': 'Collapse dock', '展開停靠區': 'Expand dock',
  '沒有可重做的操作': 'Nothing to redo', '沒有可重做的繪畫操作': 'No paint stroke to redo',
  '沒有可撤銷的操作': 'Nothing to undo', '沒有可撤銷的繪畫操作': 'No paint stroke to undo',
  '沒有可複製的選中項': 'No selected item to copy', '系統命名': 'System-generated name',
  '尚未生成模型截圖': 'No model capture has been generated',
  '尚有未寫入的操作，工作目錄已保留': 'The working directory was kept because some operations are still unwritten',
  '底圖': 'Base image', '油漆桶填充': 'Bucket fill', '物件已刪除': 'Object deleted',
  '直線繪製': 'Draw line', '保留細分編輯': 'Preserve Subdivision Edit', '屏幕截圖': 'Screen capture',
  '建立 Cube': 'Create cube', '建立 Locator': 'Create locator', '建立 Shape': 'Create shape',
  '建立貝塞爾曲線': 'Create Bezier curve', '建立組': 'Create group', '建立貼圖': 'Create texture',
  '建立項目': 'Create project', '重設元素旋轉': 'Reset element rotation', '重設參考圖': 'Reset reference image',
  '面漸變的第二點必須在同一個 UV 面': 'The second gradient point must be on the same UV face',
  '面漸變的第二點必須在同一個面': 'The second gradient point must be on the same face',
  '修改': 'Edit', '修改 Shape 內半徑': 'Edit shape inner radius', '修改 Shape 內半徑模式': 'Edit shape inner-radius mode',
  '修改 Shape 吸附模式': 'Edit shape snap mode', '修改 UV 座標': 'Edit UV coordinates',
  '修改元素三軸參數': 'Edit element XYZ values', '修改元素顏色': 'Edit element color',
  '修改元素屬性': 'Edit element properties', '修改平鋪貼圖參數': 'Edit tiled texture settings',
  '修改曲線分段': 'Edit curve segments', '修改曲線切線': 'Edit curve tangents',
  '修改曲線手柄': 'Edit curve handles', '修改曲線滾動角': 'Edit curve roll',
  '修改色卡': 'Edit palette', '修改背面剔除': 'Edit back-face culling',
  '修改渲染類型': 'Edit render type', '修改貼圖模式': 'Edit texture mode',
  '修改項目吸附精度': 'Edit project snap precision', '修改項目信息': 'Edit project information',
  '修改器結果 · 唯讀': 'Modifier result · read-only',
  '修改器結果只能作為目標捕捉點': 'Modifier results can only be target snap points',
  '烘焙 Shape 為 Cube 組': 'Bake shape to cube group', '烘焙為 Cube 組': 'Bake to cube group',
  '矩形繪製': 'Draw rectangle', '剪下元素': 'Cut elements', '剪切 Ctrl+X': 'Cut Ctrl+X',
  '參考圖快照缺失': 'Reference-image snapshot is missing', '旋轉 UV': 'Rotate UV',
  '旋轉元素': 'Rotate element', '深潭': 'Deep Pool', '移動 UV': 'Move UV',
  '移動元素': 'Move element', '移動曲線節點': 'Move curve node',
  '移動參考圖': 'Move reference image', '移動節點': 'Move node',
  '移動層級': 'Move in hierarchy', '移動樞軸點': 'Move pivot',
  '細分 Cube 由 Shape 管理，不能單獨刪除': 'Subdivision cubes belong to the shape and cannot be deleted individually',
  '細分編輯期間只能選擇目前 Shape 內的 Cube': 'Only cubes in the current shape can be selected during Subdivision Edit',
  '透明度 %': 'Opacity %', '這個 Shape 目前沒有可編輯的 Cube': 'This shape has no editable cubes',
  '這個 Shape 沒有可烘焙的 Cube': 'This shape has no cubes to bake',
  '這個元素沒有可繪畫的貼圖': 'This element has no paintable texture',
  '這個面尚未分配貼圖，無法繪製': 'This face has no assigned texture and cannot be painted',
  '這個格式尚未實現': 'This format is not implemented yet', '這個配置值無效': 'Invalid configuration value',
  '單面局限時請先指向一個貼圖面': 'Point to a textured face before using single-face mode',
  '場景中沒有可見模型': 'There is no visible model in the scene',
  '場景中沒有可截屏的模型': 'There is no model to capture',
  '無法生成 PNG': 'Could not generate PNG', '無法在目前視覺平面建立節點': 'Could not create a node on the current view plane',
  '無法讀取這張圖片': 'Could not read this image', '無法讀取模型渲染結果': 'Could not read the model render',
  '畫筆繪製': 'Brush stroke', '程序化 Shape 請先轉換為 Cube 才能編輯逐面 UV': 'Convert the procedural shape to cubes before editing per-face UVs',
  '等待首次繪製時建立': 'Create on first paint stroke', '貼上 Ctrl+V': 'Paste Ctrl+V',
  '貼上元素': 'Paste elements', '貼圖載入失敗': 'Texture load failed',
  '貼圖轉換失敗': 'Texture conversion failed', '進入細分編輯': 'Enter Subdivision Edit',
  '項目已保存': 'Project saved', '順時針旋轉 90°': 'Rotate clockwise 90°',
  '僅桌面版可更改工作目錄': 'The workspace location can only be changed in the desktop app',
  '新增': 'Add', '新增曲線節點': 'Add curve node', '暖岩': 'Warm Rock',
  '圖層名稱': 'Layer name', '實際內半徑': 'Actual inner radius', '對稱手柄': 'Symmetric handles',
  '漸變兩點距離太短': 'The gradient points are too close together',
  '漸變填充': 'Gradient fill', '漸變範圍無效，或對應面沒有貼圖': 'Invalid gradient range or no texture on the target face',
  '精確旋轉': 'Precise rotation', '聚焦此物件': 'Focus this object',
  '模型截圖已保存': 'Model capture saved', '模型截圖已複製到剪切板': 'Model capture copied to clipboard',
  '模組 ID 與包清單不一致': 'Module ID does not match the package manifest',
  '模組版實體的 Cube 不能旋轉；請把它放入組後旋轉組': 'Cubes in modded entities cannot rotate; put the cube in a group and rotate the group',
  '箱型 UV 只能整體移動，不能逐面重新指定': 'Box UVs can only move as a whole, not be reassigned per face',
  '箱型 UV 的六面相對位置固定，不能單獨修改面座標': 'The six box-UV faces have fixed relative positions and cannot be edited individually',
  '箱型 UV 的各面位置固定；可在預覽中整體移動': 'Box-UV face positions are fixed; move them together in the preview',
  '箱型 UV 的面不能單獨鏡像': 'A box-UV face cannot be mirrored individually',
  '編輯 Shape 細分': 'Edit shape subdivisions', '編輯貼圖組': 'Edit texture group',
  '編輯貼圖圖層': 'Edit texture layer', '複製 Ctrl+C': 'Copy Ctrl+C',
  '複製元素': 'Copy elements', '複製元素 Ctrl+D': 'Duplicate elements Ctrl+D',
  '複製元素到剪貼簿': 'Copy elements to clipboard', '調整貼圖順序': 'Reorder textures',
  '調整順序': 'Reorder', '請先在 UV 預覽中選擇 Cube 的面': 'Select a cube face in UV preview first',
  '請先建立或導入貼圖': 'Create or import a texture first',
  '請在一個 UV 面內選擇漸變點': 'Choose a gradient point inside a UV face',
  '請指向一個元素的貼圖面': 'Point to a textured element face',
  '請指向一個貼圖面': 'Point to a textured face', '操作器': 'Operator',
  '橢圓繪製': 'Draw ellipse', '選擇同一 Cube 上的終點': 'Choose an endpoint on the same cube',
  '選擇來源物件': 'Choose source object', '選擇面漸變終點': 'Choose the face-gradient endpoint',
  '選擇圖層': 'Choose layer', '選擇顏色': 'Choose color',
  '縮放 UV': 'Scale UV', '縮放元素': 'Scale element', '縮放參考圖': 'Scale reference image',
  '面': 'Face', '面選擇': 'Face selection', '動畫模式': 'Animation mode',
  '简体中文': 'Simplified Chinese', '繁體中文': 'Traditional Chinese',
  '解鎖選中項': 'Unlock selection', '鎖定選中項': 'Lock selection',
  '導入項目': 'Import project', '編輯模式': 'Edit mode', '繪畫模式': 'Paint mode',
  '瀏覽器預覽不使用展開式工作目錄': 'Browser preview does not use expanded working directories',
  '離屏渲染': 'Offscreen render', '繪畫貼圖': 'Paint texture', '繪畫對稱': 'Paint symmetry',
  '鏡像 UV': 'Mirror UV', '關閉': 'Close', '顯示色': 'Display color',
  '顯示圖層': 'Show layer', '體漸變的第二點必須在同一個 Cube': 'The second volume-gradient point must be on the same cube',
  '體漸變需要在三維視圖的同一個 Cube 上選取兩點': 'Choose two points on the same cube in the 3D view for a volume gradient',
  'Cube 尺寸': 'Cube size', 'Cube 不能旋轉；請旋轉其所屬的組': 'Cubes cannot rotate; rotate their parent group',
  'PNG 圖片': 'PNG image', 'Shape 包掃描失敗': 'Could not scan shape packs',
  'Shape 包載入失敗': 'Could not load shape pack', 'Shape 定義需要 id、label 和 generate': 'Shape definitions require id, label, and generate',
  'Shape 細分 Cube': 'Shape subdivision cube', 'UV 編輯': 'UV edit',
  '未保存': 'Unsaved', '主選單': 'Main menu', '新建': 'New', '打開': 'Open', '保存': 'Save', '撤銷': 'Undo', '重做': 'Redo', 'CubeBricks 設定': 'CubeBricks Settings',
  '編輯': 'Edit', 'UV 編輯模式': 'UV Edit mode', '繪畫': 'Paint', '動畫': 'Animate', '設定': 'Settings', '導出': 'Export',
  '工具欄': 'Toolbar', '工具': 'Tools', '目前工具參數': 'Current tool options', '工具參數': 'Tool options',
  '移動': 'Move', '縮放': 'Scale', '旋轉': 'Rotate', '新增方塊': 'Add cube', '新增形狀': 'Add shape', '新增 Locator': 'Add locator', '畫筆': 'Brush', '橡皮擦': 'Eraser', '直線': 'Line', '矩形': 'Rectangle', '橢圓': 'Ellipse', '油漆桶': 'Fill', '漸變': 'Gradient', '取色器': 'Eyedropper',
  '畫筆（B）': 'Brush (B)', '橡皮擦（E）': 'Eraser (E)', '直線（L）': 'Line (L)', '矩形（M）': 'Rectangle (M)', '橢圓（O）': 'Ellipse (O)', '油漆桶（G）': 'Fill (G)', '漸變（J）': 'Gradient (J)', '取色器（I）': 'Eyedropper (I)',
  '繪畫顏色': 'Paint color', '筆刷尺寸': 'Brush size', '筆刷透明度': 'Brush opacity', '筆刷形狀': 'Brush shape', '圓形筆刷邊緣抗鋸齒': 'Antialiased round-brush edge',
  '擦除': 'Erase', '目前工具以設定透明度擦除像素': 'Erase pixels using this tool’s opacity', '目前工具的尺寸': 'Current tool size', '目前工具的透明度': 'Current tool opacity',
  '忽視全透明': 'Ignore transparent', '繪畫時略過原本完全透明的像素': 'Skip pixels that were fully transparent before the stroke',
  '筆跡碰到 Cube 邊緣時，向相鄰面的貼圖延伸指定像素': 'Extend the stroke into adjacent face textures when it reaches a cube edge',
  '油漆桶填充範圍': 'Fill scope', '範圍': 'Scope', '元素': 'Element', '連續顏色': 'Contiguous color', '顏色': 'Color', '尺寸': 'Size', '透明度': 'Opacity',
  '形狀': 'Shape', '方形': 'Square', '圓形': 'Circle', '三角形': 'Triangle', '深度': 'Depth', 'AA 邊緣': 'AA edge', '單面局限': 'Limit to face',
  '疊加繪製': 'Coincident painting', '只在最前方命中位置，同時繪製完全重合的共面表面': 'Paint all exactly coincident frontmost faces without painting through the model',
  '面漸變': 'Face gradient', '體漸變': 'Volume gradient', '模式': 'Mode', '使用色卡': 'Use palette', '第一色': 'First color', '第二色': 'Second color', '第一色 α': 'First alpha', '第二色 α': 'Second alpha',
  '面漸變限制在同一個面；體漸變可跨同一 Cube 的多個面': 'Limit a face gradient to one face, or span a volume gradient across one cube',
  '使用目前選中的色卡覆蓋整個漸變範圍': 'Use the selected palette across the full gradient range',
  '選中第一色並在右側選色器調整': 'Select the first color and edit it in the right-side picker', '選中第二色並在右側選色器調整': 'Select the second color and edit it in the right-side picker',
  '漸變第一色透明度': 'Gradient first-color opacity', '漸變第二色透明度；預設完全透明': 'Gradient second-color opacity; transparent by default',
  '同色填充只在目前面的 UV 範圍內搜尋': 'Limit same-color fill to the current face UV area',
  '新增節點': 'Add node', '新增二維貝塞爾': 'Add 2D Bezier', '新增三維貝塞爾': 'Add 3D Bezier',
  '移動樞軸': 'Move pivot', '頂點捕捉': 'Vertex snap', '刀具切割': 'Knife', '切割軸': 'Cut axis',
  '沿 X 軸切割': 'Cut along X', '沿 Y 軸切割': 'Cut along Y', '沿 Z 軸切割': 'Cut along Z',
  '先選來源頂點': 'Select source vertex', '再選目標頂點': 'Select target vertex',
  '頂點捕捉模式': 'Vertex snap mode', '移動捕捉': 'Move snap', '縮放捕捉': 'Scale snap', '旋轉捕捉': 'Rotate snap',
  '頂點旋轉模式': 'Vertex rotation mode', '繞 X 軸': 'Around X', '繞 Y 軸': 'Around Y', '繞 Z 軸': 'Around Z',
  '沿最長軸': 'Longest axis', '最長軸': 'Longest', '繞樞軸點自由對齊': 'Free alignment around pivot', '樞軸點': 'Pivot',
  '選中項樞軸點': 'Selected item pivot', '已取消來源頂點': 'Source vertex cleared',
  '縮放捕捉目前只適用於 Cube': 'Scale snap currently supports cubes only', '這個物件不能旋轉捕捉': 'This object cannot use rotation snap',
  '所選頂點無法建立旋轉方向': 'The selected vertices cannot define a rotation',
  '繪畫模式可直接在 Shape 上繪畫，不使用細分編輯': 'Paint directly on shapes in Paint mode; Subdivision Edit is disabled',
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
  '多選變換方式': 'Multi-selection transform mode', '分別執行': 'Separate', '統一執行': 'Unified',
  '各物件依照自己的參考軸分別執行': 'Transform each object independently using its own reference axes',
  '全部物件依照最深共同組統一執行': 'Transform all objects together using their deepest common group',
  '已選元素／全部元素': 'Selected elements / total elements',
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
  '貼圖': 'Textures', '新建貼圖': 'New Texture', '導入貼圖': 'Import texture', '新增貼圖組': 'Add texture group', '貼圖組': 'Texture group', '折疊或展開面板': 'Collapse or expand panel', '折疊／展開': 'Collapse / expand',
  '獨立 UV 編輯模式': 'Separate UV editing mode', '模型製作與 UV 調整使用不同模式': 'Use separate modes for modelling and UV editing',
  '類型': 'Type', '名稱': 'Name', '紋理模板': 'Texture template', '純色模板': 'Solid template', '空白貼圖': 'Blank texture',
  '寬度': 'Width', '高度': 'Height', '填充顏色': 'Fill color', '啟用箱型 UV': 'Use box UV', '使用 2 冪尺寸': 'Use power-of-two size',
  '清理無效面': 'Clean invalid faces', '將任一邊長為 0 的面設為剔除': 'Cull faces whose width or height is zero', '非零邊長至少分配 1px': 'Non-zero edges receive at least 1 px',
  '保持多紋理佔用': 'Preserve multi-texture occupancy', '填充間隔': 'Padding', '間隔像素': 'Padding pixels', '尺寸倍數': 'Size multiple',
  '僅分配選中元素': 'Selected elements only', '只重排目前選取範圍的 UV': 'Repack UVs only for the current selection',
  '正在建立貼圖': 'Generating texture', '正在準備 UV…': 'Preparing UVs…', '進度按照需要處理的面數計算': 'Progress is based on the number of faces to process',
  '正在讀取已有紋理…': 'Reading existing textures…', '正在由大到小排列 UV…': 'Packing UVs from largest to smallest…', '正在繪製並分配 UV…': 'Drawing and assigning UVs…',
  '目前沒有可建立模板的面': 'There are no faces available for a texture template',
  'UV 歸一化': 'Normalize UV', '保留原 UV 像素': 'Preserve original UV pixels', '細分編輯期間不能使用刀具': 'The Knife is unavailable during Subdivision Edit',
  'UV 預覽': 'UV Preview', '選中部分 UV 預覽': 'Selected-part UV preview', '啟用預覽': 'Enable preview', '自動旋轉': 'Auto rotate', '面區分': 'Face colors',
  '剔除／恢復面': 'Cull / restore face', '剔除面': 'Cull face', '恢復面': 'Restore face', '已剔除': 'Culled',
  '請把貼圖拖到 Cube 面上': 'Drop the texture onto a cube face',
  '全部面已剔除，Cube 已刪除': 'All faces were culled; the cube was deleted',
  '完全開啟或關閉預覽渲染': 'Completely enable or disable preview rendering', '僅在此預覽中讓模型慢速轉動': 'Slowly rotate the model in this preview only',
  '用不同顏色區分六個面': 'Color each of the six faces differently', '選擇 Cube 或 Shape': 'Select a Cube or Shape', '選擇 Cube、Shape 或貝塞爾': 'Select a Cube, Shape, or Bezier element', '預覽已關閉': 'Preview disabled',
  '視圖模式': 'View mode', '透視': 'Perspective', '正交': 'Orthographic', '實體著色': 'Entity shading', '貼圖預覽': 'Texture preview', '三維繪畫': '3D painting', '動畫預覽': 'Animation preview',
  '聚焦': 'Focus', '網格': 'Grid', '邊界線框': 'Bounds wireframe', '實心': 'Solid', '實心 Mipped': 'Solid Mipped',
  '半透明': 'Translucent', '半透明 Mipped': 'Translucent Mipped', '背面剔除': 'Back-face culling', '剔除': 'Cull',
  '變換手柄': 'Transform gizmo', 'Locator 標記': 'Locator marker', '目前：線框': 'Current: Wireframe', '目前：體塊': 'Current: Solid', '目前：紋理': 'Current: Textured',
  '目前渲染模式：線框': 'Current render mode: Wireframe', '目前渲染模式：體塊': 'Current render mode: Solid', '目前渲染模式：紋理': 'Current render mode: Textured',
  '線框': 'Wireframe', '體塊': 'Solid', '紋理': 'Textured', '法向': 'Normals', '目前：法向': 'Current: Normals', '目前渲染模式：法向': 'Current render mode: Normals', '座標軸': 'Axes', '頂視圖': 'Top view', '右視圖': 'Right view', '正視圖': 'Front view',
  '中鍵': 'Middle mouse', 'Shift + 中鍵': 'Shift + Middle mouse', '平移': 'Pan', '滾輪': 'Wheel', '中心': 'Origin',
  '參考圖': 'Reference image', '一般視圖參考圖': 'General-view reference', 'X 軸視圖參考圖': 'X-axis reference',
  'Y 軸視圖參考圖': 'Y-axis reference', 'Z 軸視圖參考圖': 'Z-axis reference', '尚未導入': 'Not imported',
  '＋ 導入參考圖': '+ Import reference images', '調整位置與尺寸': 'Adjust position and size', '結束調整': 'Finish adjusting',
  '重置位置與尺寸': 'Reset position and size', '移除選中參考圖': 'Remove selected reference', '拖動平移 · 滾輪縮放': 'Drag to move · Wheel to scale',
  '這個視圖還沒有參考圖': 'This view has no reference images', '無法讀取這些參考圖': 'Could not read these reference images',
  '三軸視圖固定使用正交投影': 'Axis views always use orthographic projection', '拖動輪盤': 'Drag axis widget', '一般視圖': 'General view',
  '玩家參考': 'Player reference', '顯示玩家尺寸與姿態參考；只用於預覽，不會寫入模型工程或導出檔。': 'Show a player scale and pose reference. This is preview-only and is never saved in model projects or exports.',
  '玩家參考紋理': 'Player reference texture', '內置玩家紋理': 'Built-in player texture', '導入玩家紋理': 'Import player texture',
  '恢復內置紋理': 'Restore built-in texture', '建議使用 64×64 或等比例高清 Minecraft 皮膚。': 'Use a 64×64 Minecraft skin or a proportional high-resolution version.',
  '自定義玩家紋理': 'Custom player texture', '已恢復內置玩家紋理': 'Restored the built-in player texture',
  '無法讀取內置玩家紋理': 'Could not load the built-in player texture', '無法讀取自定義玩家紋理，已回退內置紋理': 'Could not load the custom player texture; restored the built-in texture',
  '無法讀取這張玩家紋理': 'Could not read this player texture', '這個檔案不是可用的 PNG 玩家紋理': 'This file is not a usable PNG player texture',
  '玩家紋理必須是至少 64×64 的正方形圖片': 'Player textures must be square images of at least 64×64 pixels',
  '色卡': 'Palette', '時間軸': 'Timeline', '輸出': 'Output', '模型色卡': 'Model palette', '新增一行': 'Add row', '項目已就緒。': 'Project ready.',
  '物件屬性': 'Object properties', '選色器': 'Color picker', '場景層級': 'Scene hierarchy', '新增組': 'Add group', '搜尋物件或 UID': 'Search objects or UID',
  '基礎': 'Basic', '修改器': 'Modifiers', '新增修改器': 'Add modifier', '這個物件目前沒有修改器。': 'This object has no modifiers.',
  '烘焙': 'Bake', '只烘焙這個修改器': 'Bake only this modifier', '已烘焙選中的修改器': 'Selected modifier baked', '這個修改器目前無法烘焙': 'This modifier cannot currently be baked',
  '展開或折疊': 'Expand or collapse', '啟用修改器': 'Enable modifier', '內嵌軸點': 'Embedded axis', '不進入場景層級': 'Not added to the scene hierarchy',
  '在主視圖編輯': 'Edit in viewport', '結束軸點編輯': 'Finish axis editing',
  '不進入場景層級；可在主視圖點擊標記後移動或旋轉。': 'Not added to the scene hierarchy; click the marker in the viewport to move or rotate it.',
  '對稱軸點': 'Symmetry axis',
  '基本': 'Basic', '立方體': 'Cube', '程序化形狀': 'Procedural shape', '組': 'Group', '名稱': 'Name', '可見': 'Visible',
  '幾何': 'Geometry', '重置': 'Reset', '位置': 'Position', '尺寸': 'Size', '樞軸': 'Pivot', '膨脹': 'Inflate',
  'UV 模式': 'UV mode', '箱型 UV': 'Box UV', '逐面 UV': 'Per-face UV', '形狀參數': 'Shape parameters',
  '半徑': 'Radius', '高度': 'Height', '邊數': 'Sides', '生成 Cube': 'Generated cubes', 'Locator 變換': 'Locator transform',
  '正十二面體': 'Regular dodecahedron', '足球（截角二十面體）': 'Football (truncated icosahedron)', '單邊邊長': 'Single-edge length',
  '尺寸擬合': 'Dimension snapping', '擬合單邊邊長': 'Snap single-edge length', '擬合多邊形邊長': 'Snap polygon edge length', '擬合整體半徑': 'Snap overall radius',
  'Cube 邊長': 'Cube edge', '柱體吸附': 'Prism snapping', '按內含 Cube 邊長': 'Contained-cube edge', '按整體邊長': 'Overall edge',
  '節點': 'Node', '只可移動／旋轉': 'Move / rotate only', '自動切線': 'Automatic tangent', '滾動角': 'Roll angle', '貝塞爾手柄': 'Bezier handles', '前手柄': 'Incoming handle', '後手柄': 'Outgoing handle',
  '二維貝塞爾': '2D Bezier', '三維貝塞爾': '3D Bezier', 'Cube 柱粗細': 'Cube column thickness', '分段方式': 'Segmentation',
  '按距離': 'By distance', '按角度': 'By angle', '角度步長': 'Angle step', '距離步長': 'Distance step', '刪除節點': 'Delete node',
  '組變換': 'Group transform', '組屬性': 'Group properties', '直接子項': 'Direct children', '外觀': 'Appearance', '預覽色': 'Preview color', '材質色': 'Material color',
  '組鏡像': 'Group mirroring', '啟用組鏡像': 'Enable group mirroring', '鏡像模式': 'Mirror mode', 'XYZ 鏡像': 'XYZ mirrors',
  '徑向旋轉': 'Radial rotation', '曼陀羅': 'Mandala', '啟用軸': 'Enabled axes', '複製數量': 'Copy count', '對稱軸數量': 'Symmetry axis count',
  '角度分布': 'Angle distribution', '360° 均分': 'Evenly around 360°', '限制範圍': 'Limited range', '起始角': 'Start angle', '結束角': 'End angle',
  '導出時建立父組': 'Create parent group on export', '控制軸點': 'Controller node', '未建立': 'Not created', '鏡像軸點': 'Mirror controller', '組鏡像軸點': 'Group mirror controller',
  '刪除物件': 'Delete object', '刪除組及其內容': 'Delete group and contents', '選擇一個 Cube、Shape 或組來編輯。': 'Select a cube, shape, or group to edit.',
  '選擇一個 Cube、Shape、Locator 或組來編輯。': 'Select a cube, shape, locator, or group to edit.', '選擇一個 Cube、Shape、節點、貝塞爾、Locator 或組來編輯。': 'Select a cube, shape, node, Bezier element, locator, or group to edit.', '已新增 Locator': 'Locator added',
  '一般': 'General', '視圖': 'View', '所有選項即時生效，並通過配置註冊表保存在這台電腦上。': 'All options apply immediately and are saved on this computer through the configuration registry.',
  '工作空間目錄': 'Workspace folder',
  'projects/ 保存新項目的展開記錄；shapepacks/ 放外部 Shape 包（僅安裝可信的 JS 包）': 'projects/ stores working journals; shapepacks/ holds external shapes (install trusted JS packs only).',
  '設定分類': 'Settings categories', '介面、視口與編輯行為': 'Interface, viewport, and editing behavior', '介面語言': 'Interface language',
  '視口顯示與鎖定物體虛化': 'Viewport display and locked-object fading', '鎖定物體默認虛化 Alpha': 'Default locked-object alpha',
  '開啟鼠標虛化': 'Enable pointer hover fading', '鼠標虛化 Alpha': 'Pointer hover alpha', '鼠標虛化半徑': 'Pointer fade radius',
  '顯示詳細資訊': 'Show detailed information', '詳': 'Details', '自動 UV': 'Auto UV', '不自動更新 UV': 'Do not update UV automatically',
  '參與後續格式轉換': 'Include in future format conversion', '不參與後續格式轉換': 'Exclude from future format conversion',
  '鎖定': 'Locked', '解鎖': 'Unlocked',
  '視口投影': 'Viewport projection', '顯示網格': 'Show grid', '線框邊界': 'Wireframe bounds', '僅顯示幾何': 'Show geometry only',
  '面陰影預覽': 'Shading preview', '對稱編輯': 'Symmetry editing', '鎖定透明度': 'Lock alpha',
  '吸附步長為 16 ÷ 精度；16 = 1px，32 = 0.5px': 'Snap step is 16 ÷ precision; 16 = 1px, 32 = 0.5px',
  '允許負尺寸': 'Allow negative size', '關閉時 Cube 最小尺寸為 0': 'When disabled, the minimum cube size is 0', '吸附精度': 'Snap precision',
  '直接數值': 'Absolute value', '數值': 'Value', '乘數': 'Multiplier', '默認乘數': 'Default multiplier', '默認 4': 'Default 4', '默認 8': 'Default 8', '默認 64': 'Default 64',
  '顏色、圓角與介面縮放': 'Colors, corner radius, and UI scale', '強調色': 'Accent', '背景色': 'Background', '面板色': 'Panel',
  '視窗色': 'Viewport', '選中邊框': 'Selection outline', '圓角': 'Corner radius', '介面縮放': 'UI scale',
  '苔原': 'Moss', '琥珀': 'Amber', '熔岩': 'Ember', '深海': 'Slate', '恢復預設': 'Restore defaults', '完成': 'Done', '外觀已套用': 'Appearance applied',
  '聚焦選中物件': 'Focus selected object', '回到場景中心': 'Return to scene origin', '隱藏網格': 'Hide grid', '顯示網格': 'Show grid',
  '隱藏邊界線框': 'Hide bounds wireframe', '顯示邊界線框': 'Show bounds wireframe', '設為目前貼圖': 'Set as current texture',
  '在繪畫模式打開': 'Open in Paint mode', '導入新貼圖': 'Import new texture', '新增色卡行': 'Add palette row',
  '請先建立或導入一張貼圖': 'Create or import a texture first', '鎖定透明度時橡皮擦不會改變貼圖': 'The eraser cannot change the texture while alpha lock is enabled',
  '這個面沒有可用的貼圖': 'This face has no usable texture', '請指向一個 Cube 面': 'Point at a cube face',
  '改用離散色卡': 'Use discrete palette', '啟用連續漸變': 'Enable continuous gradient', '隱藏': 'Hide', '顯示': 'Show',
  '漸變': 'Gradient', '色空': 'Color space', '色彩空間漸變': 'Color-space gradient',
  '此行使用連續漸變': 'Use a continuous gradient for this row',
  '在三維色彩空間沿貝塞爾曲線取色；關閉後保留曲線設定': 'Sample a Bezier path in 3D color space; disabling preserves the curve',
  '曲線 ↗': 'Curve ↗', '編輯三維色彩曲線': 'Edit 3D color curve',
  '啟用色彩空間漸變': 'Enable color-space gradient', '關閉色彩空間漸變': 'Disable color-space gradient',
  '編輯色彩曲線': 'Edit color curve', '色彩空間': 'Color space',
  'HSV 正方體': 'HSV cube', 'RGB 正方體': 'RGB cube', 'HSV 圓柱': 'HSV cylinder',
  '手柄': 'Gizmo', '三軸': 'All axes', 'X · 色相／紅／飽和': 'X · Hue / red / saturation',
  'Y · 飽和／綠／亮度': 'Y · Saturation / green / value', 'Z · 亮度／藍／色相': 'Z · Value / blue / hue',
  '＋ 節點': '+ Node', '選中節點顏色': 'Selected node color', '曲線節點 · 拖動卡片以調整順序': 'Curve nodes · drag cards to reorder',
  '手柄對稱': 'Symmetric handles', '曲線至少需要兩個節點': 'A curve needs at least two nodes',
  '三維色彩空間曲線；左鍵選擇和拖動節點、手柄，中鍵旋轉視角，滾輪縮放': '3D color-space curve; left-click to select and drag nodes or handles, middle-drag to orbit, wheel to zoom',
  '展開組': 'Expand group', '折疊組': 'Collapse group', '刪除': 'Delete', '刪除選中項': 'Delete selection',
  '隱藏選中項': 'Hide selection', '顯示選中項': 'Show selection', '將選中項建立為組': 'Group selection',
  '移到新貼圖組': 'Move to new texture group', '解散貼圖組': 'Ungroup textures', '刪除貼圖': 'Delete texture',
  '已新增貼圖組': 'Texture group added', '不能把組拖進它自己的子級': 'A group cannot be moved into its own descendant',
  '角度': 'Angle', '距離': 'Distance',
  '新建項目': 'New Project', '選擇模型格式；格式會提供工程初始資料、能力與標準吸附參數。': 'Choose a model format. Formats provide initial project data, capabilities, and standard snapping.',
  '項目分頁': 'Project tabs', '關閉項目': 'Close project', '項目信息': 'Project Information',
  '這些設定屬於目前分頁中的工程，會跟隨工程保存。': 'These settings belong to the project in this tab and are saved with it.',
  '項目名稱': 'Project name', '模型格式': 'Model format', '貼圖寬度': 'Texture width', '貼圖高度': 'Texture height',
  '標準吸附精度': 'Standard snap precision', '16 ÷ 精度 = 像素步長': '16 ÷ precision = pixel step', '項目描述': 'Project description',
  '取消': 'Cancel', '套用': 'Apply', '項目信息已更新': 'Project information updated',
  '通用': 'General', '通用模型': 'Generic Model', '圖像': 'Image', '自由建模與多面體編輯': 'Free modelling and polygon editing',
  '建立或編輯二維圖像': 'Create or edit a 2D image', '多面體編輯尚未實現': 'Polygon editing is not implemented yet', '圖像編輯尚未實現': 'Image editing is not implemented yet',
  'Java 版方塊/物品': 'Java Block/Item', 'Minecraft Java 方塊與物品模型': 'Minecraft Java block and item model',
  'Bedrock 版實體': 'Bedrock Entity', 'Minecraft Bedrock 實體幾何': 'Minecraft Bedrock entity geometry',
  'Bedrock 版方塊': 'Bedrock Block', 'Minecraft Bedrock 方塊幾何': 'Minecraft Bedrock block geometry',
  '模組版實體': 'Modded Entity', 'Minecraft Java 模組實體模型': 'Minecraft Java modded entity model',
  'Minecraft 皮膚': 'Minecraft Skin', 'Minecraft 玩家皮膚模型': 'Minecraft player skin model',
  'GeckoLib 動畫實體模型': 'GeckoLib animated entity model', '佔位': 'Placeholder', '未知模型格式': 'Unknown model format'
});

const SIMPLIFIED_PHRASES = Object.freeze({
  '物件': '对象', '貼圖': '贴图', '默認': '默认', '坐標': '坐标', '全局': '全局', '程序化': '程序化',
  '色階': '色阶', '搜尋': '搜索', '介面': '界面', '設定': '设置', '註冊表': '注册表',
  '目前': '当前', '著色': '着色', '視窗色': '视口色'
});

const SIMPLIFIED_CHARS = Object.freeze({
  '體':'体','開':'开','關':'关','閉':'闭','陰':'阴','顯':'显','圖':'图','層':'层','編':'编','輯':'辑','繪':'绘','畫':'画','製':'制','鄰':'邻','動':'动','導':'导','檔':'档','儲':'储','復':'复','設':'设','覽':'览','縮':'缩','態':'态','級':'级','軸':'轴','長':'长','圍':'围','線':'线','僅':'仅','鎖':'锁','稱':'称','變':'变','換':'换','擇':'择','組':'组','場':'场','間':'间','輸':'输','項':'项','參':'参','數':'数','塊':'块','刪':'删','除':'除','見':'见','幾':'几','樞':'枢','脹':'胀','狀':'状','徑':'径','邊':'边','質':'质','預':'预','選':'选','語':'语','網':'网','負':'负','許':'许','顔':'颜','顏':'颜','圓':'圆','強':'强','調':'调','熔':'熔','還':'还','應':'应','過':'过','這':'这','臺':'台','電':'电','腦':'脑','獨':'独','當':'当','與':'与','後':'后','會':'会','啟':'启','連':'连','續':'续','離':'离','內':'内','實':'实','視':'视','點':'点','擊':'击','進':'进','階':'阶','構':'构','則':'则','個':'个','處':'处','從':'从','標':'标','記':'记','題':'题','樣':'样','細':'细','節':'节','類':'类','別':'别','載':'载','務':'务','優':'优','勢':'势','據':'据','墊':'垫','疊':'叠','寬':'宽','釋':'释','權':'权','傳':'传','統':'统','築':'筑','擁':'拥','護':'护','隱':'隐','響':'响','極':'极','遠':'远','習':'习','萬':'万','屬':'属','為':'为','時':'时','種':'种','並':'并','註':'注','冊':'册','觀':'观','對':'对','滾':'滚','輪':'轮','鍵':'键','頂':'顶','單':'单','銷':'销','欄':'栏','轉':'转','筆':'笔','蓋':'盖','暫':'暂','輔':'辅','側':'侧','區':'区','紋':'纹','帶':'带','巢':'巢','匯':'汇','總':'总',
  '來':'来','歐':'欧','貼':'贴','範':'范','覺':'觉','緒':'绪','沒':'没','漸':'渐','無':'无','讀':'读','張':'张','敗':'败','認':'认','義':'义','請':'请','須':'须','於':'于','繞':'绕','齊':'齐','適':'适','豎':'竖','橫':'横','執':'执','讓':'让','跡':'迹','緣':'缘','橢':'椭',
  '詳':'详','資':'资','訊':'讯','虛':'虚','準':'准','維':'维','佔':'占','膚':'肤','頁':'页','隨':'随','貝':'贝','爾':'尔',
  '歸':'归','純':'纯','冪':'幂','將':'将','恢':'恢','礎':'础','鏡':'镜','羅':'罗','東':'东','順':'顺','針':'针','結':'结','盤':'盘','寫':'写','計':'计'
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
  match = text.match(/^色彩空間漸變 · (.+)$/);
  if (match) return `Color-space gradient · ${match[1]}`;
  match = text.match(/^多選 (\d+)$/);
  if (match) return `${match[1]} selected`;
  match = text.match(/^節點 (\d+)$/);
  if (match) return `Node ${match[1]}`;
  match = text.match(/^(\d+) 節點$/);
  if (match) return `${match[1]} nodes`;
  match = text.match(/^吸附 (.+) · (.+)px$/);
  if (match) return `Snap ${match[1]} · ${match[2]}px`;
  match = text.match(/^目前按項目基礎吸附 (.+) 計算：UV 像素 = round\(Cube 尺寸 × (.+) ÷ 16\)，(?:非零邊長最少 1px，)?再由大到小自左上角打包。$/);
  if (match) return `Using project base snap ${match[1]}: UV pixels = round(Cube size × ${match[2]} ÷ 16), with at least 1 px for every non-zero edge, then packed largest-first from the top-left.`;
  match = text.match(/^正在準備 (\d+) 個面…$/);
  if (match) return `Preparing ${match[1]} faces…`;
  match = text.match(/^已(剔除|恢復) (\d+) 個面$/);
  if (match) return `${match[1] === '剔除' ? 'Culled' : 'Restored'} ${match[2]} faces`;
  match = text.match(/^全部面已剔除，已刪除 (\d+) 個 Cube$/);
  if (match) return `All faces were culled; deleted ${match[1]} cubes`;
  match = text.match(/^已將貼圖套用到 (\d+) 個 Cube 的(.+)$/);
  if (match) return `Applied the texture to ${match[1]} cubes' ${match[2]}`;
  match = text.match(/^已將貼圖套用到(.+)$/);
  if (match) return `Applied the texture to the ${match[1]}`;
  match = text.match(/^標準吸附 (.+) · (.+)px$/);
  if (match) return `Standard snap ${match[1]} · ${match[2]}px`;
  match = text.match(/^關閉 (.+)$/);
  if (match) return `Close ${match[1]}`;
  match = text.match(/^介面語言：(.*)$/);
  if (match) return `Interface language: ${match[1]}`;
  match = text.match(/^玩家參考紋理：(.*)$/);
  if (match) return `Player reference texture: ${match[1]}`;
  match = text.match(/^已導入(一般視圖|[XYZ] 軸視圖)參考圖 · (\d+) 張$/);
  if (match) return `Imported ${match[2]} reference images for ${match[1] === '一般視圖' ? 'the general view' : `the ${match[1][0]}-axis view`}`;
  match = text.match(/^已導入 (\d+) 張參考圖，部分檔案無法讀取$/);
  if (match) return `Imported ${match[1]} reference images; some files could not be read`;
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
  match = text.match(/^(.+?)失敗：(.+)$/);
  if (match) return `${ENGLISH_UI[match[1]] || match[1]} failed: ${translateUiText(match[2], language)}`;
  match = text.match(/^已(建立|新增|打開|導入|導出|複製|剪切|刪除|恢復|剔除|選|套用|烘焙)\s*(.+)$/);
  if (match) {
    const verbs = { 建立: 'Created', 新增: 'Added', 打開: 'Opened', 導入: 'Imported', 導出: 'Exported',
      複製: 'Copied', 剪切: 'Cut', 刪除: 'Deleted', 恢復: 'Restored', 剔除: 'Culled',
      選: 'Selected', 套用: 'Applied', 烘焙: 'Baked' };
    return `${verbs[match[1]]} ${translateUiText(match[2], language)}`;
  }
  match = text.match(/^(目前渲染模式|目前|預覽)：(.+)$/);
  if (match) return `${{ 目前渲染模式: 'Current render mode', 目前: 'Current', 預覽: 'Preview' }[match[1]]}: ${translateUiText(match[2], language)}`;
  match = text.match(/^(節點|圖層|貼圖組|漸變節點)\s*(\d+)$/);
  if (match) return `${ENGLISH_UI[match[1]] || { 節點: 'Node', 圖層: 'Layer', 貼圖組: 'Texture group', 漸變節點: 'Gradient node' }[match[1]]} ${match[2]}`;
  match = text.match(/^(角度|距離|尺寸|滾動角|半徑|高度)\s+(.+)$/);
  if (match) return `${ENGLISH_UI[match[1]] || match[1]} ${match[2]}`;
  match = text.match(/^正在(建立|準備|截取|離屏渲染)(.+)$/);
  if (match) return `${{ 建立: 'Creating', 準備: 'Preparing', 截取: 'Capturing', 離屏渲染: 'Rendering offscreen' }[match[1]]}${match[2]}`;
  match = text.match(/^「(.+)」尚未保存，仍要關閉嗎？$/);
  if (match) return `“${match[1]}” has not been saved. Close it anyway?`;
  match = text.match(/^找到 (\d+) 個未保存的工作項目。要全部恢復到分頁嗎？$/);
  if (match) return `Found ${match[1]} unsaved working projects. Restore all as tabs?`;
  match = text.match(/^找到未保存的工作項目「(.+)」。要恢復嗎？$/);
  if (match) return `Restore the unsaved working project “${match[1]}”?`;
  match = text.match(/^(\d+) 個 Shape 包項目未載入，詳見主控台$/);
  if (match) return `${match[1]} Shape pack items failed to load; see the console`;
  match = text.match(/^已清理 (\d+) 個無效面；沒有可建立模板的面$/);
  if (match) return `Cleaned ${match[1]} invalid faces; no faces remain for the template`;
  match = text.match(/^模板尺寸 (.+) 過大，請降低吸附分辨率或間隔$/);
  if (match) return `Template size ${match[1]} is too large; lower the snap resolution or spacing`;
  match = text.match(/^(.+) · (北|南|東|西|上|下)( · 已剔除)?$/);
  if (match) return `${match[1]} · ${{ 北: 'North', 南: 'South', 東: 'East', 西: 'West', 上: 'Up', 下: 'Down' }[match[2]]}${match[3] ? ' · Culled' : ''}`;
  match = text.match(/^(平面等距|等比尺寸|等比縮放|縮放) (.+)$/);
  if (match) return `${{ 平面等距: 'Uniform plane scale', 等比尺寸: 'Proportional size', 等比縮放: 'Uniform scale', 縮放: 'Scale' }[match[1]]} ${match[2]}`;
  match = text.match(/^(前手柄|後手柄|對稱軸點) (.+)$/);
  if (match) return `${ENGLISH_UI[match[1]]} ${match[2]}`;
  match = text.match(/^(\d+) 行 · 縮略選色$/);
  if (match) return `${match[1]} rows · compact palette`;
  match = text.match(/^(.+) · 節點 (\d+)$/);
  if (match) return `${match[1]} · Node ${match[2]}`;
  match = text.match(/^(離屏渲染 · 自動框住可見模型|屏幕截圖 · 僅當前視窗範圍) · (.+)$/);
  if (match) return `${match[1].startsWith('離屏') ? 'Offscreen render · fit visible model' : 'Screenshot · current viewport only'} · ${match[2]}`;
  match = text.match(/^折疊(左側|右側|底部)停靠區$/);
  if (match) return `Collapse ${{ 左側: 'left', 右側: 'right', 底部: 'bottom' }[match[1]]} dock`;
  match = text.match(/^刪除(組及其內容|物件)$/);
  if (match) return match[1] === '物件' ? 'Delete object' : 'Delete group and contents';
  match = text.match(/^吸附精度 (.+)（(.+) px）$/);
  if (match) return `Snap precision ${match[1]} (${match[2]} px)`;
  match = text.match(/^無貼圖 · (.+)$/);
  if (match) return `No texture · ${match[1]}`;
  match = text.match(/^(.+) · 唯讀$/);
  if (match) return `${match[1]} · Read-only`;
  match = text.match(/^文件無法讀取：(.+)$/);
  if (match) return `Cannot read file: ${match[1]}`;
  match = text.match(/^未安裝的 Shape：(.+)$/);
  if (match) return `Shape not installed: ${match[1]}`;
  match = text.match(/^參考圖快照缺失：(.+)$/);
  if (match) return `Reference-image snapshot missing: ${match[1]}`;
  match = text.match(/^Shape (.+) 的 fields 不合法$/);
  if (match) return `Shape ${match[1]} has invalid fields`;
  match = text.match(/^Shape ID 已存在：(.+)$/);
  if (match) return `Shape ID already exists: ${match[1]}`;
  match = text.match(/^已加入「(.+)」 (.+)$/);
  if (match) return `Added ${match[2]} to “${match[1]}”`;
  match = text.match(/^繪畫顏色 (.+)$/);
  if (match) return `Paint color ${match[1]}`;
  match = text.match(/^自定義 (.+)$/);
  if (match) return `Custom ${match[1]}`;
  match = text.match(/^修改元素(.+)$/);
  if (match) return `Edit element ${translateUiText(match[1], language)}`;
  match = text.match(/^修改(.+)三軸參數$/);
  if (match) return `Edit ${translateUiText(match[1], language)} axis values`;
  match = text.match(/^修改(.+)：(.+)$/);
  if (match) return `Edit ${translateUiText(match[1], language)}: ${translateUiText(match[2], language)}`;
  match = text.match(/^修改(.+)$/);
  if (match) return `Edit ${translateUiText(match[1], language)}`;
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
