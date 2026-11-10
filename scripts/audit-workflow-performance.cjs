const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-workflow-audit-'));
const suffix = process.argv.find(value => value.startsWith('--suffix='))?.slice(9).replace(/[^\w-]/g, '') || '';
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.on('browser-window-created', (_event, win) => { win.hide(); win.webContents.setBackgroundThrottling(false); });
require(path.resolve('electron/main.cjs'));
app.whenReady().then(async () => {
  let report;
  try {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    if (contents.isLoading()) await new Promise(resolve => contents.once('did-finish-load', resolve));
    report = await contents.executeJavaScript(`(async()=>{
      const {state}=await import('./editor/state.js'),{Cube}=await import('./model.js'),{layerRasterCache}=await import('./common/core/texture-features.js');
      const {RecentModelHistory}=await import('./project/recent-model-history.js');
      const discrepancies=[],originalNavigate=RecentModelHistory.prototype.navigate;
      const difference=(a,b,path='')=>{if(a===b)return null;if(!a||!b||typeof a!=='object'||typeof b!=='object')return {path,a,b};
        for(const key of new Set([...Object.keys(a),...Object.keys(b)])){const result=difference(a[key],b[key],path+'.'+key);if(result)return result;}return null;};
      RecentModelHistory.prototype.navigate=function(...args){const result=originalNavigate.apply(this,args);if(!result)return result;
        const match=result.matches;result.matches=data=>{const okay=match(data);if(!okay)discrepancies.push(['elements','groups','outliner'].map(key=>difference(result.data[key],data[key],key)).filter(Boolean));return okay;};return result;};
      const $=s=>document.querySelector(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async(f,message)=>{for(let i=0;i<800;i++){if(f())return;await wait(20);}throw Error(message+': '+$('#toast')?.textContent+' '+JSON.stringify(discrepancies).slice(0,4000));};
      await until(()=>!$('#startupCover'),'startup');$('[data-home-format="bedrock_entity"]').click();
      for(let i=0;i<999;i++)state.project.addElement(new Cube({position:[i%25*2,0,Math.floor(i/25)*2],size:[1,1,1]}));
      $('[data-action="addCube"]').click();await wait(2000);
      const uid=state.selectedUid,oldX=state.project.getNode(uid).position[0];
      const capture=window.cubeBricksPerf.capture(8000);
      const input=$('[data-vector="position"][data-axis="0"]');input.value=String(oldX+2);
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();
      const undo=[],redo=[];
      for(let i=0;i<4;i++){
        let start=performance.now();$('[data-action="undo"]').click();await until(()=>state.project.getNode(uid)?.position[0]===oldX,'undo result');undo.push(performance.now()-start);
        start=performance.now();$('[data-action="redo"]').click();await until(()=>state.project.getNode(uid)?.position[0]===oldX+2,'redo result');redo.push(performance.now()-start);
      }
      // Make an edit against an undo preview while earlier writes/navigations
      // may still be queued, then verify the durable branch matches the UI.
      $('[data-action="undo"]').click();await until(()=>state.project.getNode(uid)?.position[0]===oldX,'preview before branching');
      const branchInput=$('[data-vector="position"][data-axis="0"]');branchInput.value=String(oldX+5);
      branchInput.dispatchEvent(new Event('input',{bubbles:true}));branchInput.dispatchEvent(new Event('change',{bubbles:true}));branchInput.blur();
      $('[data-action="save"]').click();await until(()=>!state.dirty,'save after preview branch');
      const journalId=$('.project-tab.active[data-project-tab]').dataset.projectTab;
      const saved=await window.cubeBricksDesktop.projectJournalState({journalId});
      const persisted=JSON.parse((await window.cubeBricksDesktop.checkoutProjectJournal({journalId,sequence:saved.activeHead})).content);
      if(persisted.elements.find(cube=>cube.uid===uid)?.position[0]!==oldX+5)throw Error('preview branch was not persisted correctly');
      const performanceReport=await capture;
      $('[data-action="createTexture"]').click();$('#textureCreateType').value='solid';$('#textureCreateWidth').value='1024';$('#textureCreateHeight').value='1024';
      $('#textureCreateForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await until(()=>state.textureAssets.length===1,'texture');
      $('.mode-tab[data-mode="paint"]').click();await until(()=>$('[data-add-layer]'),'layer controls');
      for(let i=0;i<4;i++){$('[data-add-layer]').click();await wait(150);}
      const layerUids=state.textureAssets[0].layers.map(layer=>layer.uid);await wait(400);
      const before={cacheEntries:layerRasterCache.size,projectLayerEntries:layerUids.filter(uid=>layerRasterCache.has(uid)).length};
      $('[data-action="save"]').click();await until(()=>!state.dirty,'persistent save');
      const button=$('.project-tab.active [data-close-project-tab]');button.click();
      await until(()=>state.projectHomeActive,'close saved project');
      const retained=layerUids.map(uid=>layerRasterCache.get(uid)).filter(Boolean);
      const after={cacheEntries:layerRasterCache.size,retainedProjectLayers:retained.length,
        estimatedRgbaBytes:retained.reduce((sum,entry)=>sum+entry.canvas.width*entry.canvas.height*4,0)};
      return {ok:true,undoMs:undo,redoMs:redo,persistedPreviewBranch:true,summary:performanceReport.summary,slowEvents:performanceReport.slowEvents,layerCacheLifecycle:{before,after}};
    })()`);
  } catch(error) {report={ok:false,error:error.stack};}
  fs.mkdirSync(path.resolve('build/performance'),{recursive:true});
  fs.writeFileSync(path.resolve(`build/performance/audit-workflow-2026-11-05${suffix ? '-' + suffix : ''}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,summary:report.summary&&Object.fromEntries(Object.entries(report.summary).filter(([name])=>name.startsWith('journal.'))),slowEvents:undefined}));
  app.exit(report.ok?0:1);
});
