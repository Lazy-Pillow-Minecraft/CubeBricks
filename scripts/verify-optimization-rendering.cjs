// Pixel comparison against the previous compositor and non-indexed renderer.
// Always uses a hidden window, temporary profile, and generated fixtures.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-optimization-verify-'));
const baseline = process.argv.find(value => value.startsWith('--baseline='))?.slice(11)
  || 'a6dfa154184cd15f4d84a511ab39913865ccd6f3';
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.whenReady().then(async () => {
  let report;
  try {
    const original = execFileSync('git', ['show', `${baseline}:src/common/core/texture-features.js`], { encoding: 'utf8' });
    const start = original.indexOf('export function compositeLayers(');
    const end = original.indexOf('\n// A group', start);
    if (start < 0 || end < 0) throw Error('Missing baseline compositor');
    const legacy = original.slice(start, end).replace('export function', 'function');
    const page = path.join(profile, 'verify.html');
    fs.writeFileSync(page, '<!doctype html><body style="margin:0">');
    const win = new BrowserWindow({ show: false, width: 400, height: 400, webPreferences: { backgroundThrottling: false } });
    await win.loadFile(page);
    const root = pathToFileURL(path.resolve('src')).href;
    const checks = await win.webContents.executeJavaScript(`(async()=>{
      const {CubeBricksProject,addModifier}=await import(${JSON.stringify(root + '/model.js')});
      const {WebGLSceneRenderer}=await import(${JSON.stringify(root + '/render/webgl-renderer.js')});
      const features=await import(${JSON.stringify(root + '/common/core/texture-features.js')});
      const blend=await import(${JSON.stringify(root + '/common/core/layer-blend.js')});
      const {mapLayerTonePixels}=await import(${JSON.stringify(root + '/common/core/layer-tone-map.js')});
      const {layerRasterRegions}=await import(${JSON.stringify(root + '/common/utils/layer-raster-regions.js')});
      const checks=[],check=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
      const equal=(a,b,label)=>{let count=0,max=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i]){count++;max=Math.max(max,Math.abs(a[i]-b[i]));}
        check(a.length===b.length&&!count,label+' (different channels='+count+', max='+max+')');};
      const tree=layers=>{const entries=new Map(layers.map(l=>[l.uid,l])),childrenByParent=new Map();
        for(const l of layers){const parent=entries.get(l.parentUid)?.type==='group'?l.parentUid:null;
          if(!childrenByParent.has(parent))childrenByParent.set(parent,[]);childrenByParent.get(parent).push(l);}return {entries,childrenByParent};};
      const names=['layerTreeIndex','imageCanvas','activeLayer','layerRasterCache','applyLayerMaskPixels','blendLayerImageData','mapLayerTonePixels'];
      const oldComposite=Function(...names,${JSON.stringify(legacy + ';return compositeLayers;')})(tree,features.imageCanvas,features.activeLayer,
        features.layerRasterCache,blend.applyLayerMaskPixels,blend.blendLayerImageData,mapLayerTonePixels);
      const makeRaster=(n,size=32)=>{const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d'),p=ctx.createImageData(size,size);
        for(let i=0;i<p.data.length;i+=4)p.data.set([(i*3+n*37)%256,(i*7+n*23)%256,(i*11+n*13)%256,(i/4*17+n*51)%256],i);
        ctx.putImageData(p,0,0);return c;};
      const asset={uvWidth:32,uvHeight:32,layers:[]};
      for(let i=0;i<8;i++){const uid='layer-'+i;asset.layers.push({uid,source:'source-'+i,opacity:37+i*7,visible:true,blendMode:'normal'});
        features.layerRasterCache.set(uid,{canvas:makeRaster(i),savedSource:'source-'+i});}
      const read=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data, region={x:5,y:7,width:13,height:11};
      for(const mode of ['normal','multiply','screen','add','subtract','hue','saturation','value','grayscale','tone_map']){
        for(let i=1;i<8;i+=2)asset.layers[i].blendMode=mode;
        equal(read(features.compositeLayers(asset)),read(oldComposite(asset)),mode+': complete layer image');
        equal(read(features.compositeLayers(asset,null,null,region)),read(oldComposite(asset,null,null,region)),mode+': local layer image');
        equal(read(features.compositeLayers(asset,null,null,region)),read(oldComposite(asset,null,null,region)),mode+': cached local layer image');
      }
      asset.layers[2].maskLayerUid='layer-7';asset.layers[7].visible=false;
      asset.layers[3].type='group';asset.layers[4].parentUid='layer-3';asset.layers[5].parentUid='layer-3';
      equal(read(features.compositeLayers(asset,null,null,region)),read(oldComposite(asset,null,null,region)),'nested group and hidden mask');
      const changed=features.layerRasterCache.get('layer-4').canvas,ctx=changed.getContext('2d');ctx.fillStyle='#f57021';ctx.fillRect(5,7,3,4);
      layerRasterRegions.invalidate(changed,{x:5,y:7,width:3,height:4});
      equal(read(features.compositeLayers(asset,null,null,region)),read(oldComposite(asset,null,null,region)),'live paint invalidates cached pixels');
      const pending={layers:[{uid:'disposed-decode',source:makeRaster(1).toDataURL()}]};
      const loading=features.prepareLayers(pending);features.releaseTextureRasters(pending);await loading;
      check(!features.layerRasterCache.has('disposed-decode'),'late image decode cannot resurrect a closed project');
      const canvas=document.createElement('canvas');canvas.style.cssText='width:256px;height:256px';document.body.append(canvas);
      const renderer=new WebGLSceneRenderer(canvas),gl=renderer.gl,ordered=renderer.orderedFaceMesh;
      renderer.setTexture(makeRaster(7));
      const faces=Object.fromEntries(['north','south','east','west','up','down'].map(name=>[name,{texture:0,uv:[0,0,32,32]}]));
      const project=new CubeBricksProject({formatId:'bedrock_entity',renderType:'translucent',textureSize:[32,32],elements:[
        {uid:'a',type:'cube',position:[-3,-2,-2],size:[5,4,4],faces},
        {uid:'b',type:'cube',position:[-1,-3,-3],size:[4,6,4],rotation:[14,21,7],faces},
        {uid:'c',type:'cube',position:[3,2,1],size:[-4,-3,3],rotation:[-12,9,18],faces}]});
      addModifier(project.elements[0],'symmetry',{axes:{x:true},ignoreDuplicateCubes:true});
      const camera={yaw:.6,pitch:.3,zoom:1,panX:0,panY:0,target:[0,0,0],renderMode:'textured',grid:false,wire:false,
        captureModelOnly:true,cubeBirthMs:0,cubeDeathMs:0,selectedUids:new Set(['b'])};
      const pixels=()=>{const p=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
      for(const projection of ['orthographic','perspective'])for(const faceDistinct of [false,true])for(const selected of [false,true]){
        renderer.invalidateGeometry();camera.projection=projection;camera.faceDistinct=faceDistinct;camera.yaw+=.07;
        const uid=selected?'b':null;camera.selectedUids=new Set(uid?[uid]:[]);
        if(selected)renderer.setSelectionPreviewTransform([1,0,0,0,0,1,0,0,0,0,1,0,.2,.3,0,1]);else renderer.clearSelectionPreviewTransform();
        renderer.orderedFaceMesh=ordered;renderer.orderedFaceCache=null;renderer.render(project,uid,camera);const indexed=pixels();
        renderer.orderedFaceMesh=null;renderer.orderedFaceCache=null;renderer.render(project,uid,camera);
        equal(pixels(),indexed,projection+', face tint='+faceDistinct+', preview='+selected+': indexed transparency matches vertex reorder');
      }
      check(gl.getError()===gl.NO_ERROR,'WebGL reports no errors');
      return checks;
    })()`);
    report = { ok: true, baseline, checks };
  } catch (error) { report = { ok: false, error: error.stack }; }
  fs.mkdirSync(path.resolve('build/performance'), { recursive: true });
  fs.writeFileSync(path.resolve('build/performance/optimization-rendering.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(report.ok ? 0 : 1);
});
