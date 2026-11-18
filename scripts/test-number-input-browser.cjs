// Hidden Electron DOM regression checks; never controls the user's desktop.
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const testDirectory = process.env.CUBEBRICKS_NUMBER_TEST_DIRECTORY
  || require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'cubebricks-number-input-'));
const safeDirectory = path.resolve(testDirectory);
if (path.dirname(safeDirectory) !== path.resolve(os.tmpdir())
  || !path.basename(safeDirectory).startsWith('cubebricks-number-input-')) throw new Error('Invalid temporary test directory');

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env, CUBEBRICKS_NUMBER_TEST_DIRECTORY: safeDirectory };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['--no-sandbox', __filename], { env, stdio: 'inherit', windowsHide: true });
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', async code => {
    // Only remove our verified, uniquely created test directory, after Electron
    // and its profile handles have exited. Never use the editor's user profile.
    await fs.rm(safeDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    if (code) console.error(`Hidden number-input test exited with code ${code}.`);
    process.exitCode = code ?? 1;
  });
} else {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', safeDirectory);
  app.setPath('sessionData', safeDirectory);
  app.disableHardwareAcceleration();
  let window;
  app.whenReady().then(async () => {
    const fixture = path.join(safeDirectory, 'fixture.html');
    const css = pathToFileURL(path.resolve('src/screen/number-input/number-input.css')).href;
    const baseCss = pathToFileURL(path.resolve('src/styles.css')).href;
    const blockCss = pathToFileURL(path.resolve('src/screen/theme/blocks.css')).href;
    await fs.writeFile(fixture, `<html><head><link rel="stylesheet" href="${baseCss}"><link rel="stylesheet" href="${blockCss}"><link rel="stylesheet" href="${css}"><style>
      :root {--accent:#9061c9} input{width:80px;height:28px;box-sizing:border-box} .number-wrap{position:relative}
      .number-wrap b{position:absolute;left:5px;top:4px;font-size:10px}.number-wrap input{width:68px}
      #scroll{height:100px;overflow:auto}#space{height:500px}
      </style></head><body><input id="focus" value="keep focus"><div id="scroll" data-panel="inspector">
      <label class="number-wrap"><b>X</b><input id="position" type="number" step=".1" data-vector="position" data-numeric-live="input" value="0"></label>
      <input id="count" type="number" min="1" max="8" value="4"><input id="angle" type="number" data-vector="rotation" value="0">
      <input id="fps" type="number" min=".1" step=".1" value="20"><input id="duration" type="number" min="0" step="10" value="0">
      <input id="inflate" type="number" data-field="inflate" value="0"><input id="empty" type="number" min="3">
      <input id="disabled" type="number" disabled value="5"><input id="readonly" type="number" readonly value="5">
      <select id="select"><option>A</option><option disabled>B</option><optgroup disabled><option>C</option></optgroup><option>D</option></select>
      <div id="rebuild"></div><input id="limit" type="number" data-config-key="application.history-limit" value="60">
      <div id="space"></div></div><dialog id="modal" class="theme-dialog"><input id="modalNumber" type="number" value="10"></dialog></body></html>`);
    window = new BrowserWindow({ show: false, width: 900, height: 600 });
    await window.loadFile(fixture);
    const controller = pathToFileURL(path.resolve('src/screen/number-input/controller.js')).href;
    const sessions = pathToFileURL(path.resolve('src/common/core/numeric-edit-session.js')).href;
    const result = await window.webContents.executeJavaScript(`(async () => {
      const {bindNumberInputs} = await import(${JSON.stringify(controller)});
      const {claimNumericSnapshot,isNumericEditActive} = await import(${JSON.stringify(sessions)});
      let assertions=0;
      const equal=(a,b,message)=>{assertions++;if(a!==b)throw new Error(message+': '+a+' !== '+b)};
      const $=id=>document.getElementById(id);
      const project={};let snapshots=0, inputs=0, changes=0, parentWheels=0, otherKeys=0;
      let locked=null, deferLock=false, lockRequests=0;
      Object.defineProperty(document,'pointerLockElement',{get:()=>locked,configurable:true});
      document.documentElement.requestPointerLock=()=>{lockRequests++;if(!deferLock){locked=document.documentElement;document.dispatchEvent(new Event('pointerlockchange'))}return Promise.resolve()};
      document.exitPointerLock=()=>{locked=null;document.dispatchEvent(new Event('pointerlockchange'))};
      const clean=bindNumberInputs({getProject:()=>project,
        getSnapStep:e=>e.shiftKey&&e.ctrlKey ? .015625 : e.shiftKey ? .25 : e.ctrlKey ? 2 : 1,
        getAngleSnapStep:e=>e.ctrlKey ? 15 : 2.5});
      window.addEventListener('wheel',()=>parentWheels++);
      window.addEventListener('keydown',()=>otherKeys++);
      const wheel=(input,delta=-100,extra={})=>{const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:delta,...extra});input.dispatchEvent(e);return e};
      const down=(input,offset=40)=>{const r=input.getBoundingClientRect();input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:1,clientX:r.left+offset,clientY:r.top+10}))};
      const up=()=>document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,pointerId:1}));
      const move=(x,extra={})=>document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,cancelable:true,movementX:x,...extra}));
      $('position').addEventListener('input',()=>{inputs++;if(claimNumericSnapshot(project,'move'))snapshots++});
      $('position').addEventListener('change',()=>changes++);
      $('focus').focus();
      equal(getComputedStyle($('position')).paddingLeft,'28px','left arrow follows axis label');
      equal(getComputedStyle($('position')).paddingRight,'12px','space for right arrow');
      equal(getComputedStyle($('position')).backgroundImage.includes('svg'),true,'arrows are visible');
      equal(getComputedStyle($('position')).cursor,'text','normal text cursor before dragging');
      document.documentElement.dataset.themeStyle='blocks';
      equal(getComputedStyle($('position')).backgroundImage.includes('svg'),true,'block themes keep the arrows');
      delete document.documentElement.dataset.themeStyle;
      wheel($('position'));
      equal($('position').value,'1','hover wheel works without focus');
      equal(document.activeElement.id,'focus','hover wheel preserves existing focus');
      equal(parentWheels,0,'hover wheel does not scroll parent');
      wheel($('position'),-100,{shiftKey:true});equal($('position').value,'1.25','fine snap on wheel');
      equal($('position').validity.stepMismatch,false,'project snapping remains form-valid');
      wheel($('fps'),-100,{shiftKey:true});equal($('fps').value,'20.025','fractional local fine step');
      equal($('fps').validity.stepMismatch,false,'fine local values remain form-valid');
      wheel($('duration'),-100,{shiftKey:true});equal($('duration').value,'3','integer local fine step');
      equal($('duration').validity.stepMismatch,false,'local fine integers remain form-valid');
      wheel($('count'),-100,{shiftKey:true});equal($('count').value,'5','integer counts stay integral');
      wheel($('angle'),-100,{ctrlKey:true});equal($('angle').value,'15','angular snap');
      wheel($('empty'));equal($('empty').value,'3','mixed/empty value respects minimum');
      equal(wheel($('disabled')).defaultPrevented,false,'disabled fields do not capture wheel');
      equal(wheel($('readonly')).defaultPrevented,false,'read-only fields do not capture wheel');
      wheel($('select'),100);equal($('select').selectedIndex,3,'skip disabled option and optgroup');
      wheel($('select'),-100);equal($('select').selectedIndex,0,'select reverse');
      wheel($('select'),-100);equal($('select').selectedIndex,0,'do not wrap options');
      $('position').value='0';snapshots=0;changes=0;inputs=0;
      down($('position'),20);up();equal($('position').value,'-1','left axis-field button');
      down($('position'),65);up();equal($('position').value,'0','right button');
      equal(locked,null,'step button releases the pointer after the click');
      snapshots=0;changes=0;inputs=0;
      down($('position'));equal(isNumericEditActive(project),true,'hold undo session');
      equal(locked,document.documentElement,'press retains the working pointer-lock gesture');
      equal(document.querySelector('.numeric-drag-cursor').classList.contains('is-dragging'),false,'press keeps normal cursor appearance');
      move(2);equal(document.querySelector('.numeric-drag-cursor').classList.contains('is-dragging'),false,'tiny click movement keeps normal cursor');
      move(6);equal(locked,document.documentElement,'actual drag keeps the pointer locked');
      equal(document.querySelector('.numeric-drag-cursor').classList.contains('is-dragging'),true,'actual drag shows resize cursor');
      move(4);move(4,{shiftKey:true});
      equal($('position').value,'3.25','relative movement and live modifier changes');
      equal(inputs,3,'continuous input before mouse-up');equal(changes,0,'defer expensive commit during drag');
      equal(snapshots,1,'one snapshot for whole drag');
      const before=$('position').value;await new Promise(r=>setTimeout(r,50));
      equal($('position').value,before,'idle hold does not auto-repeat');
      const key=new KeyboardEvent('keydown',{key:'Alt',bubbles:true,cancelable:true});document.dispatchEvent(key);
      equal(key.defaultPrevented,true,'modifier does not switch tools during number drag');equal(otherKeys,0,'tool shortcut blocked');
      up();equal(changes,1,'one final change');equal(isNumericEditActive(project),false,'release undo session');
      equal(document.pointerLockElement,null,'pointer released');
      down($('position'));up();equal(document.activeElement.id,'position','ordinary click permits typed input');
      $('position').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true,ctrlKey:true}));
      equal($('position').value,'4','keyboard uses same grid');
      down($('count'));move(400);equal($('count').value,'8','drag max clamp');move(-4);equal($('count').value,'7','reverse immediately at bound');up();
      snapshots=0;
      function rebuild(value){$('rebuild').innerHTML='<input type="number" data-field="liveRebuild" value="'+value+'">';
        $('rebuild').firstChild.addEventListener('change',e=>{if(claimNumericSnapshot(project,'inflate'))snapshots++;rebuild(e.target.value)})}
      rebuild(0);down($('rebuild').firstChild);move(4);move(8);up();
      equal($('rebuild').firstChild.value,'3','drag survives DOM replacement');equal(snapshots,1,'redraw does not create extra undo steps');
      let commits=0;$('limit').addEventListener('change',()=>commits++);
      down($('limit'));move(8);move(4);equal(commits,0,'history trimming waits for mouse-up');up();equal(commits,1,'history limit committed once');
      $('modal').showModal();down($('modalNumber'));
      equal(getComputedStyle($('modalNumber')).backgroundImage.includes('svg'),true,'dialog styling keeps the arrows');
      equal($('modal').querySelector('.numeric-drag-cursor')!==null,true,'cursor is inside modal top layer');
      move(4);up();equal($('modalNumber').value,'11','dialog fields work');$('modal').close();
      deferLock=true;down($('count'),78);move(4);up();
      locked=document.documentElement;document.dispatchEvent(new Event('pointerlockchange'));
      equal(locked,null,'late pointer lock cannot trap the cursor');deferLock=false;
      deferLock=true;const countBefore=Number($('count').value);down($('count'),2);move(-4);
      document.dispatchEvent(new Event('pointerlockerror'));
      equal(Number($('count').value),countBefore-1,'denied lock preserves the applied delta');
      equal(isNumericEditActive(project),false,'denied lock releases edit session');deferLock=false;
      down($('position'));window.dispatchEvent(new Event('blur'));
      equal(isNumericEditActive(project),false,'window blur releases edit');equal(locked,null,'window blur releases pointer');
      const dynamic=document.createElement('input');dynamic.type='number';document.body.append(dynamic);await Promise.resolve();
      equal(dynamic.classList.contains('numeric-control'),true,'new controls automatically enhanced');
      equal(wheel(document.body).defaultPrevented,false,'background wheel unaffected');
      clean();equal(document.querySelector('.numeric-drag-cursor'),null,'cleanup removes cursor');
      return assertions;
    })()`);
    console.log(`Number input browser interactions passed (${result} assertions).`);
    window.destroy();
    await fs.unlink(fixture);
    app.exit(0);
  }).catch(async error => {
    console.error(error);
    window?.destroy();
    app.exit(1);
  });
}
