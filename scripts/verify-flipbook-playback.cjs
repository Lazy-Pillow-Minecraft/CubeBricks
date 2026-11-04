const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cubebricks-flipbook-'));
app.setPath('userData',profile);app.setPath('sessionData',profile);const errors=[];
app.on('web-contents-created',(_event,contents)=>contents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);}));
app.on('browser-window-created',(_event,win)=>{win.hide();win.setSize(1900,1050);win.webContents.setBackgroundThrottling(false);});
require('../electron/main.cjs');
app.whenReady().then(async()=>{
  let report;try{
    const contents=BrowserWindow.getAllWindows()[0].webContents;
    if(contents.isLoading())await new Promise(resolve=>contents.once('did-finish-load',resolve));
    report=await contents.executeJavaScript(`(async()=>{
      const $=s=>document.querySelector(s),wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m);};
      const until=async(f,m)=>{for(let i=0;i<150;i++){if(await f())return;await wait(40);}throw Error(m);};
      await until(()=>!$('#startupCover'),'startup');$('[data-home-format="bedrock_entity"]').click();$('[data-action="addCube"]').click();
      $('[data-action="createTexture"]').click();$('#textureCreateType').value='solid';$('#textureCreateWidth').value='4';$('#textureCreateHeight').value='4';$('#textureCreateForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      const {state}=await import('./editor/state.js'),core=await import('./common/core/texture-features.js'),frames=await import('./common/core/frame-links.js');
      await until(()=>state.textureAssets.length===1,'texture');$('.mode-tab[data-mode="paint"]').click();
      const asset=()=>state.textureAssets[0],make=color=>{const c=document.createElement('canvas');c.width=c.height=4;c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,4,4);return c;};
      const red=make('#ff0000'),blue=make('#0000ff'),green=make('#00ff00');
      asset().layers=[{uid:'red',name:'Red',visible:false,source:red.toDataURL(),opacity:100}, {uid:'group',type:'group',name:'Group',opacity:100},
        {uid:'blue',name:'Blue',parentUid:'group',source:blue.toDataURL(),opacity:100},{uid:'green',name:'Green',parentUid:'group',source:green.toDataURL(),opacity:100}];
      for(const layer of asset().layers)if(layer.source)core.layerRasterCache.set(layer.uid,{canvas:{red,blue,green}[layer.uid],savedSource:layer.source});
      asset().activeLayerUid='red';$('[data-add-layer-group]').click();await until(()=>$('[data-layer-row="green"]'),'layers');
      const toggle=$('[data-texture-animation]');toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}));
      $('[data-open-layer-editor]').click();await wait(90);
      check($('#textureFrameProgress').hidden,'no progress bar without frames');
      for(let i=0;i<3;i++)$('#addTextureFrame').click();await wait(80);
      check(!$('#textureFrameProgress').hidden,'frames enable progress bar');
      const ids=asset().animation.frames.map(f=>f.uid),port=(kind,uid)=>$('#textureFrameConnections [data-frame-port="'+kind+'"][data-port-uid="'+uid+'"]');let pointer=20;
      async function connect(layer,frame){await until(()=>port('layer',layer)&&port('frame',frame),'ports');const id=++pointer,p=port('layer',layer),r=p.getBoundingClientRect();p.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:id,bubbles:true,cancelable:true,clientX:r.x+10,clientY:r.y+10}));await wait(25);const t=port('frame',frame),b=t.getBoundingClientRect();t.dispatchEvent(new PointerEvent('pointerup',{pointerId:id,bubbles:true,clientX:b.x+10,clientY:b.y+10}));await wait(70);}
      await connect(frames.FRAME_ROOT_UID,ids[0]);await connect('group',ids[1]);await connect('red',ids[2]);
      const select=async id=>{$('#textureFrameList [data-texture-frame="'+id+'"]').click();await wait(65);};
      const color=()=>[...$('#textureLayerComposite').getContext('2d').getImageData(0,0,1,1).data];
      await select(ids[0]);check(document.querySelectorAll('[data-layer-visible]').length===asset().layers.length,'root link enables local controls for every item');
      $('[data-layer-row="red"]').click();await wait(40);check(core.activeLayer(asset()).uid==='red','valid paint layer selectable even when globally hidden');
      await select(ids[1]);check(core.activeLayer(asset()).uid==='green','first editable layer follows visible list order');
      check(!$('[data-layer-row="red"] [data-layer-visible]'),'unassociated items have no visibility buttons');
      $('[data-layer-row="green"] [data-layer-visible]').click();await wait(70);
      check(color().join(',')==='0,0,255,255','frame-local hide changes current frame rendering');
      check(!$('[data-layer-row="green"]').classList.contains('frame-member')&&$('[data-layer-row="blue"]').classList.contains('frame-member'),'membership edge excludes hidden children');
      check(core.activeLayer(asset()).uid==='blue','hidden paint target falls back to editable layer');
      $('[data-layer-row="red"]').click();check(core.activeLayer(asset()).uid==='blue','cannot paint into unrelated layer');
      await select(ids[0]);check(color().join(',')==='0,255,0,255','other frame keeps independent child visibility');check(core.activeLayer(asset()).uid==='red','frame restores remembered paint layer');
      await select(ids[1]);check(color().join(',')==='0,0,255,255','returning to frame restores local hidden child');
      const bar=$('#textureFramePosition');bar.value='2';bar.dispatchEvent(new Event('input',{bubbles:true}));await wait(70);
      check(frames.activeTextureFrame(asset()).uid===ids[2]&&core.activeLayer(asset()).uid==='red','timeline switches frame and paint target together');
      check(color().join(',')==='255,0,0,255','timeline affects live rendered texture');
      const blend=$('[data-frame-interpolate]');blend.checked=true;blend.dispatchEvent(new Event('change',{bubbles:true}));
      bar.value='1.5';bar.dispatchEvent(new Event('input',{bubbles:true}));await wait(70);
      const mixed=color();check(mixed[0]>=126&&mixed[0]<=129&&mixed[2]>=126&&mixed[2]<=129&&mixed[3]===255,'fractional progress blends final frame images');
      const fps=$('[data-frame-fps]');fps.value='5';fps.dispatchEvent(new Event('change',{bubbles:true}));
      bar.value='0';bar.dispatchEvent(new Event('input',{bubbles:true}));$('#textureFramePlay').click();await wait(170);$('#textureFramePlay').click();
      check(frames.textureFramePosition(asset())>.2&&frames.textureFramePosition(asset())<1.5,'playback uses elapsed time and configured FPS');
      check(!$('[data-toggle-frame-progress]'),'no timeline visibility switch');
      check($('#textureFrameTicks').children.length===3,'each frame has a timeline tick');
      $('#textureFrameTicks [data-frame-index="2"]').click();check(frames.activeTextureFrame(asset()).uid===ids[2],'tick click jumps to its frame');
      $('#textureFramePlay').click();await select(ids[0]);window.dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('visibilitychange'));
      check($('#textureFramePlay').getAttribute('aria-pressed')==='true','selection, blur and visibility events do not pause playback');
      const held=frames.textureFramePosition(asset());await wait(80);check(frames.textureFramePosition(asset())!==held,'playback continues after other actions');$('#textureFramePlay').click();
      await select(ids[0]);$('#closeLayerEditor').click();await wait(60);
      const checkTimelinePlacement=()=>{
        const panel=$('.texture-layers-panel'),list=panel.querySelector('.texture-layer-panel-scroll'),progress=$('#textureFrameProgress');
        check(list?.parentElement===panel&&progress.parentElement===panel,'layer list returns to its original dock');
        check(Boolean(list.compareDocumentPosition(progress)&Node.DOCUMENT_POSITION_FOLLOWING),'timeline stays below layer list after closing the editor');
      };
      checkTimelinePlacement();
      for(let i=0;i<3;i++){$('[data-open-layer-editor]').click();await wait(20);$('#closeLayerEditor').click();await wait(20);checkTimelinePlacement();}
      check(!document.querySelector('[data-layer-visible]'),'main window hides global and frame-local visibility buttons');
      check($('[data-layer-row="red"]').classList.contains('frame-member'),'main window shows current frame membership');
      const before=structuredClone(asset().animation.frames[0]);$('[data-open-layer-editor]').click();await wait(40);
      $('#textureFrameList').dispatchEvent(new KeyboardEvent('keydown',{key:'d',ctrlKey:true,bubbles:true,cancelable:true}));await wait(60);
      const copy=frames.activeTextureFrame(asset());check(copy.uid!==before.uid&&JSON.stringify(copy.layerUids)===JSON.stringify(before.layerUids)&&copy.paintLayerUid===before.paintLayerUid,'duplicate retains links and remembered paint target');
      frames.setFrameLayerVisibility(asset(),'green',false);check(!asset().animation.frames.find(f=>f.uid===before.uid).visibility?.green,'duplicate visibility is independent');
      $('#closeLayerEditor').click();await wait(40);
      const input=$('[data-texture-animation]');input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));await wait(60);
      check(document.querySelectorAll('[data-layer-visible]').length===asset().layers.length&&asset().layers.find(l=>l.uid==='red').visible===false,'normal visibility state survives flipbook use');
      // Real canvases with isolated input controllers verify the shared eyedropper path.
      const {eyedropperCanvas,opaqueTextureColor}=await import('./paint/eyedropper.js');
      asset().activeLayerUid='red';check(opaqueTextureColor(await eyedropperCanvas(asset()),[0,0])==='#ff0000','normal picker samples active layer');
      check(opaqueTextureColor(await eyedropperCanvas(asset(),{composite:true}),[0,0])==='#00ff00','Ctrl picker samples unlit final composite');
      const transparent=make('#000000');transparent.getContext('2d').clearRect(0,0,4,4);check(opaqueTextureColor(transparent,[0,0])===null,'fully transparent pixels are skipped');
      const {createScenePaintController}=await import('./paint/scene-controller.js');
      const front={_uid:'front',source:transparent.toDataURL(),uvWidth:4,uvHeight:4},back={_uid:'back',source:red.toDataURL(),uvWidth:4,uvHeight:4};
      const cube=texture=>({uid:texture,type:'cube',uvMode:'face',faces:{north:{texture,uv:[0,0,4,4]}}});
      const hits=['front','back'].map((uid,index)=>({uid,cube:cube(uid),faceName:'north',distance:index+1,point:[2,2,0],facePoints:[[0,0,0],[4,0,0],[0,4,0],[4,4,0]]}));let picked=null;
      const scene=createScenePaintController({state:{tool:'eyedropper',project:{getNode:()=>null}},sceneCanvas:{getBoundingClientRect:()=>({left:0,top:0})},sceneRenderer:{pickCoincident:()=>hits},
        textureAssetForReference:uid=>uid==='front'?front:back,isFaceTiled:()=>false,loadTextureAssetImage:a=>Promise.resolve(a===front?transparent:red),setPaintColor:c=>{picked=c;},updateToolOptions(){},toast:message=>{throw Error(message);}});
      scene.startScenePaintPointer({clientX:2,clientY:2,preventDefault(){},ctrlKey:false,altKey:true});await until(()=>picked,'transparent ray traversal');
      check(picked==='#ff0000','default/Alt eyedropper passes through transparent front face');
      picked=null;scene.startScenePaintPointer({clientX:2,clientY:2,preventDefault(){},ctrlKey:true,altKey:true});await until(()=>picked,'Ctrl Alt traversal');check(picked==='#ff0000','Ctrl and Alt compose with transparent traversal');
      const runtime=await import('../scripts/verify-animation-runtime.mjs');const extra=await runtime.verifyAnimationRuntime();
      const tiled=await import('../scripts/verify-tiled-paint.mjs');extra.push(...await tiled.verifyTiledBrush());
      const originalAsset=asset(),oldIds=new Set(originalAsset.layers.map(layer=>layer.uid)),originalSources=originalAsset.layers.map(layer=>layer.source);
      $('#textureList').focus();$('#textureList').dispatchEvent(new KeyboardEvent('keydown',{key:'d',ctrlKey:true,bubbles:true,cancelable:true}));
      await until(()=>state.textureAssets.length===2,'texture duplication');await wait(80);
      const copiedAsset=state.textureAssets.find(entry=>entry!==originalAsset);
      check(copiedAsset.layers.every(layer=>!oldIds.has(layer.uid)),'real texture duplicate receives independent layer IDs');
      const copiedIds=new Set(copiedAsset.layers.map(layer=>layer.uid));
      check(copiedAsset.animation.frames.every(frame=>frame.layerUids.every(uid=>uid===frames.FRAME_ROOT_UID||copiedIds.has(uid))),'duplicated animation links point only to its own layers');
      const copiedImage=copiedAsset.layers.find(layer=>layer.type!=='group'),copyRaster=core.layerRasterCache.get(copiedImage.uid).canvas;
      copyRaster.getContext('2d').fillStyle='#ff00ff';copyRaster.getContext('2d').fillRect(0,0,4,4);copiedImage.source=copyRaster.toDataURL('image/png');
      for(let i=0;i<12;i++){
        $('.texture-item[data-texture-uid="'+(i%2?copiedAsset._uid:originalAsset._uid)+'"]').click();await wait(5);
      }
      await wait(80);check(originalAsset.layers.every((layer,index)=>layer.source===originalSources[index]),'editing and rapidly switching a copied texture does not replace original pixels');
      const plain=[];
      for(const fill of ['#0000ff','#ff0000']){
        const count=state.textureAssets.length;$('[data-action="createTexture"]').click();$('#textureCreateType').value='solid';$('#textureCreateWidth').value='4';$('#textureCreateHeight').value='4';$('#textureCreateColor').value=fill;
        $('#textureCreateForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await until(()=>state.textureAssets.length===count+1,'create plain texture');plain.push(state.textureAssets.at(-1));await wait(40);
      }
      for(let i=0;i<16;i++){
        const selected=plain[i%2];$('.texture-item[data-texture-uid="'+selected._uid+'"]').click();await wait(30);
        const actual=[...$('#textureCanvas').getContext('2d').getImageData(0,0,1,1).data].join(',');
        check(actual===(i%2?'255,0,0,255':'0,0,255,255'),'plain textures keep their own pixels after repeated switching');
      }
      return {ok:true,checks:['root links','per-frame visibility','global visibility preserved','paint target restriction and memory','timeline scrub','FPS playback','frame crossfade','main/child visibility UI','membership edges','independent frame copy','unlit composite picking','transparent ray traversal','Ctrl Alt picking',...extra]};
    })()`);
    if(errors.length)throw Error(errors.join('\n'));
    const capture=await contents.capturePage();fs.mkdirSync(path.resolve('build/performance'),{recursive:true});fs.writeFileSync(path.resolve('build/performance/flipbook-playback.png'),capture.toPNG());
  }catch(error){report={ok:false,error:error.stack,errors};}
  fs.mkdirSync(path.resolve('build/performance'),{recursive:true});fs.writeFileSync(path.resolve('build/performance/flipbook-playback.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(report.ok?0:1);
});
