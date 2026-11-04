// The editable DOM canvas is reused for every texture. Per-texture caches own
// their pixels so selecting another texture cannot replace a previous image.
const snapshots=new WeakMap();
export function snapshotEditableTexture(asset,source,editableCanvas,dirty=null){
  if(!asset||source!==editableCanvas)return source;
  let snapshot=snapshots.get(asset),patch=dirty&&snapshot?.width===source.width&&snapshot?.height===source.height;
  if(!snapshot){snapshot=document.createElement('canvas');snapshots.set(asset,snapshot);}
  if(snapshot.width!==source.width||snapshot.height!==source.height){snapshot.width=source.width;snapshot.height=source.height;patch=false;}
  const context=snapshot.getContext('2d');context.imageSmoothingEnabled=false;
  if(patch){context.clearRect(dirty.x,dirty.y,dirty.width,dirty.height);context.drawImage(source,dirty.x,dirty.y,dirty.width,dirty.height,dirty.x,dirty.y,dirty.width,dirty.height);}
  else{context.clearRect(0,0,snapshot.width,snapshot.height);context.drawImage(source,0,0);}
  return snapshot;
}
