// Some deduplicated models contain an overlay used by only one of their
// entities (for example, a drowned baby's outer layer). Set the source
// visibility before importing, because Blockbench also stores visibility on
// the overlay's descendant cubes, not only on its parent group.
export function skinModelForTexture(record, sourceModel, textureId) {
  const layers = record.conditionalLayers || [];
  if (!layers.length) return sourceModel;
  const entityId = record.textures.find(texture => texture.id === textureId)?.entityId;
  if (!entityId) return sourceModel;
  const model = structuredClone(sourceModel);
  const elements = new Map((model.elements || []).map(element => [element.uuid, element]));
  const layersByGroup = new Map(layers.map(layer => [layer.groupId, layer]));

  function setVisibility(node, visible) {
    if (typeof node === 'string') {
      const element = elements.get(node);
      if (element) element.visibility = visible;
      return;
    }
    node.visibility = visible;
    for (const child of node.children || []) setVisibility(child, visible);
  }

  function visit(node) {
    if (typeof node === 'string') return;
    const layer = layersByGroup.get(node.uuid);
    if (layer) setVisibility(node, layer.entityIds.includes(entityId));
    else for (const child of node.children || []) visit(child);
  }

  for (const node of model.outliner || []) visit(node);
  return model;
}
