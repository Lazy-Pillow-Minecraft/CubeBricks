import { compositeLayers, layerRasterCache } from '../common/core/texture-features.js';

export function createLayerThumbnailUpdates({activeTextureAsset,root=()=>document.querySelector('#textureFeatureControls')}){
  const scaledCaches=new WeakMap(),pending=new Map();let request=null;
  function paint(uid,raster){
    const canvas=root()?.querySelector(`[data-layer-row="${CSS.escape(uid)}"] .texture-layer-thumb`);if(!canvas||!raster)return;
    const context=canvas.getContext('2d'),scale=Math.min(canvas.width/raster.width,canvas.height/raster.height);
    context.clearRect(0,0,canvas.width,canvas.height);context.imageSmoothingEnabled=false;
    const width=raster.width*scale,height=raster.height*scale;context.drawImage(raster,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
  }
  function flush(){
    request=null;const jobs=[...pending];pending.clear();
    for(const [asset,changed]of jobs){
      if(asset!==activeTextureAsset())continue;
      const entries=new Map(asset.layers.map(layer=>[layer.uid,layer])),groups=new Set();
      for(const uid of changed){
        paint(uid,layerRasterCache.get(uid)?.canvas);
        let parent=entries.get(uid)?.parentUid;const seen=new Set();
        while(entries.get(parent)?.type==='group'&&!seen.has(parent)){seen.add(parent);groups.add(parent);parent=entries.get(parent).parentUid;}
      }
      if(!groups.size)continue;
      let width=1,height=1;
      for(const layer of asset.layers){const canvas=layerRasterCache.get(layer.uid)?.canvas;if(layer.type!=='group'&&canvas){width=Math.max(width,canvas.width);height=Math.max(height,canvas.height);}}
      const scale=Math.min(27/width,27/height),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
      let cached=scaledCaches.get(asset);if(!cached||cached.width!==width||cached.height!==height){cached={width,height,rasters:new Map()};scaledCaches.set(asset,cached);}
      for(const layer of asset.layers){
        if(layer.type==='group')continue;const raster=layerRasterCache.get(layer.uid)?.canvas;if(!raster)continue;
        let record=cached.rasters.get(layer.uid);
        if(!record||record.original!==raster||record.savedSource!==layer.source||changed.has(layer.uid)){
          const canvas=record?.canvas||document.createElement('canvas');canvas.width=w;canvas.height=h;
          const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;context.drawImage(raster,0,0,raster.width*scale,raster.height*scale);
          record={canvas,original:raster,savedSource:layer.source};cached.rasters.set(layer.uid,record);
        }
      }
      const shadow={...asset,animation:null,uvWidth:w,uvHeight:h};
      for(const uid of groups)paint(uid,compositeLayers(shadow,null,uid,null,null,null,cached.rasters));
    }
  }
  return {queue(asset,uid){
    if(!asset||!uid||asset!==activeTextureAsset())return;
    if(!pending.has(asset))pending.set(asset,new Set());pending.get(asset).add(uid);
    if(request===null)request=requestAnimationFrame(flush);
  }};
}
