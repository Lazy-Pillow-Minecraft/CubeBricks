// Full-app verification in a hidden window and an isolated temporary workspace.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-layer-commands-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.on('browser-window-created', (_event, win) => { win.hide(); win.webContents.setBackgroundThrottling(false); });
require('../electron/main.cjs');
app.whenReady().then(async () => {
  let report;
  try {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    if (contents.isLoading()) await new Promise(resolve => contents.once('did-finish-load', resolve));
    report = await contents.executeJavaScript(`(async()=>{
      const $=selector=>document.querySelector(selector),checks=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const check=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
      const until=async(test,message)=>{for(let i=0;i<150;i++){if(await test())return;await wait(30);}throw Error(message+'; '+($('#toast')?.textContent||''));};
      await until(()=>!$('#startupCover'),'startup');
      $('[data-home-format="bedrock_entity"]').click();$('[data-action="addCube"]').click();
      $('[data-action="createTexture"]').click();$('#textureCreateType').value='solid';
      $('#textureCreateWidth').value='4';$('#textureCreateHeight').value='4';
      $('#textureCreateForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      const {state}=await import('./editor/state.js');
      const core=await import('./common/core/texture-features.js');
      await until(()=>state.textureAssets.length===1,'create texture');$('.mode-tab[data-mode="paint"]').click();
      const asset=()=>state.textureAssets[0];
      const make=alpha=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=4;
        const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(4,4);
        for(let i=0;i<pixels.data.length;i+=4)pixels.data.set([160,80,40,i?alpha:0],i);
        ctx.putImageData(pixels,0,0);return canvas;};
      const ink=make(128),mask=make(255);
      asset().layers=[{uid:'ink',parentUid:'group',name:'Ink',source:ink.toDataURL(),opacity:100,blendMode:'normal',maskLayerUid:'mask'},
        {uid:'mask',parentUid:'group',name:'Mask',source:mask.toDataURL(),visible:false,opacity:100},
        {uid:'group',type:'group',name:'Group',opacity:60,visible:true}];
      asset().activeLayerUid='ink';
      for(const layer of asset().layers)if(layer.source)core.layerRasterCache.set(layer.uid,{canvas:layer.uid==='ink'?ink:mask,savedSource:layer.source});
      $('[data-open-layer-editor]').click();$('#layerEditorName').value='Ink edited';
      $('#layerEditorName').dispatchEvent(new Event('change',{bubbles:true}));
      await until(()=>$('[data-layer-row="group"]'),'render fixture layers');
      const menu=uid=>{const row=uid?$('[data-layer-row="'+uid+'"]'):$('#textureFeatureControls');
        row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:200}));
        return [...$('#contextMenu').querySelectorAll('button')];};
      const choose=(uid,labels)=>{const buttons=menu(uid),button=buttons.find(button=>labels.some(label=>button.textContent.includes(label)));
        check(Boolean(button)&&!button.disabled,'menu action is available: '+labels[0]);button.click();};
      menu('group');check($('#contextMenu').closest('dialog')?.id==='layerEditorDialog','the same context menu works inside the layer editor');
      const originalCount=asset().layers.length;
      choose('group',['就地复制图层','Duplicate Layer']);
      await until(()=>asset().layers.length===originalCount*2,'duplicate group');
      const copied=asset().layers.find(layer=>layer.type==='group'&&layer.uid!=='group');
      const children=asset().layers.filter(layer=>layer.parentUid===copied.uid),copiedInk=children.find(layer=>layer.name==='Ink edited');
      check(!copied.parentUid&&copied.opacity===60&&children.length===2,'duplicated group preserves its properties and sibling placement');
      check(copiedInk.maskLayerUid===children.find(layer=>layer.uid!==copiedInk.uid).uid,'duplicated group masks use new identities');
      choose('ink',['复制图层','Copy Layer']);
      choose(copied.uid,['粘贴图层','Paste Layer']);
      await until(()=>asset().layers.length===originalCount*2+1,'paste layer');
      const pasted=asset().layers.find(layer=>layer.uid===asset().activeLayerUid);
      check(pasted.uid!=='ink'&&pasted.parentUid===copied.uid,'copied layer pastes independently inside the target group');
      const before=asset().layers.find(layer=>layer.uid==='ink').source;
      const copiedSource=asset().layers.find(layer=>layer.uid===copiedInk.uid).source;
      const beforeRgb=[...core.layerRasterCache.get('ink').canvas.getContext('2d').getImageData(1,0,1,1).data].slice(0,3);
      choose('ink',['二值化透明度','Binarize Alpha']);
      await until(()=>asset().layers.find(layer=>layer.uid==='ink').source!==before,'binary alpha commit');
      const pixels=core.layerRasterCache.get('ink').canvas.getContext('2d').getImageData(0,0,4,4).data;
      check(pixels[3]===0&&pixels[7]===255,'transparent pixels stay transparent and nonzero alpha becomes opaque');
      check(beforeRgb.every((value,index)=>value===pixels[4+index]),'binarization retains the rendered RGB values');
      check(asset().layers.find(layer=>layer.uid===copiedInk.uid).source===copiedSource,'editing original alpha does not alter the duplicate');
      await wait(180);document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));
      const restoredAlpha=()=>{const layer=asset().layers.find(layer=>layer.uid==='ink'),cached=core.layerRasterCache.get('ink');
        return cached?.savedSource===layer?.source?cached.canvas.getContext('2d').getImageData(1,0,1,1).data[3]:null;};
      await until(()=>restoredAlpha()===128,'undo alpha');
      check(true,'alpha binarization is one reversible project operation');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));
      await until(()=>restoredAlpha()===255,'redo alpha');
      check(true,'redo restores binary alpha');
      choose(copied.uid,['二值化透明度','Binarize Alpha']);
      await until(()=>core.layerRasterCache.get(copiedInk.uid).canvas.getContext('2d').getImageData(1,0,1,1).data[3]===255,'group alpha');
      check(asset().layers.find(layer=>layer.uid===copied.uid).opacity===60,'group binarization preserves its hierarchy and opacity setting');
      $('#closeLayerEditor').click();await wait(50);
      const count=asset().layers.length;$('#textureFeatureControls').focus();
      $('#textureFeatureControls').dispatchEvent(new KeyboardEvent('keydown',{key:'d',ctrlKey:true,bubbles:true,cancelable:true}));
      await until(()=>asset().layers.length===count+1,'keyboard duplicate');
      check(state.project.elements.length===1,'layer shortcuts do not copy model elements');
      menu(asset().activeLayerUid);check(!$('#contextMenu').closest('dialog'),'context menu also works in the dock');

      const {createLayerCommands}=await import('./texture/layer-commands.js');
      const frames=await import('./common/core/frame-links.js');
      const blue=make(255);blue.getContext('2d').fillStyle='blue';blue.getContext('2d').fillRect(0,0,4,4);
      const a={_uid:'isolated-a',layers:[{uid:'isolated-ink',name:'Ink',source:ink.toDataURL()}],activeLayerUid:'isolated-ink'},
        b={_uid:'isolated-b',layers:[{uid:'isolated-base',name:'Base',source:blue.toDataURL()}],activeLayerUid:'isolated-base'};
      let active=a,finish=()=>{},history=[];const local={project:{},textureAssets:[a,b]};
      for(const entry of [a,b])core.layerRasterCache.set(entry.layers[0].uid,{canvas:entry===a?ink:blue,savedSource:entry.layers[0].source});
      const commands=createLayerCommands({state:local,activeTextureAsset:()=>active,textureCanvas:blue,
        finishLayerEdit:()=>finish(),pushTexturePaintHistory:(entry,_canvas,_group,operation)=>history.push({operation,layers:structuredClone(entry.layers)}),
        refreshLayeredTexture:async entry=>{entry.source=core.compositeLayers(entry).toDataURL();},onChange(){},toast(){}});
      const originalA=a.layers[0].source,originalB=b.layers[0].source;
      const copying=commands.copy();active=b;await copying;await commands.paste();
      check(a.layers[0].source===originalA&&b.layers[0].source===originalB&&b.layers.length===2,'switching textures during copy retains the clipboard and both original textures');
      check(b.layers[1].uid!==a.layers[0].uid,'cross-texture paste allocates independent pixels');
      b.animation={enabled:true,frames:[{uid:'isolated-frame',layerUids:['isolated-base']}]};
      await commands.paste({uid:'isolated-base'});
      check(frames.framePaintLayer(b)?.uid===b.activeLayerUid,'a pasted animation layer is linked to the current frame and immediately paintable');
      active=a;let resume;finish=()=>new Promise(resolve=>{resume=resolve;});
      const historyCount=history.length,pending=commands.binarizeAlpha();await wait(0);active=b;local.project={};resume();
      check(await pending===false&&a.layers[0].source===originalA&&history.length===historyCount,'a pending pixel command cannot mutate a different active texture or project');
      finish=()=>{};await commands.binarizeAlpha();const afterBinary=history.length;
      check(await commands.binarizeAlpha()===false&&history.length===afterBinary,'already binary alpha adds no redundant undo operation');
      return {ok:true,checks};
    })()`);
  } catch (error) { report = { ok: false, error: error.stack }; }
  const directory = path.resolve('build/performance'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'layer-commands.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(report.ok ? 0 : 1);
});
