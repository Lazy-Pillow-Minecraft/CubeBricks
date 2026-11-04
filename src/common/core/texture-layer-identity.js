// Reassign the whole reference graph together when a texture is copied.
export function reidentifyTextureLayers(asset){
  const map=new Map((asset.layers||[]).map(layer=>[layer.uid,crypto.randomUUID()]));
  for(const layer of asset.layers||[]){layer.uid=map.get(layer.uid);if(map.has(layer.parentUid))layer.parentUid=map.get(layer.parentUid);if(map.has(layer.maskLayerUid))layer.maskLayerUid=map.get(layer.maskLayerUid);}
  if(map.has(asset.activeLayerUid))asset.activeLayerUid=map.get(asset.activeLayerUid);
  for(const frame of asset.animation?.frames||[]){
    if(frame.layerUids)frame.layerUids=frame.layerUids.map(uid=>map.get(uid)||uid);
    if(map.has(frame.paintLayerUid))frame.paintLayerUid=map.get(frame.paintLayerUid);
    if(frame.visibility)frame.visibility=Object.fromEntries(Object.entries(frame.visibility).map(([uid,value])=>[map.get(uid)||uid,value]));
  }
  return asset;
}
export function isolateTextureLayerIds(assets){
  const seen=new Set();for(const asset of assets){
    if((asset.layers||[]).some(layer=>seen.has(layer.uid)))reidentifyTextureLayers(asset);
    for(const layer of asset.layers||[])seen.add(layer.uid);
  }return assets;
}
