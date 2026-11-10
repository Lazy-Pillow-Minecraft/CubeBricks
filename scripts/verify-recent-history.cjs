// Hidden full-app test. Deliberately stop durable commits; model and pixel undo
// must still update before the stop is released. Uses only a disposable profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-recent-history-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
});
const { WorkerProjectJournal } = require('../electron/journal-service.cjs');
const originalCommit = WorkerProjectJournal.prototype.commit;
let blocked = false, release, gate, heldCommits = 0;
function stopWrites() {
  blocked = true;
  gate = new Promise(resolve => { release = resolve; });
}
function resumeWrites() {
  blocked = false;
  release?.();
}
WorkerProjectJournal.prototype.commit = async function (...args) {
  if (blocked) {
    heldCommits++;
    await gate;
  }
  return originalCommit.apply(this, args);
};
require('../electron/main.cjs');
app.whenReady().then(async () => {
  const report = { ok: false };
  try {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    if (contents.isLoading()) await new Promise(resolve => contents.once('did-finish-load', resolve));
    await contents.executeJavaScript(`(async()=>{
      window.undoTest={};const test=window.undoTest;
      test.$=s=>document.querySelector(s);test.wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      test.until=async(f,message)=>{for(let i=0;i<250;i++){if(await f())return;await test.wait(20);}throw Error(message+'; '+test.$('#toast')?.textContent);};
      test.check=(value,message)=>{if(!value)throw Error(message);};
      const {state}=await import('./editor/state.js');test.state=state;
      const {RecentModelHistory}=await import('./project/recent-model-history.js');test.previews=0;test.mismatches=[];
      const navigate=RecentModelHistory.prototype.navigate;
      RecentModelHistory.prototype.navigate=function(...args){
        const decorate=result=>{if(!result)return result;test.previews++;
          const matches=result.matches;result.matches=async data=>{const okay=await matches(data);if(!okay)test.mismatches.push({expected:result.data,actual:data});return okay;};return result;};
        const result=navigate.apply(this,args);return result?.then?result.then(decorate):decorate(result);
      };
      await test.until(()=>!test.$('#startupCover'),'startup');test.$('[data-home-format="bedrock_entity"]').click();
      const {Cube}=await import('./model.js');
      for(let i=0;i<999;i++)state.project.addElement(new Cube({position:[i%25*2,0,Math.floor(i/25)*2],size:[1,1,1]}));
      test.$('[data-action="addCube"]').click();test.uid=state.selectedUid;test.x=state.project.getNode(test.uid).position[0];
      test.journalId=test.$('.project-tab.active[data-project-tab]').dataset.projectTab;
      await test.wait(650);await window.cubeBricksDesktop.projectJournalState({journalId:test.journalId});
    })()`);
    stopWrites();
    report.model = await contents.executeJavaScript(`(async()=>{
      const t=window.undoTest,{state,$}=t;
      const input=$('[data-vector="position"][data-axis="0"]');input.value=String(t.x+3);
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();
      let start=performance.now();$('[data-action="undo"]').click();
      await t.until(()=>state.project.getNode(t.uid).position[0]===t.x,'undo while disk queue blocked');const undoMs=performance.now()-start;
      start=performance.now();$('[data-action="redo"]').click();
      await t.until(()=>state.project.getNode(t.uid).position[0]===t.x+3,'redo while disk queue blocked');const redoMs=performance.now()-start;
      t.check(undoMs<250&&redoMs<250,'nearby model state waited for disk');
      return {cubes:state.project.elements.length,undoMs,redoMs,previews:t.previews};
    })()`);
    resumeWrites();
    report.model.persisted = await contents.executeJavaScript(`(async()=>{
      const t=window.undoTest;await t.wait(400);const head=await window.cubeBricksDesktop.projectJournalState({journalId:t.journalId});
      const data=JSON.parse((await window.cubeBricksDesktop.checkoutProjectJournal({journalId:t.journalId,sequence:head.activeHead})).content);
      t.check(data.elements.find(cube=>cube.uid===t.uid).position[0]===t.x+3,'durable model head disagrees');
      t.$('[data-action="createTexture"]').click();t.$('#textureCreateType').value='solid';t.$('#textureCreateWidth').value='16';t.$('#textureCreateHeight').value='16';
      t.$('#textureCreateForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      await t.until(()=>t.state.textureAssets.length===1,'texture');t.$('.mode-tab[data-mode="paint"]').click();
      t.core=await import('./common/core/texture-features.js');
      t.$('[data-add-layer]').click();
      await t.until(()=>t.core.layerRasterCache.has(t.state.textureAssets[0].activeLayerUid),'active layer ready');
      await t.wait(650);await window.cubeBricksDesktop.projectJournalState({journalId:t.journalId});return true;
    })()`);
    stopWrites();
    report.texture = await contents.executeJavaScript(`(async()=>{
      const t=window.undoTest,{state,$}=t,project=state.project,asset=state.textureAssets[0];
      const before=asset.layers.length;t.$('[data-add-layer]').click();await t.until(()=>asset.layers.length===before+1,'add layer');
      const afterSource=asset.source;
      let start=performance.now();$('[data-action="undo"]').click();
      await t.until(()=>state.textureAssets[0].layers.length===before,'layer undo while disk blocked');const undoMs=performance.now()-start;
      t.check(state.project===project,'pixel/layer undo rebuilt the entire model');
      start=performance.now();$('[data-action="redo"]').click();
      await t.until(()=>state.textureAssets[0].layers.length===before+1,'layer redo while disk blocked');const redoMs=performance.now()-start;
      t.check(state.project===project,'pixel/layer redo rebuilt the entire model');
      const layer=state.textureAssets[0].layers.at(-1),raster=await t.core.loadRaster(layer.source);
      t.check(raster.width===16&&raster.height===16,'restored layer dimensions');
      return {undoMs,redoMs,modelReused:true,previews:t.previews};
    })()`);
    resumeWrites();
    report.texture.persisted = await contents.executeJavaScript(`(async()=>{
      const t=window.undoTest;await t.wait(400);const head=await window.cubeBricksDesktop.projectJournalState({journalId:t.journalId});
      t.check(!t.mismatches.length,'cache validation mismatch '+JSON.stringify(t.mismatches).slice(0,4000));
      const data=JSON.parse((await window.cubeBricksDesktop.checkoutProjectJournal({journalId:t.journalId,sequence:head.activeHead})).content);
      t.check(data.textures[0].layers.length===t.state.textureAssets[0].layers.length,'durable layers disagree');return true;
    })()`);
    report.heldCommits = heldCommits;
    report.ok = true;
  } catch (error) { report.error = error.stack; }
  finally { resumeWrites(); }
  fs.mkdirSync(path.resolve('build/performance'), { recursive: true });
  fs.writeFileSync(path.resolve('build/performance/recent-history.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(report.ok ? 0 : 1);
});
