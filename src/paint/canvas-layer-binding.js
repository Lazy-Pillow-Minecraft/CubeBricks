// A stroke keeps its starting paint layer while animated frame display moves on.
const bindings=new WeakMap();
export function bindPaintCanvas(asset,canvas,uid){
  if(asset&&canvas&&uid)bindings.set(canvas,{asset,uid});
}
export function boundPaintLayer(asset,canvas){
  const binding=canvas&&bindings.get(canvas);
  return binding?.asset===asset?asset.layers?.find(layer=>layer.uid===binding.uid)||null:null;
}
export function paintCanvasIsBound(canvas){return bindings.has(canvas);}
export function releasePaintCanvas(canvas){
  if(bindings.delete(canvas)&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('cubebricks:paint-canvas-released',{detail:canvas}));
}
