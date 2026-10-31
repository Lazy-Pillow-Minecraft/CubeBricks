// One index for every persisted operation. Extensions register only their base
// identifier and label; the standard verbs are generated here.
const definitions = new Map();

export const OperationVerb = Object.freeze({
  add: '新增', remove: '刪除', toggle: '切換', change: '修改',
  move: '調整順序', bake: '烘焙', transform: '移動節點'
});

export function registerOperation(id, label) {
  if (!/^[a-z][a-z0-9_.-]*$/.test(id)) throw new Error(`Invalid operation ID: ${id}`);
  if (definitions.has(id) && definitions.get(id) !== label) throw new Error(`Duplicate operation ID: ${id}`);
  definitions.set(id, label);
  return id;
}

export function registerEntityOperations(namespace, type, label) {
  for (const [verb, translated] of Object.entries(OperationVerb)) {
    registerOperation(`${namespace}.${type}.${verb}`, `${label}：${translated}`);
  }
}

export function operationDefinition(id) {
  return definitions.has(id) ? { id, label: definitions.get(id) } : null;
}

export function operationIndex() {
  return [...definitions].map(([id, label]) => ({ id, label }));
}

export function requireOperation(id) {
  if (!definitions.has(id)) throw new Error(`Unregistered operation ID: ${id}`);
  return id;
}

const coreOperations = {
  'core.project.create': '建立項目',
  'core.project.import': '導入項目',
  'core.project.information': '修改項目信息',
  'core.project.render_type': '修改渲染類型',
  'core.project.face_culling': '修改背面剔除',
  'core.project.snap': '修改項目吸附精度',
  'core.element.color': '修改元素顏色',
  'core.element.property': '修改元素屬性',
  'core.element.vector': '修改元素三軸參數',
  'core.element.flag': '切換元素選項',
  'core.element.visibility': '切換元素可見性',
  'core.element.reset_rotation': '重設元素旋轉',
  'core.element.apply_applied_position': '應用元素位移',
  'core.element.restore_applied_position': '還原已應用位移',
  'core.element.apply_applied_rotation': '應用元素旋轉',
  'core.element.restore_applied_rotation': '還原已應用旋轉',
  'core.element.delete': '刪除元素',
  'core.element.copy': '複製元素到剪貼簿',
  'core.element.duplicate': '複製元素',
  'core.element.paste': '貼上元素',
  'core.element.cut': '剪下元素',
  'core.element.reparent': '移動層級',
  'core.element.move': '移動元素',
  'core.element.scale': '縮放元素',
  'core.element.rotate': '旋轉元素',
  'core.element.pivot': '移動樞軸點',
  'core.element.vertex_snap': '頂點捕捉',
  'core.element.precise_rotation': '精確旋轉',
  'core.cube.create': '建立 Cube',
  'core.shape.create': '建立 Shape',
  'core.shape.bake': '烘焙 Shape 為 Cube 組',
  'core.locator.create': '建立 Locator',
  'core.curve.create': '建立貝塞爾曲線',
  'core.group.create': '建立組',
  'core.shape.subdivision': '編輯 Shape 細分',
  'core.shape.snap_mode': '修改 Shape 吸附模式',
  'core.shape.inner_radius': '修改 Shape 內半徑',
  'core.shape.inner_radius_mode': '修改 Shape 內半徑模式',
  'core.curve.segmentation': '修改曲線分段',
  'core.curve.handle': '修改曲線手柄',
  'core.curve.tangent': '修改曲線切線',
  'core.curve.roll': '修改曲線滾動角',
  'core.curve.node_radius': '修改曲線節點半徑',
  'core.curve.head_direction': '修改曲線包絡方向',
  'core.curve.nested_bake': '切換曲線嵌套烘焙',
  'core.curve.node_add': '新增曲線節點',
  'core.curve.node_remove': '刪除曲線節點',
  'core.curve.node_move': '移動曲線節點',
  'core.knife.cube': '切割 Cube',
  'core.knife.curve': '切斷曲線',
  'core.reference.add': '加入參考圖',
  'core.reference.remove': '刪除參考圖',
  'core.reference.reset': '重設參考圖',
  'core.reference.move': '移動參考圖',
  'core.reference.scale': '縮放參考圖',
  'core.reference.reorder': '調整參考圖層級',
  'core.uv.move': '移動 UV',
  'core.uv.resize': '縮放 UV',
  'core.uv.assign': '分配 UV',
  'core.uv.rotate': '旋轉 UV',
  'core.uv.mirror': '鏡像 UV',
  'core.uv.cull_face': '剔除面',
  'core.uv.coordinate': '修改 UV 座標',
  'core.uv.tiling': '修改平鋪貼圖參數',
  'core.texture.assign': '分配貼圖',
  'core.texture.create': '建立貼圖',
  'core.texture.generate': '生成貼圖模板',
  'core.texture.layer': '編輯貼圖圖層',
  'core.texture.group': '編輯貼圖組',
  'core.texture.paint': '繪畫貼圖',
  'core.texture.selection-transform': '變換選區像素',
  'core.texture.brush': '畫筆繪製',
  'core.texture.line': '直線繪製',
  'core.texture.rectangle': '矩形繪製',
  'core.texture.ellipse': '橢圓繪製',
  'core.texture.fill': '油漆桶填充',
  'core.texture.gradient': '漸變填充',
  'core.texture.palette': '修改色卡',
  'core.texture.mode': '修改貼圖模式',
  'core.texture.import': '導入貼圖',
  'core.texture.delete': '刪除貼圖',
  'core.texture.cut': '剪切貼圖',
  'core.texture.paste': '貼上貼圖',
  'core.texture.duplicate': '原地複製貼圖',
  'core.texture.reorder': '調整貼圖順序',
  'core.history.undo': '撤銷',
  'core.history.redo': '重做'
};
for (const [id, label] of Object.entries(coreOperations)) registerOperation(id, label);

// Inspector controls are data-driven. Keep their IDs in the same index rather
// than recording every numeric or checkbox edit as a generic property change.
const inspectorFields = {
  name: '名稱', unnamed: '系統命名', visible: '可見性', shade: '面陰影',
  autoUv: '自動 UV', uvMode: 'UV 模式', uvNormalized: 'UV 歸一化',
  exported: '導出', locked: '鎖定', color: '顯示色', inflate: '膨脹',
  handlesEnabled: '貝塞爾手柄', symmetricHandles: '對稱手柄',
  preserveSubdivisionEdits: '保留細分編輯'
};
for (const [key, label] of Object.entries(inspectorFields)) {
  registerOperation(`core.element.field.${key.toLowerCase()}`, `修改元素${label}`);
}
const inspectorVectors = {
  position: '位置', origin: '位置', transformPosition: '位置', pivot: '樞軸', rotation: '旋轉',
  size: '尺寸', handleIn: '前手柄', handleOut: '後手柄'
};
for (const [key, label] of Object.entries(inspectorVectors)) {
  registerOperation(`core.element.vector.${key.toLowerCase()}`, `修改${label}三軸參數`);
}
const shapeParameters = {
  radius: '半徑', height: '高度', sides: '邊數', innerRadius: '內半徑',
  thickness: 'Cube 柱粗細', angleStep: '角度步長', segmentLength: '距離步長',
  cubeSize: 'Cube 尺寸'
};
for (const [key, label] of Object.entries(shapeParameters)) {
  registerOperation(`core.shape.parameter.${key.toLowerCase()}`, `修改${label}`);
}
