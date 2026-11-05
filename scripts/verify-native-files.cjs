const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-native-ui-')), output = path.join(profile, 'exports');
fs.mkdirSync(output); app.setPath('userData', profile); app.setPath('sessionData', profile);
const picks = [], errors = []; let serial = 0, cancelNext = false, lastModel = null;
dialog.showSaveDialog = async options => {
  const name = path.basename(options.defaultPath || 'output'), extension = path.extname(name);
  picks.push(extension);
  if (cancelNext) { cancelNext = false; return { canceled: true }; }
  const filePath = path.join(output, extension === '.png' ? `${++serial}_${name}` : name);
  if (extension === '.json' || extension === '.java') lastModel = filePath;
  return { canceled: false, filePath };
};
dialog.showOpenDialog = async () => ({ canceled: !lastModel, filePaths: lastModel ? [lastModel] : [] });
app.on('browser-window-created', (_event, win) => { win.hide(); win.setSize(1800, 1000); win.webContents.setBackgroundThrottling(false); });
app.on('web-contents-created', (_event, contents) => contents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); }));
const archive = process.argv.find(value => value.startsWith('--app-asar='))?.slice('--app-asar='.length);
require(path.join(archive ? path.resolve(archive) : path.resolve('.'), 'electron/main.cjs'));
app.whenReady().then(async () => {
  const checks = []; let report;
  const check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  try {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    if (contents.isLoading()) await new Promise(resolve => contents.once('did-finish-load', resolve));
    const setup = `const $=s=>document.querySelector(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async(f,m)=>{for(let i=0;i<200;i++){if(await f())return;await wait(30);}throw Error(m);};
      const check=(value,message)=>{if(!value)throw Error(message);}; const {state}=await import('./editor/state.js');`;
    await contents.executeJavaScript(`(async()=>{${setup}
      await until(()=>!$('#startupCover'),'startup');$('[data-home-format="java_block_item"]').click();$('[data-action="addCube"]').click();
      $('[data-action="createTexture"]').click();$('#textureCreateType').value='solid';$('#textureCreateWidth').value='16';$('#textureCreateHeight').value='16';
      $('#textureCreateForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await until(()=>state.textureAssets.length===1,'create texture');
      const asset=state.textureAssets[0],cube=state.project.elements[0];cube.uvMode='face';cube.faces=Object.fromEntries(['north','south','east','west','up','down'].map(face=>[face,{texture:asset._uid,uv:[0,0,2,2]}]));
      await until(()=>$('[data-save-texture]')&&!$('[data-save-texture]').hidden,'unsaved indicator');$('[data-save-texture]').click();
      await until(()=>asset.externalFile?.path&&$('[data-save-texture]').hidden,'independent save completes');
      $('[data-action="export"]').click();await until(()=>$('.project-export-dialog'),'format window');$('.project-export-dialog button[value="json"]').click();
      await until(()=>asset.externalFile?.exportPath,'JSON export completed');
    })()`);
    check(picks.join(',') === '.png,.png,.json', 'standalone PNG saves independently; native export saves PNG before asking for JSON');
    const jsonPath = lastModel, json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    check(json.elements.length === 1 && json.textures[0].startsWith('minecraft:'), 'actual export writes native Java JSON and a resource namespace');
    const references = JSON.parse(fs.readFileSync(`${jsonPath}.cbtextures.json`, 'utf8'));
    check(references.textures[0].relative_path.endsWith('.png') && !references.textures[0].path, 'texture index uses relative paths for relocation');
    await contents.executeJavaScript(`(async()=>{${setup}
      const old=state.project;$('[data-action="open"]').click();await until(()=>state.project!==old,'open native JSON');await until(()=>state.textureAssets[0]?.externalFile?.fingerprint,'imported texture baseline');
      check(state.project.formatId==='java_block_item','native format detection');check($('[data-save-texture]').hidden,'unchanged imported texture is clean');
      state.project.formatId='modded_entity';state.project.modelType='modded_entity';state.project.uvMode='box';
      const asset=state.textureAssets[0],cube=state.project.elements[0];cube.uvMode='box';cube.autoUv=true;cube.rotation=[0,0,0];cube.uv=[.5,.5];
      cube.faces=Object.fromEntries(['north','south','east','west','up','down'].map(face=>[face,{texture:asset._uid}]));
      delete asset.externalFile.exportPath;
      $('[data-action="export"]').click();await until(()=>$('.project-export-dialog'),'Java format window');
      check(!$('.project-export-dialog button[value="json"]'),'modded entity does not offer JSON');$('.project-export-dialog button[value="java"]').click();
      await until(()=>asset.externalFile.exportPath,'Java export completed');
    })()`);
    check(picks.at(-2) === '.png' && picks.at(-1) === '.java', 'modded export replaces the JSON choice with Java and still saves textures first');
    const javaPath = lastModel, java = fs.readFileSync(javaPath, 'utf8');
    check(java.includes('LayerDefinition createBodyLayer()') && java.includes('CubeBricks-SHA256:'), 'actual Java file contains a model layer and integrity metadata');
    await contents.executeJavaScript(`(async()=>{${setup}
      const old=state.project;$('[data-action="open"]').click();await until(()=>state.project!==old,'Java reimport');
      check(state.project.formatId==='modded_entity'&&state.project.elements.length===1,'unchanged Java roundtrip');
    })()`);
    check(true, 'unchanged exported Java reopens through the application file dialog');
    fs.writeFileSync(javaPath, java.replace('createBodyLayer', 'editedLayer'));
    const error = await contents.executeJavaScript(`window.cubeBricksDesktop.openProject(${JSON.stringify(javaPath)}).then(()=>null,error=>error.message)`);
    check(error?.includes('已被修改'), 'modified exported Java is rejected before importing geometry');
    const count = picks.length; cancelNext = true;
    await contents.executeJavaScript(`(async()=>{${setup}
      $('[data-action="export"]').click();await until(()=>$('.project-export-dialog'),'cancel export');$('.project-export-dialog button[value="java"]').click();await wait(250);
    })()`);
    check(picks.length === count + 1 && picks.at(-1) === '.png', 'canceling texture saving aborts before any model filename is requested');
    const pngPath = path.join(path.dirname(jsonPath), references.textures[0].relative_path), pngData = fs.readFileSync(pngPath).toString('base64');
    const originalPng = fs.readFileSync(pngPath), text = Buffer.from('Comment\0CubeBricks pixel-fingerprint verification');
    const chunk = Buffer.alloc(text.length + 12); chunk.writeUInt32BE(text.length); chunk.write('tEXt', 4); text.copy(chunk, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
    const equivalentPng = Buffer.concat([originalPng.subarray(0, -12), chunk, originalPng.subarray(-12)]).toString('base64');
    await contents.executeJavaScript(`(async()=>{
      const {textureSaveFingerprint}=await import('./texture/save-state.js');
      const left=await textureSaveFingerprint({source:'data:image/png;base64,'+${JSON.stringify(pngData)}});
      const right=await textureSaveFingerprint({source:'data:image/png;base64,'+${JSON.stringify(equivalentPng)}});
      if(left!==right)throw Error('Equivalent PNG encodings changed save state');
    })()`);
    check(true, 'background save fingerprints compare pixels rather than differing PNG encodings');
    await contents.executeJavaScript(`(async()=>{${setup}
      const count=state.textureAssets.length,bytes=Uint8Array.from(atob(${JSON.stringify(pngData)}),c=>c.charCodeAt(0));
      const file=new File([bytes],'imported.png',{type:'image/png'}),transfer=new DataTransfer();transfer.items.add(file);
      $('#textureInput').files=transfer.files;$('#textureInput').dispatchEvent(new Event('change',{bubbles:true}));
      await until(()=>state.textureAssets.length===count+1,'PNG import');const asset=state.textureAssets.at(-1);
      await until(()=>asset.externalFile?.fingerprint,'PNG clean baseline');
      const icon=()=>document.querySelector('[data-save-texture="'+asset._uid+'"]');check(icon().hidden,'unchanged PNG has no save indicator');
      $('.mode-tab[data-mode="paint"]').click();await until(()=>$('[data-add-layer]'),'layer controls');$('[data-add-layer]').click();
      await until(()=>!icon().hidden,'edited layer state has save indicator');
    })()`);
    check(true, 'direct PNG import is clean; actual layer edits reveal the save icon');
    const unexpected = errors.filter(message => !message.includes('Java 文件已被修改'));
    check(unexpected.length === 0, 'application workflow has no unexpected renderer errors');
    report = { ok: true, archived: Boolean(archive), checks };
  } catch (error) { report = { ok: false, error: error.stack, errors, picks }; }
  fs.mkdirSync(path.resolve('build/performance'), { recursive: true });
  fs.writeFileSync(path.resolve('build/performance/native-files.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(report.ok ? 0 : 1);
});
