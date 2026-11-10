// Isolated Electron integration check; never opens the user's projects.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-frame-links-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const errors = [];
app.on('web-contents-created', (_event, contents) => contents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); }));
app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.setSize(1900, 1050);
  win.webContents.setBackgroundThrottling(false);
});
require('../electron/main.cjs');
app.whenReady().then(async () => {
  let report;
  try {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    if (contents.isLoading()) await new Promise(resolve => contents.once('did-finish-load', resolve));
    report = await contents.executeJavaScript(`(async()=>{
      const $=selector=>document.querySelector(selector),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const check=(value,message)=>{if(!value)throw Error(message);};
      const until=async(test,message)=>{for(let i=0;i<150;i++){if(await test())return;await wait(40);}throw Error(message);};
      await until(()=>!$('#startupCover'),'startup completes');
      $('[data-home-format="bedrock_entity"]').click();$('[data-action="addCube"]').click();
      $('[data-action="createTexture"]').click();$('#textureCreateType').value='solid';$('#textureCreateWidth').value='4';$('#textureCreateHeight').value='4';
      $('#textureCreateForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      const {state}=await import('./editor/state.js');
      const {layerRasterCache,compositeLayers,flipbookFrame,prepareLayers}=await import('./common/core/texture-features.js');
      const {activeTextureFrame,selectTextureFrame}=await import('./common/core/frame-links.js');
      await until(()=>state.textureAssets.length===1,'texture ready');$('.mode-tab[data-mode="paint"]').click();
      const asset=()=>state.textureAssets[0];
      function raster(color){const canvas=document.createElement('canvas');canvas.width=canvas.height=4;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,4,4);return canvas;}
      const red=raster('#ff0000'),blue=raster('#0000ff');
      asset().layers=[{uid:'red',name:'Red',source:red.toDataURL(),visible:true,opacity:100,blendMode:'normal'},
        {uid:'group',name:'Group',type:'group',visible:true,opacity:100,blendMode:'normal'},
        {uid:'blue',name:'Blue',source:blue.toDataURL(),parentUid:'group',visible:true,opacity:100,blendMode:'normal'}];
      asset().activeLayerUid='red';layerRasterCache.set('red',{canvas:red,savedSource:asset().layers[0].source});layerRasterCache.set('blue',{canvas:blue,savedSource:asset().layers[2].source});
      $('[data-add-layer-group]').click();await until(()=>$('[data-layer-row="blue"]'),'layer tree refreshed');
      $('[data-open-layer-editor]').click();await until(()=>$('#layerEditorDialog').open,'editor opens');await wait(80);
      check($('#textureFrameEditor').hidden,'frame panel hidden without Flipbook');
      check(!$('#textureFrameConnections [data-frame-port]'),'no ports without Flipbook');
      const layout=$('.layer-editor-layout'),columns=[...layout.children].slice(0,3),widths=columns.map(node=>node.getBoundingClientRect().width),baseWidth=$('#layerEditorDialog').getBoundingClientRect().width;
      function toggle(enabled){const input=$('[data-texture-animation]');input.checked=enabled;input.dispatchEvent(new Event('change',{bubbles:true}));}
      toggle(true);await until(()=>!$('#textureFrameEditor').hidden,'frame panel enabled');await wait(100);
      check($('#layerEditorDialog').getBoundingClientRect().width>baseWidth+300,'frame width is appended to the window');
      check(columns.every((node,index)=>Math.abs(node.getBoundingClientRect().width-widths[index])<2),'existing columns retain their widths');
      const gap=$('.texture-frame-gap').getBoundingClientRect().width,layerWidth=$('.layer-editor-list').getBoundingClientRect().width;
      check(Math.abs(gap-layerWidth*.5)<2,'connection space is half the layer-list width');
      $('#addTextureFrame').click();$('#addTextureFrame').click();
      const ids=asset().animation.frames.map(frame=>frame.uid);
      const port=(kind,uid)=>$('#textureFrameConnections [data-frame-port="'+kind+'"][data-port-uid="'+uid+'"]');
      const line=(frame,layer)=>$('#textureFrameConnections [data-frame-link="'+frame+'"][data-layer-link="'+layer+'"]');
      let pointerId=20;
      async function connect(kind,from,to){
        await until(()=>port(kind,from)&&port(kind==='layer'?'frame':'layer',to),'connection ports visible');
        const p=port(kind,from),r=p.getBoundingClientRect(),id=++pointerId;
        p.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:id,bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
        await wait(25);
        const target=port(kind==='layer'?'frame':'layer',to),bounds=target.getBoundingClientRect();
        document.dispatchEvent(new PointerEvent('pointermove',{pointerId:id,bubbles:true,cancelable:true,clientX:bounds.x+bounds.width/2,clientY:bounds.y+bounds.height/2}));
        target.dispatchEvent(new PointerEvent('pointerup',{pointerId:id,bubbles:true,clientX:bounds.x+bounds.width/2,clientY:bounds.y+bounds.height/2}));
        await wait(80);
      }
      await connect('layer','red',ids[0]);await connect('frame',ids[0],'group');await connect('layer','red',ids[1]);
      check(asset().animation.frames[0].layerUids.length===2&&asset().animation.frames[1].layerUids.length===1,'many-to-many links persist');
      const select=id=>$('#textureFrameList [data-texture-frame="'+id+'"]').click();
      select(ids[1]);await wait(80);
      const pixel=canvas=>[...canvas.getContext('2d').getImageData(0,0,1,1).data];
      check(pixel($('#layerEditorComposite')).join(',')==='255,0,0,255','selected frame shows only its connected red layer');
      check(pixel($('#textureLayerComposite')).join(',')==='255,0,0,255','2D/live texture uses the frame membership');
      select(ids[0]);await wait(80);check(pixel($('#layerEditorComposite')).join(',')==='0,0,255,255','connected group composites in layer order');
      check([...$('#textureFrameConnections').querySelectorAll('.texture-frame-link.active')].length===2,'frame selection highlights its links only');
      $('[data-layer-row="red"]').click();await wait(60);
      check([...$('#textureFrameConnections').querySelectorAll('.texture-frame-link.active')].length===2,'layer selection highlights links to both frames');
      $('[data-layer-row="group"]').click();await wait(60);
      check($('#textureFrameConnections').querySelectorAll('.texture-frame-link.active').length===1,'later layer click replaces frame highlighting');
      const hit=line(ids[0],'red'),distance=hit.getTotalLength(),point=hit.getPointAtLength(distance*.4);
      check(getComputedStyle(hit).pointerEvents==='stroke'&&getComputedStyle(hit).fill==='none','line hit area is stroke-only');
      check(hit.isPointInStroke(point)&&!hit.isPointInStroke(new DOMPoint(point.x,point.y+30)),'line hit region extends just a few pixels');
      const savedFrames=JSON.stringify(asset().animation.frames),savedLayers=JSON.stringify(asset().layers);
      toggle(false);await wait(80);check($('#textureFrameEditor').hidden&&!$('#textureFrameConnections [data-frame-port]'),'disable hides frames and connections');
      check(JSON.stringify(asset().animation.frames)===savedFrames&&JSON.stringify(asset().layers)===savedLayers,'disable retains frame links and all pixels');
      check(pixel($('#textureLayerComposite')).join(',')==='0,0,255,255','disable restores the normal complete composite');
      toggle(true);await wait(80);select(ids[0]);await wait(60);
      line(ids[0],'red').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await wait(80);
      check(!asset().animation.frames[0].layerUids.includes('red')&&asset().animation.frames[1].layerUids.includes('red'),'right click removes only the targeted link');
      await wait(700);
      $('#textureFrameList').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));
      await until(()=>asset().animation.frames[0].layerUids.includes('red'),'unlink can be undone');await wait(80);
      select(ids[0]);await wait(80);
      const before=asset().source;check(asset().layers.some(layer=>layer.uid==='blue'),'unconnected layers remain in the list/data');
      // A mask remains effective even if it is hidden and not a connected frame member.
      const shadow={...asset(),layers:[{uid:'paint',source:red.toDataURL(),visible:true,opacity:100,blendMode:'normal',maskLayerUid:'mask'},
        {uid:'mask',source:blue.toDataURL(),visible:false,opacity:50,blendMode:'normal'}],activeLayerUid:'paint',animation:{enabled:true,frames:[{uid:'masked',layerUids:['paint']}]}};
      layerRasterCache.set('paint',{canvas:red,savedSource:red.toDataURL()});layerRasterCache.set('mask',{canvas:raster('#ffffff'),savedSource:blue.toDataURL()});
      check(pixel(flipbookFrame(shadow,red))[3]===128,'unconnected hidden masks are still applied');
      const partial={...asset(),layers:asset().layers,animation:{enabled:true,frames:[{uid:'partial',layerUids:['red']}]}};
      const full=flipbookFrame(partial,compositeLayers(partial));red.getContext('2d').fillStyle='#00ff00';red.getContext('2d').fillRect(0,0,1,1);
      check(pixel(flipbookFrame(partial,compositeLayers(partial),{x:0,y:0,width:1,height:1})).join(',')==='0,255,0,255','dirty-pixel frame preview updates without a full composite');
      red.getContext('2d').fillStyle='#ff0000';red.getContext('2d').fillRect(0,0,1,1);
      check(asset().source===before,'frame selection/compositing does not rewrite original pixels');
      const entries=asset().animation.frames;
      asset().animation.frames=[...entries,...Array.from({length:30},(_,i)=>({uid:'scroll-frame-'+i,type:'frame',name:'Scroll '+i}))];
      $('#addTextureFrame').click();await wait(80);
      const secondBefore=port('frame',ids[1]).getBoundingClientRect().y;
      $('#textureFrameList').scrollTop=20;$('#textureFrameList').dispatchEvent(new Event('scroll'));await wait(60);
      check(Math.abs(secondBefore-port('frame',ids[1]).getBoundingClientRect().y-20)<2,'frame ports follow list scrolling');
      const layerScroller=$('#layerEditorListHost .texture-layer-panel-scroll');layerScroller.style.maxHeight='180px';await wait(50);
      layerScroller.scrollTop=30;layerScroller.dispatchEvent(new Event('scroll'));await wait(60);
      for(const dot of $('#textureFrameConnections').querySelectorAll('[data-frame-port="layer"]')){
        if(dot.dataset.portUid==='__all_layers__')continue;
        const row=$('[data-layer-row="'+dot.dataset.portUid+'"]'),a=row.getBoundingClientRect(),b=dot.getBoundingClientRect();
        check(Math.abs(a.right-(b.x+b.width/2))<2&&Math.abs(a.y+a.height/2-(b.y+b.height/2))<2,'layer ports stay on card border midpoints while scrolling');
      }
      layerScroller.style.maxHeight='';layerScroller.scrollTop=0;$('#textureFrameList').scrollTop=0;asset().animation.frames=entries;select(ids[0]);await wait(80);
      return {ok:true,checks:['conditional panel and ports','additive width and half-column gap','bidirectional many-to-many links','group composition and layer order','2D live preview','exclusive latest-selection highlighting','stroke-only hit testing','right-click disconnection','undo','retained data on disable','hidden mask sources','dirty-region preview','scrolling port alignment']};
    })()`);
    if (errors.length) throw Error(errors.join('\n'));
    const capture = await contents.capturePage();
    fs.mkdirSync(path.resolve('build/performance'), { recursive: true });
    fs.writeFileSync(path.resolve('build/performance/frame-connections.png'), capture.toPNG());
  } catch (error) { report = { ok: false, error: error.stack, errors }; }
  fs.mkdirSync(path.resolve('build/performance'), { recursive: true });
  fs.writeFileSync(path.resolve('build/performance/frame-connections.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(report.ok ? 0 : 1);
});
