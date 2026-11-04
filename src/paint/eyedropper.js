import { activeLayer, compositeLayers, flipbookFrame, layerRasterCache, prepareLayers } from '../common/core/texture-features.js';

export async function eyedropperCanvas(asset,{composite=false,liveCanvas=null,loadImage}={}) {
  if(asset?.animation?.enabled)liveCanvas=null;
  if(asset?.layers?.length){
    await prepareLayers(asset);
    if(composite)return flipbookFrame(asset,compositeLayers(asset,liveCanvas&&activeLayer(asset)?liveCanvas:null));
    return liveCanvas&&activeLayer(asset)?liveCanvas:layerRasterCache.get(activeLayer(asset)?.uid)?.canvas||null;
  }
  if(!composite&&asset?.animation?.enabled)return null;
  const image=liveCanvas||await loadImage?.(asset);if(!image)return null;
  if(typeof image.getContext==='function')return composite?flipbookFrame(asset,image):image;
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;canvas.getContext('2d').drawImage(image,0,0);
  return composite?flipbookFrame(asset,canvas):canvas;
}
export function opaqueTextureColor(canvas,point){
  if(!canvas||!point)return null;
  const x=Math.max(0,Math.min(canvas.width-1,Math.floor(point[0]))),y=Math.max(0,Math.min(canvas.height-1,Math.floor(point[1])));
  const pixel=canvas.getContext('2d').getImageData(x,y,1,1).data;
  return pixel[3]?`#${[...pixel].slice(0,3).map(value=>value.toString(16).padStart(2,'0')).join('')}`:null;
}
