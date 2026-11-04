const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-export-bake-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.on('browser-window-created', (_event, win) => { win.hide(); win.webContents.setBackgroundThrottling(false); });
const packaged = process.argv.includes('--packaged');
const applicationRoot = packaged ? path.resolve('dist/win-unpacked/resources/app.asar') : path.resolve('.');
require(path.join(applicationRoot, 'electron/main.cjs'));
app.whenReady().then(async () => {
  let report;
  try {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    if (contents.isLoading()) await new Promise(resolve => contents.once('did-finish-load', resolve));
    const verification = fs.readFileSync(path.resolve('scripts/verify-export-bake.mjs'), 'utf8')
      .replace(/import \{([^}]+)\} from '\.\.\/src\/([^']+)';/g, "const {$1} = await import('./$2');")
      .replace('export async function verifyExportBake', 'async function verifyExportBake');
    const checks = await contents.executeJavaScript(`(async()=>{
      for(let n=0;document.querySelector('#startupCover')&&n<200;n++)await new Promise(r=>setTimeout(r,30));
      if(document.querySelector('#startupCover'))throw Error('Startup did not finish');
      ${verification}
      return verifyExportBake();
    })()`);
    report = { ok: true, packaged, version: require(path.join(applicationRoot, 'package.json')).version, checks };
  } catch (error) { report = { ok: false, error: error.stack }; }
  fs.mkdirSync(path.resolve('build/performance'), { recursive: true });
  fs.writeFileSync(path.resolve(`build/performance/export-bake${packaged ? '-packaged' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(report.ok ? 0 : 1);
});
