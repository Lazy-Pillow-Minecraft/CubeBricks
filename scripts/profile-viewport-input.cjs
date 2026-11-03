// Run with node_modules/electron/dist/electron.exe scripts/profile-viewport-input.cjs.
// Uses a separate profile and generated geometry; never opens the user's projects.
const { app, BrowserWindow, protocol, contentTracing } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { fileURLToPath } = require('node:url');

const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const duration = Math.max(2000, Math.min(30000, Number(option('duration', 8000)) || 8000));
const cubeCount = Math.max(1, Number(option('cubes', 1)));
const visible = option('visible', 'false') === 'true';
const tool = option('tool', 'move');
const scene = option('scene', 'cubes');
const settle = option('settle', 'false') === 'true';
const backgroundCubes = Math.max(0, Number(option('background-cubes', 0)));
const tracing = option('trace', 'false') === 'true';
const appArchive = option('app-archive', '');
const electronDirectory = appArchive ? path.join(path.resolve(appArchive), 'electron') : path.join(__dirname, '..', 'electron');
const accessibility = option('accessibility', 'default');
if (accessibility === 'on') app.commandLine.appendSwitch('force-renderer-accessibility');
if (accessibility === 'off') app.commandLine.appendSwitch('disable-renderer-accessibility');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-input-profile-'));
const output = path.resolve(option('output', path.join(profile, 'report.json')));
const legacySvg = option('legacy-svg', 'false') === 'true';
if (legacySvg) {
  const legacyModule = path.join(profile, 'legacy-svg-markup.js');
  fs.writeFileSync(legacyModule, 'export function syncSvgMarkup(root, markup) { root.innerHTML = markup; }');
  app.whenReady().then(() => protocol.interceptFileProtocol('file', (request, callback) => {
    const file = fileURLToPath(request.url.split('?')[0]);
    callback(file.endsWith(path.join('utils', 'dom', 'svg-markup.js')) ? legacyModule : file);
  }));
}
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, details) => {
    if (details.level === 'error' || details.level >= 2) errors.push(details.message);
  });
});
app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
});
require(path.join(electronDirectory, 'main.cjs'));
const { currentOperations } = require(path.join(electronDirectory, 'main-performance.cjs'));

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No application window');
    const contents = win.webContents;
    if (contents.isLoading()) await new Promise(resolve => contents.once('did-finish-load', resolve));
    win.setFocusable(false);
    if (visible) win.showInactive(); else win.hide();
    contents.focus();
    win.setTitle(`CubeBricks — input benchmark (${cubeCount} cubes)`);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await contents.executeJavaScript('!!window.cubeBricksPerf && !document.querySelector("#startupCover")')) break;
      await wait(100);
    }
    const bounds = await contents.executeJavaScript(`(async () => {
      const { syncSvgMarkup } = await import('./utils/dom/svg-markup.js');
      if (!${legacySvg}) {
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        syncSvgMarkup(svg,'<g data-id="first"><path d="M0,0 L1,1"/></g><g data-id="second"><circle r="4"/></g>');
        const [first,path,second,circle]=svg.querySelectorAll('*');
        svg.prepend(second);
        syncSvgMarkup(svg,'<g data-id="first"><path d="M0,0 L2,2"/></g><g data-id="second"><circle r="5"/></g>');
        if (path.getAttribute('d')!=='M0,0 L2,2' || circle.getAttribute('r')!=='5'
          || !svg.contains(first) || !svg.contains(second)) throw Error('SVG update replaced or mismatched controls');
        svg.replaceChildren();
        syncSvgMarkup(svg,'<g><circle r="6"/></g>');
        if (svg.querySelector('circle')?.getAttribute('r')!=='6') throw Error('SVG topology reset failed');
      }
      document.querySelector('[data-home-format="bedrock_entity"]').click();
      const { state } = await import('./editor/state.js');
      const { Cube } = await import('./model.js');
      if (${legacySvg}) for (const id of ['transformGizmo','locatorOverlay','mirrorGuideOverlay']) {
        const svg=document.getElementById(id); svg.removeAttribute('aria-hidden'); svg.setAttribute('aria-label',id);
      }
      for(let i=1;i<${cubeCount};i++) state.project.addElement(new Cube({
        position: [(i%20)*3, Math.floor(i/400)*3, Math.floor(i/20)%20*3], size:[2,2,2]
      }));
      document.querySelector('[data-action="addCube"]').click();
      if ('${scene}' === 'curve') {
        document.querySelector('[data-create-shape="bezier3d"]').click();
        state.selectedCurveNodeIndex = 1;
      }
      document.querySelector('[data-tool="${tool}"]')?.click();
      const r=document.querySelector('#sceneCanvas').getBoundingClientRect();
      return {x:Math.round(r.x+r.width*.3),y:Math.round(r.y+r.height*.5),width:r.width,height:r.height};
    })()`);
    await wait(1200);
    contents.sendInputEvent({ type:'mouseDown', x:bounds.x, y:bounds.y, button:'middle', clickCount:1 });
    let previous = performance.now();
    const started = previous, generatedGaps = [];
    let generated = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      if (now - previous > 30) generatedGaps.push({at:performance.timeOrigin+now,ms:now-previous});
      previous = now; generated++;
      const t = (now-started)/1000;
      contents.sendInputEvent({ type:'mouseMove', button:'middle', modifiers:['middlebuttondown'],
        x:Math.round(bounds.x+Math.sin(t*2)*bounds.width*.22),
        y:Math.round(bounds.y+Math.sin(t*1.3)*bounds.height*.12) });
    }, 8);
    // Warm up the moving overlays, shaders and input path before measuring.
    await wait(4000);
    if (settle) {
      for (let attempt=0;attempt<300 && currentOperations().some(entry=>entry.name.startsWith('project:'));attempt++) await wait(100);
      await wait(500);
    }
    let background = null, backgroundTimer = null, backgroundPending = null, backgroundCommits = 0;
    if (backgroundCubes) {
      const { WorkerProjectJournal } = require(path.join(electronDirectory, 'journal-service.cjs'));
      background = new WorkerProjectJournal(path.join(profile, 'background-journal'));
      const data = {name:'background',elements:Array.from({length:backgroundCubes},(_,i)=>({
        type:'cube',uid:`background_${i}`,position:[i,0,0],size:[2,2,2],pivot:[0,0,0],rotation:[0,0,0]
      })),groups:[],textures:[]};
      await background.initialize(JSON.stringify(data), 'core.project.create');
      backgroundTimer = setInterval(() => {
        if (backgroundPending) return;
        backgroundCommits++;
        for (const node of data.elements) node.position[1] = backgroundCommits;
        backgroundPending = background.commit(JSON.stringify(data),'core.element.move')
          .catch(error=>errors.push(error.message)).finally(()=>{backgroundPending=null;});
      },400);
    }
    if (tracing) await contentTracing.startRecording({
      included_categories: ['toplevel','blink','devtools.timeline','v8','disabled-by-default-devtools.timeline',
        'disabled-by-default-v8.gc','accessibility'], recording_mode: 'record-until-full'
    });
    const capture = contents.executeJavaScript(`window.cubeBricksPerf.capture(${duration})`);
    generatedGaps.length = 0; generated = 0;
    const report = await capture;
    if (backgroundTimer) clearInterval(backgroundTimer);
    report.cameraState = await contents.executeJavaScript(`import('./editor/state.js').then(({state})=>({drag:state.dragging?.type,tool:state.tool,yaw:state.yaw,pitch:state.pitch,selected:state.selectedUid}))`);
    if (report.cameraState.drag !== 'orbit' || !report.summary['scene.cameraFrameInterval'])
      errors.push('Camera drag did not remain active throughout the capture.');
    clearInterval(timer);
    contents.sendInputEvent({ type:'mouseUp', x:bounds.x, y:bounds.y, button:'middle', clickCount:1 });
    report.generatedInput = {count:generated,gaps:generatedGaps};
    report.background = {cubeCount:backgroundCubes,commits:backgroundCommits};
    report.test = {cubeCount,tool,scene,visible,accessibility,legacySvg,profile,electron:process.versions.electron,chromium:process.versions.chrome,errors};
    fs.mkdirSync(path.dirname(output), {recursive:true});
    fs.writeFileSync(output, JSON.stringify(report,null,2));
    if (tracing) await contentTracing.stopRecording(output.replace(/\.json$/,'.trace.json'));
    if (backgroundPending) await backgroundPending;
    if (background) await background.dispose();
    console.log(JSON.stringify({output,summary:report.summary,mainProcess:report.mainProcess,generatedInput:report.generatedInput,errors}));
    app.exit(errors.length ? 1 : 0);
  } catch(error) { console.error(error); app.exit(1); }
});
