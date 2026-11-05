const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-java-rotation-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.on('browser-window-created', (_event, win) => { win.hide(); win.webContents.setBackgroundThrottling(false); });
require(path.resolve('electron/main.cjs'));
app.whenReady().then(async () => {
  let report;
  try {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    if (contents.isLoading()) await new Promise(resolve => contents.once('did-finish-load', resolve));
    report = await contents.executeJavaScript(`(async()=>{
      const {state}=await import('./editor/state.js'),{exportBlockbench,importBlockbench}=await import('./model.js');
      const checks=[],check=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const until=async(f,message)=>{for(let i=0;i<200;i++){if(f())return;await wait(30);}throw Error(message);};
      const $=selector=>document.querySelector(selector);
      await until(()=>!$('#startupCover'),'startup');
      $('[data-home-format="java_block_item"]').click();$('[data-action="addCube"]').click();
      const cube=state.project.elements[0];
      Object.assign(cube,{position:[2,3,4],size:[2,3,4],pivot:[6,8,10],rotation:[0,0,0]});
      $('[data-tool="rotate"]').click();
      await until(()=>$('[data-vector="rotation"][data-axis="1"]'),'rotation inspector');
      const input=$('[data-vector="rotation"][data-axis="1"]');input.focus();
      const edit=value=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
      edit(90);
      check(cube.rotation.every(value=>value===0)&&cube.size.join(',')==='4,3,2','90 degree input folds into dimensions once across input/change events');
      edit(180);
      check(cube.rotation.every(value=>value===0)&&cube.size.join(',')==='2,3,4'&&cube.position.join(',')==='8,3,12','successive numeric edits use the initial geometry instead of accumulating rolls');
      input.blur();check(Number(input.value)===0,'leaving the field displays the folded residual angle');
      for(const [version,saved]of[['1.9-1.21.5','1.9.0'],['1.21.6-1.21.10','1.21.6'],['1.21.11+','1.21.11']]){
        state.project.formatData.javaBlockVersion=version;const bb=exportBlockbench(state.project);
        check(bb.java_block_version===saved&&importBlockbench(bb).formatData.javaBlockVersion===version,'bbmodel retains version '+saved);
      }
      return {ok:true,checks};
    })()`);
  } catch (error) { report = { ok: false, error: error.stack }; }
  fs.mkdirSync(path.resolve('build/performance'), { recursive: true });
  fs.writeFileSync(path.resolve('build/performance/java-rotation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(report.ok ? 0 : 1);
});
