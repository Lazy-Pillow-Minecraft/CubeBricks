// Synthetic, hidden, read-only-to-the-workspace application performance audit.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url');
const pixelOnly = process.argv.includes('--pixels');
const renderOnly = process.argv.includes('--render');
const suffix = process.argv.find(value => value.startsWith('--suffix='))?.slice(9).replace(/[^\w-]/g, '') || '';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-animation-audit-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.whenReady().then(async () => {
  let report;
  try {
    const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { backgroundThrottling: false } });
    const page = path.join(profile, 'audit.html'); fs.writeFileSync(page, '<!doctype html><body style="margin:0">');
    await win.loadFile(page);
    const root = pathToFileURL(path.resolve('src')).href;
    report = await win.webContents.executeJavaScript(`(async()=>{
      const {CubeBricksProject,Cube,Group,addModifier,buildModifierRenderInstances,Shape}=await import(${JSON.stringify(root + '/model.js')});
      const {WebGLSceneRenderer}=await import(${JSON.stringify(root + '/render/webgl-renderer.js')});
      const {compositeLayers,layerRasterCache}=await import(${JSON.stringify(root + '/common/core/texture-features.js')});
      const {paintBoxNet}=await import(${JSON.stringify(root + '/texture/export-raster.js')});
      const results=[],notes=[],measure=(name,count,fn)=>{const samples=[];let value;for(let i=0;i<count;i++){
        const start=performance.now();value=fn(i);samples.push(performance.now()-start);
      }samples.sort((a,b)=>a-b);results.push({name,count,p50:samples[Math.floor(count*.5)],p95:samples[Math.min(count-1,Math.ceil(count*.95)-1)],max:samples[count-1]});return value;};
      const makeProject=(count,grouped=false)=>{
        const elements=Array.from({length:count},(_,i)=>new Cube({uid:'cube_'+i,position:[(i%25)*2,Math.floor(i/625)*2,Math.floor(i/25)%25*2],size:[1,1,1],pivot:[0,0,0]}));
        const group=new Group({uid:'root',children:elements.map(c=>c.uid)});
        return new CubeBricksProject({formatId:'bedrock_entity',elements,groups:grouped?[group]:[],outliner:grouped?[group.uid]:elements.map(c=>c.uid)});
      };
      const canvas=document.createElement('canvas');canvas.style.cssText='width:800px;height:600px';document.body.append(canvas);
      const renderer=new WebGLSceneRenderer(canvas),gl=renderer.gl,counters={};
      for(const name of ['bufferData','bufferSubData','texImage2D','texSubImage2D','drawArrays','drawElements']){
        const original=gl[name].bind(gl);gl[name]=(...args)=>{counters[name]=(counters[name]||0)+1;return original(...args);};
      }
      const camera={projection:'perspective',yaw:1,pitch:.4,zoom:.5,panX:0,panY:0,target:[24,3,24],renderMode:'textured',
        grid:false,wire:false,captureModelOnly:true,cubeBirthMs:0,cubeDeathMs:0,selectedUids:new Set()};
      for(const n of ${pixelOnly ? '[]' : '[1000,5000]'}){
        let project=makeProject(n,true);renderer.invalidateGeometry();renderer.render(project,null,camera);gl.finish();
        if(${renderOnly}){
          for(const type of ['cutout','translucent']){
            project.renderType=type;renderer.invalidateGeometry();renderer.render(project,null,camera);gl.finish();
            for(const key of Object.keys(counters))counters[key]=0;
            measure('camera-'+type+'-'+n,20,i=>renderer.render(project,null,{...camera,yaw:1+i*.01}));gl.finish();
            notes.push({scenario:'camera-'+type+'-'+n,counters:{...counters}});
          }
          continue;
        }
        for(const key of Object.keys(counters))counters[key]=0;
        measure('camera-submit-'+n,30,i=>renderer.render(project,null,{...camera,yaw:1+i*.01}));gl.finish();
        notes.push({scenario:'camera-'+n,counters:{...counters}});
        const uid=project.elements[0].uid;renderer.render(project,uid,{...camera,selectedUids:new Set([uid])});
        for(const key of Object.keys(counters))counters[key]=0;
        measure('one-cube-pose-'+n,15,i=>{project.elements[0].rotation[1]=i;renderer.invalidateSelectionGeometry(true);renderer.render(project,uid,{...camera,selectedUids:new Set([uid])});});gl.finish();
        notes.push({scenario:'one-cube-pose-'+n,counters:{...counters}});
        renderer.render(project,'root',{...camera,selectedUids:new Set(['root'])});
        for(const key of Object.keys(counters))counters[key]=0;
        measure('whole-group-pose-'+n,10,i=>{project.groups[0].rotation[1]=i;renderer.invalidateSelectionGeometry(true);renderer.render(project,'root',{...camera,selectedUids:new Set(['root'])});});gl.finish();
        notes.push({scenario:'whole-group-pose-'+n,counters:{...counters}});
        for(const key of Object.keys(counters))counters[key]=0;
        measure('whole-group-gpu-preview-'+n,30,i=>{
          const angle=i*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
          renderer.setSelectionPreviewTransform([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]);renderer.render(project,'root',{...camera,selectedUids:new Set(['root'])});
        });gl.finish();renderer.clearSelectionPreviewTransform();
        notes.push({scenario:'whole-group-gpu-preview-'+n,counters:{...counters}});
        measure('project-serialize-'+n,8,()=>project.serialize());
        const text=project.serialize();notes.push({scenario:'serialized-'+n,bytes:text.length});
        measure('project-parse-'+n,8,()=>JSON.parse(text));
        const data=JSON.parse(text);measure('project-hydrate-'+n,8,()=>new CubeBricksProject(data));
        measure('project-hydrate-reuse-1-'+n,8,()=>new CubeBricksProject(data,{reuseElementsFrom:project,changedUids:[uid]}));
        project=makeProject(n,true);addModifier(project.groups[0],'symmetry',{axes:{x:true,y:true,z:true},ignoreDuplicateCubes:true});
        measure('symmetry-evaluate-8x-'+n,5,()=>buildModifierRenderInstances(project));
        project.groups[0].modifiers[0].ignoreDuplicateCubes=false;
        measure('symmetry-evaluate-no-dedup-'+n,5,()=>buildModifierRenderInstances(project));
        renderer.invalidateGeometry();renderer.render(project,null,camera);gl.finish();
        measure('pick-modifiers-'+n,40,i=>renderer.pickDetailed(project,200+i%20*10,300,true,{includeGenerated:true}));
      }
      const readbacks={calls:0,bytes:0};
      const readPixels=CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData=function(x,y,width,height,...args){readbacks.calls++;readbacks.bytes+=width*height*4;return readPixels.call(this,x,y,width,height,...args);};
      for(const [size,layers]of ${renderOnly ? '[]' : '[[256,100],[1024,20]]'}){
        const asset={_uid:'layers-'+size,uvWidth:size,uvHeight:size,layers:[]};
        for(let i=0;i<layers;i++){
          const raster=document.createElement('canvas');raster.width=raster.height=size;
          raster.getContext('2d').fillStyle='rgba('+i%255+',80,100,.5)';raster.getContext('2d').fillRect(0,0,size,size);
          const uid='audit-layer-'+size+'-'+i;asset.layers.push({uid,source:'source-'+i,visible:true,opacity:100,blendMode:'normal'});
          layerRasterCache.set(uid,{canvas:raster,savedSource:'source-'+i});
        }
        compositeLayers(asset);
        measure('layers-full-'+size+'-'+layers,5,()=>compositeLayers(asset));
        measure('layers-region16-'+size+'-'+layers,10,()=>compositeLayers(asset,null,null,{x:20,y:20,width:16,height:16}));
        for(let i=0;i<asset.layers.length;i+=4)asset.layers[i].blendMode='add';
        measure('layers-custom-full-'+size+'-'+layers,3,()=>compositeLayers(asset));
        readbacks.calls=readbacks.bytes=0;
        measure('layers-custom-region16-'+size+'-'+layers,8,()=>compositeLayers(asset,null,null,{x:20,y:20,width:16,height:16}));
        notes.push({scenario:'custom-region16-'+size+'-'+layers,patches:8,readbacks:{...readbacks}});
        for(const layer of asset.layers)layerRasterCache.delete(layer.uid);
      }
      const source=document.createElement('canvas');source.width=source.height=1024;source.getContext('2d').fillRect(0,0,1024,1024);
      const output=document.createElement('canvas');output.width=16;output.height=16;
      const net={cube:{size:[2,2,2],uv:[0,0]},members:['north','south','east','west','up','down'].map(name=>({name,index:0,pixelUv:[0,0,16,16],rotation:0}))};
      readbacks.calls=readbacks.bytes=0;
      if(!${renderOnly}){
        measure('export-box-net-same-source-30',1,()=>{const cache=new Map();for(let i=0;i<30;i++)paintBoxNet(output.getContext('2d'),net,[source],1,0,0,cache);});
        notes.push({scenario:'export-box-net-same-source-30',readbacks:{...readbacks}});
      }
      return {ok:true,environment:{userAgent:navigator.userAgent,webglRenderer:gl.getParameter(gl.RENDERER),viewport:[800,600]},results,notes};
    })()`);
  } catch(error) {report={ok:false,error:error.stack};}
  fs.mkdirSync(path.resolve('build/performance'),{recursive:true});
  fs.writeFileSync(path.resolve('build/performance/audit-animation-performance'+(pixelOnly?'-pixels':renderOnly?'-render':'')+'-2026-11-05'+(suffix?'-'+suffix:'')+'.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));app.exit(report.ok?0:1);
});
