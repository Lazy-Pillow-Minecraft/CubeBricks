// One representation for file/journal snapshots and immediate history views.
function jsonValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : jsonValue(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined && typeof item !== 'function').map(([key, item]) => [key, jsonValue(item)]));
  return value;
}
export function textureSnapshot(texture, index, textureSize = [16, 16], owned = false) {
  const data = {
    uuid: texture.uuid || texture._uid || `texture_${index + 1}`, id: texture.id || String(index),
    name: texture.name || `texture_${index + 1}.png`, source: texture.source, mode: texture.mode || 'default',
    layers: texture.layers || null,
    active_layer_uid: texture.activeLayerUid || null,
    animation: texture.animation ? Object.fromEntries(Object.entries(texture.animation).filter(([key]) => !key.startsWith('_'))) : null,
    uv_width: texture.uvWidth || textureSize[0], uv_height: texture.uvHeight || textureSize[1],
    use_as_default: texture.useAsDefault === true, group_id: texture.groupId || null, kind: texture.kind || 'IMAGE',
    template_uv_independent: texture.templateUvIndependent ?? null,
    external_file: texture.externalFile || null, namespace: texture.namespace || ''
  };
  return owned ? data : jsonValue(data);
}
