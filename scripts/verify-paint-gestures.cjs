// Real renderer, pixels and history IPC, with an isolated disposable profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-paint-gestures-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
});
const { WorkerProjectJournal } = require('../electron/journal-service.cjs');
const commit = WorkerProjectJournal.prototype.commit;
let gate, release, blocked = 0;
const io = { started: 0, passedGate: 0, completed: 0, checkouts: 0 };
WorkerProjectJournal.prototype.commit = async function (...args) {
  io.started++;
  if (gate) {
    blocked++;
    await gate;
  }
  io.passedGate++;
  try { return await commit.apply(this, args); }
  finally { io.completed++; }
};
const navigate = WorkerProjectJournal.prototype.navigate;
WorkerProjectJournal.prototype.navigate = async function (...args) {
  try { return await navigate.apply(this, args); } finally { io.checkouts++; }
};
require('../electron/main.cjs');
app.whenReady().then(async () => {
  const report = { ok: false };
  try {
    const win = BrowserWindow.getAllWindows()[0], wc = win.webContents;
    if (wc.isLoading()) await new Promise(resolve => wc.once('did-finish-load', resolve));
    await wc.executeJavaScript(`(async()=>{
      const t=window.paintTest={},$=t.$=s=>document.querySelector(s);
      t.wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      t.until=async(f,message,attempts=240)=>{for(let i=0;i<attempts;i++){if(await f())return;await t.wait(8);}throw Error(message+'; '+$('#toast')?.textContent);};
      t.assert=(value,message)=>{if(!value)throw Error(message);};
      const {state}=await import('./editor/state.js'); t.state=state;
      const {RecentModelHistory}=await import('./project/recent-model-history.js');
      const localNavigate=RecentModelHistory.prototype.navigate;
      t.previews=0;t.receipts=0;t.mismatches=0;
      RecentModelHistory.prototype.navigate=function(...args){
        const decorate=preview=>{
          if(!preview)return preview;t.previews++;const match=preview.matches;
          preview.matches=async data=>{
            const valid=await match(data);if(valid)t.receipts++;else t.mismatches++;return valid;
          };return preview;
        };
        const result=localNavigate.apply(this,args);return result?.then?result.then(decorate):decorate(result);
      };
      const {WebGLSceneRenderer}=await import('./render/webgl-renderer.js');
      const render=WebGLSceneRenderer.prototype.render;
      WebGLSceneRenderer.prototype.render=function(...args){if(this.canvas.id==='sceneCanvas')t.renderer=this;return render.apply(this,args);};
      const originalAtlas=WebGLSceneRenderer.prototype.setTextureAtlas, originalPatch=WebGLSceneRenderer.prototype.updateTextureAtlasRegion;
      t.atlas=document.createElement('canvas'); t.atlasCtx=t.atlas.getContext('2d',{willReadFrequently:true});
      WebGLSceneRenderer.prototype.setTextureAtlas=function(canvas,entries){if(this.canvas.id==='sceneCanvas'){t.entries=entries;t.atlas.width=canvas.width;t.atlas.height=canvas.height;t.atlasCtx.drawImage(canvas,0,0);}return originalAtlas.call(this,canvas,entries);};
      WebGLSceneRenderer.prototype.updateTextureAtlasRegion=function(canvas,x,y){if(this.canvas.id==='sceneCanvas'){t.atlasCtx.clearRect(x,y,canvas.width,canvas.height);t.atlasCtx.drawImage(canvas,x,y);}return originalPatch.call(this,canvas,x,y);};
      t.paint=await import('./paint/commit-order.js');t.core=await import('./common/core/texture-features.js');
      HTMLCanvasElement.prototype.setPointerCapture=HTMLElement.prototype.setPointerCapture=function(){};
      HTMLCanvasElement.prototype.hasPointerCapture=HTMLElement.prototype.hasPointerCapture=function(){return false;};
      t.pointer=(element,type,[x,y],modifiers={})=>element.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1,
        pointerType:'mouse',pointerId:1,bubbles:true,cancelable:true,...modifiers}));
      t.drag=(element,from,to=from,modifiers={})=>{t.pointer(element,'pointerdown',from,modifiers);t.pointer(element,'pointermove',to,modifiers);t.pointer(element,'pointerup',to,modifiers);};
      t.key=(key,modifiers={})=>(document.activeElement||document.body).dispatchEvent(
        new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...modifiers}));
      t.menu=(element,[clientX,clientY])=>{
        element.dispatchEvent(new MouseEvent('contextmenu',{clientX,clientY,button:2,bubbles:true,cancelable:true}));
        return [...$('#contextMenu').querySelectorAll('button[role="menuitem"]')];
      };
      await t.until(()=>!$('#startupCover'),'startup');
      const {configRegistry,ConfigKey,resolveUiLanguage}=await import('./common/config/app-config.js');
      t.assert(configRegistry.get(ConfigKey.LANGUAGE)==='system'&&document.documentElement.lang===resolveUiLanguage(),
        'default UI language follows the system');
      t.assert(getComputedStyle(document.documentElement).getPropertyValue('--ui-font').includes('system-ui')
        &&state.backgroundMode==='grid'&&state.paintSelectionSampling==='nearest','fresh profile defaults');
      const icon=(format)=>getComputedStyle($('[data-home-format="'+format+'"] .ui-mask-icon'));
      t.assert(icon('bedrock_entity').width==='33px'&&icon('bedrock_entity').maskImage.includes('bedrock-entity.svg'),'enlarged format icon');
      t.assert(icon('generic_model').maskImage.includes('reference-grid.svg')&&icon('image').maskImage.includes('image-format.svg'),'shared grid and image icons');
      t.assert(!$('[data-home-format="geckolib_animated_model"]')&&!$('[data-action="new"]')&&$('#newProjectTab'),'home creation entries');
      t.assert(getComputedStyle($('.mode-tab[data-mode="edit"] .ui-mask-icon')).maskImage.includes('cube.svg')
        &&getComputedStyle($('.mode-tab[data-mode="paint"] .ui-mask-icon')).maskImage.includes('brush.svg'),'workspace mode icons');
      $('[data-home-format="bedrock_entity"]').click();
      $('#sceneCanvas').focus();
      t.key('c');
      t.assert(state.project.elements.length===1&&state.project.elements[0].type==='cube','C creates a cube in Edit mode');
      t.key('c',{ctrlKey:true});
      t.assert(state.project.elements.length===1,'Ctrl+C should not create a cube');
      t.key('ArrowRight');t.assert(state.tool==='resize','right cycles to the next modelling tool');
      t.key('ArrowLeft');t.assert(state.tool==='move','left cycles to the previous modelling tool');
      t.pointer($('#sceneCanvas'),'pointermove',[320,240],{buttons:0});
      t.key('s');
      const shapeMenu=$('#shapeCreateMenu');
      t.assert(!shapeMenu.hidden&&shapeMenu.style.left==='320px'&&shapeMenu.style.top==='240px','S opens the Shape menu at the pointer');
      t.key('Escape');
      t.key('S',{ctrlKey:true,shiftKey:true});
      t.assert($('dialog.project-export-dialog[open]'),'Ctrl+Shift+S opens export');
      $('dialog.project-export-dialog').close('cancel');
      t.assert(!$('[data-action="addTextureGroup"]')&&getComputedStyle($('[data-action="addTexture"] .ui-mask-icon')).maskImage.includes('texture-import.svg'),'texture controls and icons');
      $('[data-action="createTexture"]').click();$('#textureCreateType').value='solid';
      $('#textureCreateWidth').value='1024';$('#textureCreateHeight').value='1024';$('#textureCreateColor').value='#ffffff';
      $('#textureCreateForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      await t.until(()=>state.textureAssets.length===1 && t.entries?.length,'initial atlas');
      t.journalId=$('.project-tab.active[data-project-tab]').dataset.projectTab;
      t.asset=()=>state.textureAssets[0];
      t.layer=()=>t.core.activeLayer(t.asset());
      t.layerSource=()=>t.layer()?.source;
      t.layerPixel=async ([x,y])=>Array.from((await t.core.loadRaster(t.layerSource())).getContext('2d').getImageData(x,y,1,1).data);
      t.atlasPixel=([x,y])=>{const entry=t.entries.find(row=>row.uid===t.asset()._uid);return Array.from(t.atlasCtx.getImageData(entry.x+x,entry.y+y,1,1).data);};
      t.screen=([x,y])=>{const box=$('#textureStage').getBoundingClientRect();return [box.left+(x+.5)*box.width/1024,box.top+(y+.5)*box.height/1024];};
      t.texture=$('#texturePreview');
      $('.mode-tab[data-mode="paint"]').click();
      for(let i=0;i<6;i++){
        $('[data-add-layer]').click();
        await t.until(()=>t.asset().layers?.length>=i+2 && t.core.layerRasterCache.has(t.layer()?.uid),'add layer '+i);
      }
      await t.wait(550);await window.cubeBricksDesktop.projectJournalState({journalId:t.journalId});
      t.key('s',{ctrlKey:true});
      await t.until(async()=> (await window.cubeBricksDesktop.listWorkspaceProjects({includeCovers:false}))
        .some(project=>project.journalId===t.journalId&&project.persistent),'Ctrl+S retains the working project');
      t.assert(!$('dialog.project-export-dialog[open]'),'Ctrl+S must route to project save');
    })()`);
    gate = new Promise(resolve => { release = resolve; });
    report.rapid = await wc.executeJavaScript(`(async()=>{
      const t=window.paintTest,{$,state}=t;
      t.points=[[64,64],[176,176],[288,288],[400,400],[512,512],[624,624]];
      t.base=t.layerSource();state.paintColor='#ff2500';state.paintBrushSize=3;
      for(const point of t.points)t.drag(t.texture,t.screen(point));
      if(t.paint.pendingPaintCommit(state.project))await t.paint.pendingPaintCommit(state.project);
      for(const point of t.points){
        const rgba=await t.layerPixel(point);
        t.assert(rgba[3]===255,'a rapid stroke was lost: '+JSON.stringify({point,rgba,atlas:t.atlasPixel(point),tool:state.tool,mode:state.mode,screen:t.screen(point),width:$('#textureCanvas').width,toast:$('#toast').textContent}));
        t.assert(t.atlasPixel(point)[0]===255&&t.atlasPixel(point)[1]===37,'live atlas lost a stroke');
      }
      const undo=[],redo=[],project=state.project;
      for(const point of [...t.points].reverse()){
        const start=performance.now();$('[data-action="undo"]').click();
        await t.until(()=>t.atlasPixel(point)[1]===255,'undo never reached the atlas');undo.push(performance.now()-start);
        t.assert((await t.layerPixel(point))[3]===0,'undo did not remove exactly one brush stroke');
        t.assert(state.project===project,'paint undo reconstructed geometry');
      }
      for(const point of t.points){
        const start=performance.now();$('[data-action="redo"]').click();
        await t.until(()=>t.atlasPixel(point)[1]===37,'redo never reached the atlas');redo.push(performance.now()-start);
      }
      const last=t.points.at(-1);$('[data-action="undo"]').click();
      await t.until(()=>t.atlasPixel(last)[1]===255,'branch undo');
      state.paintColor='#124cdd';t.branch=[728,728];t.drag(t.texture,t.screen(t.branch));
      if(t.paint.pendingPaintCommit(state.project))await t.paint.pendingPaintCommit(state.project);
      t.assert(t.atlasPixel(t.branch)[2]===221,'new paint after undo did not render');
      $('[data-action="undo"]').click();await t.until(()=>t.atlasPixel(t.branch)[1]===255,'undo new paint branch while disk is stopped');
      t.assert(t.atlasPixel(last)[1]===255,'discarded redo branch flashed back');
      $('[data-action="redo"]').click();await t.until(()=>t.atlasPixel(t.branch)[2]===221,'redo new paint branch');
      t.finalSource=t.layerSource();
      return {size:1024,layers:t.asset().layers.length,strokes:t.points.length,undo,redo,branched:true,previews:t.previews};
    })()`);
    gate = null;
    release();
    report.persisted = await wc.executeJavaScript(`(async()=>{
      const t=window.paintTest;
      await t.until(()=>t.receipts>=t.previews||t.mismatches,'complete all delayed paint history receipts',3000);
      t.assert(!t.mismatches,'durable history mismatch');
      const head=await window.cubeBricksDesktop.projectJournalState({journalId:t.journalId});
      const result=await window.cubeBricksDesktop.checkoutProjectJournal({journalId:t.journalId,sequence:head.activeHead});
      const asset=JSON.parse(result.content).textures[0];
      t.assert(asset.layers.find(layer=>layer.uid===t.layer().uid)?.source===t.finalSource,'durable brush history differs from the visible branch');
      return true;
    })()`);
    report.selection = await wc.executeJavaScript(`(async()=>{
      const t=window.paintTest,{$,state}=t;
      $('[data-tool="paintSelection"]').click();
      const source=t.points[0],dest=[source[0]+62,source[1]+47],last=[dest[0]+45,dest[1]-37];
      const select=()=>t.drag(t.texture,t.screen([source[0]-24,source[1]-24]),t.screen([source[0]+24,source[1]+24]));
      const red=point=>t.atlasPixel(point)[1]===37;
      const editableAlpha=point=>$('#textureCanvas').getContext('2d').getImageData(...point,1,1).data[3];
      select();
      t.assert(state.paintSelection.masks.get(t.asset()._uid).pixels[source[1]*1024+source[0]],'selection did not include the source pixel');
      const mask=state.paintSelection.masks.get(t.asset()._uid);
      const {selectionBounds}=await import('./paint/selection-transform.js');
      const box=selectionBounds(mask.pixels,mask.width,mask.height);
      const textureCursor=()=>getComputedStyle(t.texture).cursor;
      t.pointer(t.texture,'pointermove',t.screen([box.left-.5,box.top-.5]),{buttons:0});
      t.assert(textureCursor()==='nwse-resize','texture scale handle shows a diagonal resize cursor');
      const rotate=t.screen([box.right+.5,box.top-.5]);
      t.pointer(t.texture,'pointermove',rotate,{buttons:0});
      t.assert(textureCursor()==='grab','texture rotation handle shows a grab cursor');
      t.pointer(t.texture,'pointerdown',rotate);
      t.assert(textureCursor()==='grabbing','texture rotation handle changes cursor when held');
      t.pointer(t.texture,'pointercancel',rotate);
      t.assert(textureCursor()==='default','cancel restores the texture cursor');
      const unchanged=t.layerSource();t.drag(t.texture,t.screen(source));
      t.assert(t.layerSource()===unchanged,'click in the selection started a transform without drag');
      t.drag(t.texture,t.screen(source),t.screen(dest));
      await t.until(()=>red(dest)&&!red(source),'floating pixels in the scene atlas');
      t.assert(t.layerSource()===unchanged&&editableAlpha(source)===255&&editableAlpha(dest)===0,
        'floating preview changed editable pixels');
      t.assert(!state.paintSelection.active&&!state.paintSelection.masks.size&&$('#paintSelectionTextureOverlay').hidden,
        'lifted pixels left the selection overlay active');
      t.assert(!$('#textureLayerComposite').hidden&&$('#textureLayerComposite').getContext('2d').getImageData(...dest,1,1).data[1]===37,
        'floating preview did not reach the texture view');
      $('[data-action="undo"]').click();
      await t.until(()=>red(source)&&!red(dest),'undo cancels only the floating preview');
      t.assert(t.layerSource()===unchanged,'cancelling the preview undid an earlier stroke');
      select();
      t.drag(t.texture,t.screen(source),t.screen(dest));
      await t.until(()=>red(dest),'second floating transform');
      t.drag(t.texture,t.screen(dest),t.screen(last));
      await t.until(()=>red(last)&&!red(dest),'move the same lifted pixels again');
      t.drag(t.texture,t.screen([900,920]),t.screen([940,950]));
      t.assert(t.layerSource()===unchanged,'dragging empty space placed the floating pixels');
      t.drag(t.texture,t.screen([900,920]));
      if(t.paint.pendingPaintCommit(state.project))await t.paint.pendingPaintCommit(state.project);
      t.assert((await t.layerPixel(source))[3]===0&&(await t.layerPixel(last))[3]===255,'clicking empty space did not place the pixels');
      t.assert(!state.paintSelection.active,'placement restored the selection mask');
      $('[data-action="undo"]').click();
      await t.until(async()=>(await t.layerPixel(source))[3]===255,'undo transformed pixels');
      t.assert((await t.layerPixel(last))[3]===0,'one undo must restore both endpoints of placement');
      return {floatingPreview:true,repeatAdjustment:true,clickToPlace:true,undo:true};
    })()`);
    report.scene = await wc.executeJavaScript(`(async()=>{
      const t=window.paintTest,{$,state}=t,canvas=$('#sceneCanvas'),cube=state.project.elements[0];
      const {addOperator}=await import('./model.js');
      const names=['north','south','west','east','up','down'];
      const bounds=new Map(names.map((name,index)=>[name,[index*128,780,index*128+96,876]]));
      $('.mode-tab[data-mode="edit"]').click();
      cube.uvMode='per_face';cube.autoUv=false;
      cube.faces=Object.fromEntries(names.map(name=>[name,{uv:bounds.get(name),texture:t.asset()._uid,rotation:0}]));
      const field=$('[data-vector="position"][data-axis="0"]');field.value=String(cube.position[0]+.1);
      field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));field.blur();
      $('.mode-tab[data-mode="paint"]').click();$('[data-tool="brush"]').click();$('#paintSelectionClear').click();
      const world=(face,u,v)=>face.facePoints[0].map((value,axis)=>
        value+(face.facePoints[1][axis]-value)*u+(face.facePoints[2][axis]-value)*v);
      const scene=(face,u,v)=>{
        const p=t.renderer.projectPoint(world(face,u,v)),rect=canvas.getBoundingClientRect();return [p.x+rect.left,p.y+rect.top];
      };
      const picked=face=>{
        const p=t.renderer.projectPoint(world(face,.5,.5));
        return t.renderer.pickDetailed(state.project,p.x,p.y,true)?.faceName===face.faceName;
      };
      const quads=t.renderer.getCubeFaceQuads(cube.uid),direct=quads.find(picked);
      t.assert(direct,'no visible face');
      const partner=quads.find(face=>face.faceName===names[names.indexOf(direct.faceName)^1]);
      t.assert(partner&&!picked(partner),'symmetry test needs a different, hidden face');
      const axis=({north:'z',south:'z',west:'x',east:'x',up:'y',down:'y'})[direct.faceName];
      addOperator(cube,'paint_symmetry',{mode:'axes',axes:{x:axis==='x',y:axis==='y',z:axis==='z'},
        anchor:{position:cube.position.map((value,index)=>value+cube.size[index]/2),rotation:[0,0,0]}});
      const colorCount=async name=>{
        const [left,top,right,bottom]=bounds.get(name);
        const raster=await t.core.loadRaster(t.layerSource());
        const pixels=raster.getContext('2d').getImageData(left,top,right-left,bottom-top).data;
        let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])count++;
        return count;
      };
      state.paintBrushSize=3;state.paintColor='#dd21aa';state.paintScreenHeight=160;
      for(const u of [.35,.5,.65])t.drag(canvas,scene(direct,u,.5),scene(direct,u,.52),{ctrlKey:true});
      if(t.paint.pendingPaintCommit(state.project))await t.paint.pendingPaintCommit(state.project);
      const directCount=await colorCount(direct.faceName),mirrorCount=await colorCount(partner.faceName);
      t.assert(directCount>3&&mirrorCount>3,'screen brush missed the footprint on its hidden symmetric face: '+directCount+'/'+mirrorCount);
      $('[data-tool="paintSelection"]').click();
      state.paintSelectionSymmetry=true;
      const others=names.filter(name=>name!==direct.faceName&&name!==partner.faceName);
      const untouched=await Promise.all(others.map(colorCount));
      t.drag(canvas,scene(direct,.08,.08),scene(direct,.94,.94));
      await t.until(()=>$('#paintSelectionGesture').querySelectorAll('.selection-handle-icon').length===4,'four projected SVG transform handles');
      await t.until(()=>[...$('#paintSelectionGesture').querySelectorAll('.selection-handle-icon')].every(
        icon=>icon.complete&&icon.naturalWidth&&icon.getBoundingClientRect().width>0&&icon.style.transform.startsWith('matrix3d')),
        'coplanar SVG icons are visible and projected');
      const centerOf=element=>{const box=element.getBoundingClientRect();return [box.left+box.width/2,box.top+box.height/2];};
      const icons=$('#paintSelectionGesture').querySelectorAll('.selection-handle-icon');
      t.pointer(canvas,'pointermove',centerOf(icons[0]),{buttons:0});
      t.assert(getComputedStyle(canvas).cursor.endsWith('-resize'),'scene scale handle shows a projected resize cursor');
      const rotate=centerOf(icons[1]);
      t.pointer(canvas,'pointermove',rotate,{buttons:0});
      t.assert(getComputedStyle(canvas).cursor==='grab','scene rotation handle shows a grab cursor');
      t.pointer(canvas,'pointerdown',rotate);
      t.assert(getComputedStyle(canvas).cursor==='grabbing','scene rotation cursor follows the held handle');
      t.pointer(canvas,'pointercancel',rotate);
      t.assert(getComputedStyle(canvas).cursor==='crosshair','cancel restores the scene cursor');
      const mask=state.paintSelection.masks.get(t.asset()._uid),raster=await t.core.loadRaster(t.layerSource());
      const selectedCount=name=>{
        const [left,top,right,bottom]=bounds.get(name), width=right-left;
        const pixels=raster.getContext('2d').getImageData(left,top,width,bottom-top).data;
        let count=0;for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)
          if(mask.pixels[y*1024+x]&&pixels[((y-top)*width+x-left)*4+3])count++;
        return count;
      };
      const cut=[selectedCount(direct.faceName),selectedCount(partner.faceName)];
      t.assert(cut.every(count=>count>0),'3D selection did not cover either painted face');
      const menu=t.menu(canvas,scene(direct,.5,.5));
      t.assert(menu.length===3,'3D selection menu should only have clipboard commands');
      $('#contextMenu').hidden=true;
      const unchanged=t.layerSource();
      t.drag(canvas,scene(direct,.5,.5),scene(direct,1.55,.5));
      await t.until(()=>!state.paintSelection.active&&$('#paintSelectionGesture').querySelectorAll('.selection-handle-icon').length===4,
        '3D float clears the mask and keeps the handles');
      const [left,top,right,bottom]=bounds.get(direct.faceName);
      await t.until(()=>t.atlasPixel([(left+right)/2,(top+bottom)/2])[0]!==221,'3D lifted pixels leave the face in the preview');
      t.assert(t.layerSource()===unchanged,'3D pointerup placed the floating pixels');
      const rect=canvas.getBoundingClientRect();
      const blank=[[25,100],[rect.width-25,100],[25,rect.height-100]]
        .find(([x,y])=>!t.renderer.pickDetailed(state.project,x,y,true));
      t.assert(blank,'test could not find empty viewport space');
      t.drag(canvas,[rect.left+blank[0],rect.top+blank[1]]);
      if(t.paint.pendingPaintCommit(state.project))await t.paint.pendingPaintCommit(state.project);
      const after=[await colorCount(direct.faceName),await colorCount(partner.faceName)];
      t.assert(after[0]===directCount-cut[0]&&after[1]===mirrorCount-cut[1],
        '3D drag did not clip both faces: '+JSON.stringify({before:[directCount,mirrorCount],cut,after}));
      t.assert((await Promise.all(others.map(colorCount))).every((count,index)=>count===untouched[index]),'3D pixels escaped into a different face');
      return {face:direct.faceName,hiddenMirror:partner.faceName,directCount,mirrorCount,faceClip:true};
    })()`);
    report.pixelMenu = await wc.executeJavaScript(`(async()=>{
      const t=window.paintTest,{$,state}=t,source=[64,64],dest=[131,121],moved=[220,119];
      const select=point=>t.drag(t.texture,t.screen([point[0]-24,point[1]-24]),t.screen([point[0]+24,point[1]+24]));
      const menu=(point,count)=>{
        const items=t.menu(t.texture,t.screen(point));
        t.assert(items.length===count,'incorrect number of pixel menu commands: '+items.length);
        return items;
      };
      select(source);
      const originalLayer=t.layer().uid,originalSource=t.layerSource();
      menu(source,3)[0].click();
      await t.until(()=>{const items=t.menu(t.texture,t.screen(source));return items.length===3&&!items[2].disabled;},'copy pixels');
      menu(source,3)[1].click();
      await t.until(()=>!state.paintSelection.active,'duplicate in place picks up the copy');
      t.drag(t.texture,t.screen(source),t.screen(dest));
      await t.until(()=>t.atlasPixel(dest)[1]===37,'move the in-place copy');
      t.assert(t.layerSource()===originalSource,'moving a copy must remain a preview');
      const pasteNear=[dest[0]+12,dest[1]];
      menu(pasteNear,5)[2].click();
      await t.until(async()=>(await t.layerPixel(dest))[3]===255&&!t.paint.pendingPaintCommit(state.project),'paste places the previous floating patch');
      let pasted;
      await t.until(()=>{
        for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){
          const point=[pasteNear[0]+x,pasteNear[1]+y];
          if(t.atlasPixel(point)[1]===37){pasted=point;return true;}
        }
        return false;
      },'pasted pixels preview at the menu location');
      t.drag(t.texture,t.screen(pasted),t.screen(moved));
      await t.until(()=>t.atlasPixel(moved)[1]===37,'pasted pixels can be moved');
      const layerCount=t.asset().layers.length;
      menu(moved,5)[3].click();
      await t.until(()=>t.asset().layers.length===layerCount+1&&!t.paint.pendingPaintCommit(state.project),'move to new layer');
      const layers=t.asset().layers,index=layers.findIndex(layer=>layer.uid===originalLayer);
      t.assert(layers[index+1]===t.layer()&&(await t.layerPixel(moved))[3]===255,'new layer was not inserted directly above the source');
      $('[data-action="undo"]').click();
      await t.until(()=>t.asset().layers.length===layerCount,'undo new layer');
      await t.wait(90);
      select(dest);t.drag(t.texture,t.screen(dest),t.screen(moved));
      await t.until(()=>t.atlasPixel(moved)[1]===37,'lift placed pixels for deletion');
      menu(moved,5)[4].click();
      await t.until(async()=>(await t.layerPixel(dest))[3]===0&&!t.paint.pendingPaintCommit(state.project),'delete lifted pixels');
      t.assert((await t.layerPixel(source))[3]===255&&(await t.layerPixel(moved))[3]===0,'delete must only erase the lifted patch');
      return {copy:true,duplicate:true,paste:true,newLayer:true,delete:true};
    })()`);
    report.bucket = await wc.executeJavaScript(`(async()=>{
      const t=window.paintTest,{$,state}=t,outside=[940,930],face=[14,796];
      $('[data-tool="fill"]').click();
      state.paintColor='#12ab34';state.paintBucketScope='face';
      t.drag(t.texture,t.screen(outside));
      await t.until(async()=>(await t.layerPixel(outside))[1]===171&&!t.paint.pendingPaintCommit(state.project),'whole layer face fill');
      t.assert((await t.layerPixel(face))[1]===171,'2D face mode should fill the whole layer');
      state.paintColor='#9a55b9';state.paintBucketScope='element';
      t.drag(t.texture,t.screen(outside));
      await t.until(async()=>(await t.layerPixel(face))[1]===85&&!t.paint.pendingPaintCommit(state.project),'whole layer element fill');
      state.paintColor='#f36236';state.paintBucketScope='color';state.paintBucketSingleFace=true;
      t.drag(t.texture,t.screen(face));
      await t.until(async()=>(await t.layerPixel(face))[1]===98&&!t.paint.pendingPaintCommit(state.project),'color fill limited to a face');
      t.assert((await t.layerPixel(outside))[1]===85,'2D same-color fill should respect the face restriction');
      return {wholeLayerFace:true,wholeLayerElement:true,sameColorFaceLimit:true};
    })()`);
    report.shortcuts = await wc.executeJavaScript(`(async()=>{
      const t=window.paintTest,{$,state}=t,source=[300,315],target=[570,270],center=[512,512],moved=[700,640];
      const texture=t.texture,canvas=$('#sceneCanvas'),ctrl={ctrlKey:true},modelCount=state.project.elements.length;
      const select=point=>t.drag(texture,t.screen([point[0]-24,point[1]-24]),t.screen([point[0]+24,point[1]+24]));
      const blue=point=>t.atlasPixel(point)[1]===68;
      const settle=async()=>{if(t.paint.pendingPaintCommit(state.project))await t.paint.pendingPaintCommit(state.project);};
      $('[data-tool="paintSelection"]').click();
      t.key('ArrowRight');t.assert(state.tool==='brush','paint toolbar wraps to the first tool');
      state.paintColor='#2844f1';state.paintBrushSize=5;
      t.drag(texture,t.screen(source));await settle();
      await t.until(()=>blue(source),'prepare pixels for keyboard shortcuts');
      t.key('ArrowRight');t.assert(state.tool===state.paintShapeTool,'shape tool participates in toolbar cycling');
      $('[data-tool="paintSelection"]').click();select(source);
      const untouched=t.layerSource();
      $('#outlinerSearch').focus();t.key('x',ctrl);
      t.assert(t.layerSource()===untouched,'text input must keep its own clipboard shortcuts');
      texture.focus();t.key('c',ctrl);await t.wait(80);
      select(target);t.key('v',ctrl);
      await t.until(()=>blue(target),'Ctrl+C and Ctrl+V use pixel clipboard');
      canvas.focus();t.key('Delete');
      await t.until(()=>!blue(target),'Delete removes the pasted float');
      t.key('Delete');
      t.assert(state.project.elements.length===modelCount&&(await t.layerPixel(source))[1]===68,'paint Delete protects model elements');
      select(source);t.key('x',ctrl);
      await t.until(async()=> (await t.layerPixel(source))[3]===0&&!t.paint.pendingPaintCommit(state.project),'Ctrl+X cuts pixels');
      t.key('v',ctrl);
      let pasted;
      await t.until(()=>{
        for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){
          const point=[center[0]+x,center[1]+y];
          if(blue(point)){pasted=point;return true;}
        }
        return false;
      },'Ctrl+V pastes after cut cleared the selection');
      t.drag(texture,t.screen([900,920]));await settle();
      select(pasted);t.key('d',ctrl);
      await t.until(()=>!state.paintSelection.active,'Ctrl+D lifts the duplicate');
      t.drag(texture,t.screen(pasted),t.screen(moved));
      await t.until(()=>blue(moved),'Ctrl+D duplicate moves independently');
      t.key('Delete');
      await t.until(()=>!blue(moved),'Delete discards the duplicate');
      t.assert((await t.layerPixel(pasted))[1]===68,'deleting a floating duplicate keeps its placed source');
      select(pasted);
      t.pointer(texture,'pointerdown',t.screen(pasted));t.pointer(texture,'pointermove',t.screen(moved));
      await t.until(()=>blue(moved),'lift pixels with pointer held');
      t.key('Delete');
      await t.until(async()=> (await t.layerPixel(pasted))[3]===0&&!t.paint.pendingPaintCommit(state.project),'Delete cuts pixels during the drag');
      t.assert(!blue(moved)&&state.project.elements.length===modelCount,'Delete leaves no floating copy or scene deletion');
      return {copy:true,paste:true,cut:true,duplicate:true,deleteWhileDragging:true,modelProtected:true};
    })()`);
    report.preferences = await wc.executeJavaScript(`(async()=>{
      const t=window.paintTest,{$,state}=t;
      const mode=id=>$('.mode-tab[data-mode="'+id+'"]').click();
      const tool=id=>$('[data-tool="'+id+'"]').click();
      const space=id=>$('[data-transform-space="'+id+'"]').click();
      mode('edit');tool('move');t.assert(state.transformSpace==='self','Move defaults to local');space('global');
      tool('rotate');t.assert(state.transformSpace==='self','Move does not change Rotate');space('parent');
      tool('pivot');t.assert(state.transformSpace==='self','Rotate does not change Pivot');
      tool('move');t.assert(state.transformSpace==='global','Move remembers its space');tool('rotate');
      mode('paint');tool('fill');
      $('[data-panel="outliner"] [data-stack-panel="layers"]').click();
      const layers=$('[data-panel="layers"]');
      t.assert(!layers.classList.contains('is-stack-inactive'),'layers tab was selected');
      mode('edit');
      t.assert(state.tool==='rotate'&&state.transformSpace==='parent','returning to Edit restores Rotate and its own space');
      t.assert(layers.hidden&&!$('[data-panel="outliner"]').classList.contains('is-stack-inactive'),'Edit uses available dock fallback');
      mode('paint');
      t.assert(state.tool==='fill'&&!layers.classList.contains('is-stack-inactive'),'Paint restores tool and selected stacked dock');
      mode('edit');
      const first=$('.project-tab.active').dataset.projectTab;
      $('#newProjectTab').click();
      $('[data-home-format="bedrock_entity"]').click();
      t.assert(state.tool==='move','a second project gets its own tool');
      tool('pivot');mode('paint');tool('gradient');mode('edit');
      $('[data-project-tab="'+first+'"]').click();
      t.assert(state.tool==='rotate'&&state.transformSpace==='parent','project tab switch restores its tool');
      const stored=JSON.parse(localStorage.getItem('cubebricks.project-tools.'+t.journalId));
      t.assert(stored.edit==='rotate'&&stored.paint==='fill','project tool choices persisted separately by mode');
      const docks=JSON.parse(localStorage.getItem('cubebricks.dock-layout.v1'));
      t.assert(docks.layers.stackActive,'saved dock tab survives mode fallback');
      return {journalId:t.journalId,byMode:true,byProject:true,stackSelection:true,independentSpaces:true};
    })()`);
    await new Promise(resolve => {
      wc.once('did-finish-load', resolve);
      wc.reload();
    });
    report.reopened = await wc.executeJavaScript(`(async()=>{
      const $=s=>document.querySelector(s),{state}=await import('./editor/state.js');
      const {configRegistry,ConfigKey}=await import('./common/config/app-config.js');
      const until=async(f,message)=>{for(let i=0;i<250;i++){if(f())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error(message);};
      await until(()=>!$('#startupCover'),'startup after reload');
      const entry='[data-home-project="'+${JSON.stringify(report.preferences.journalId)}+'"]';
      if(!state.projectHomeActive)$('#newProjectTab').click();
      await until(()=>$(entry),'saved project appears on the start page after reload');
      $(entry).click();
      await until(()=>!state.projectHomeActive&&state.tool==='rotate','reopening restores the Edit tool');
      if(state.transformSpace!=='parent'||configRegistry.get(ConfigKey.MOVE_SPACE)!=='global')throw Error('coordinate systems did not persist');
      $('.mode-tab[data-mode="paint"]').click();
      if(state.tool!=='fill'||$('[data-panel="layers"]').classList.contains('is-stack-inactive'))throw Error('Paint preferences did not persist');
      const fps=$('#sceneFps'),canvas=$('#sceneCanvas');
      const {WebGLSceneRenderer}=await import('./render/webgl-renderer.js');
      const render=WebGLSceneRenderer.prototype.render;
      let draws=0;
      WebGLSceneRenderer.prototype.render=function(...args){
        if(this.canvas===canvas)draws++;
        return render.apply(this,args);
      };
      await until(()=>parseInt(fps.textContent,10)>0,'FPS appears in a static viewport');
      const idleDraws=draws;
      await new Promise(resolve=>setTimeout(resolve,1100));
      if(draws!==idleDraws||!(parseInt(fps.textContent,10)>0)||getComputedStyle(fps).pointerEvents!=='none')
        throw Error('FPS sampling must leave an idle viewport untouched');
      canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:1,bubbles:true,cancelable:true}));
      await until(()=>draws>idleDraws,'viewport still renders when zoom changes');
      return {projectTools:true,dockSelection:true,spaces:true,sceneFps:true};
    })()`);
    report.heldCommits = blocked;
    report.ok = true;
  } catch (error) { report.error = error.stack; }
  finally {
    gate = null;
    release?.();
    report.io = io;
    report.heldCommits = blocked;
  }
  fs.mkdirSync(path.resolve('build/performance'), { recursive: true });
  fs.writeFileSync(path.resolve('build/performance/paint-gestures.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(report.ok ? 0 : 1);
});
