// Generate the exact 256px preview for every selectable game texture and for
// the UV-preserving template. Run after prepare-skin-library.mjs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const library = path.join(root, 'src/assets/skin-library');
const catalogPath = path.join(library, 'catalog.json');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-skin-previews-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

function pruneGeneratedPreviews(catalog) {
  const referenced = new Set(catalog.entries.flatMap(record => [
    record.templatePreview, ...record.textures.map(texture => texture.preview)
  ]));
  let removed = 0;
  for (const folder of ['java-26.3', 'bedrock-1.26.63.1']) {
    const previewDir = path.join(library, folder, 'previews');
    for (const file of fs.readdirSync(previewDir)) {
      // Extraction covers have no double hyphen. Only this script's generated
      // images are eligible for cleanup after a binding change.
      if (!/--(?:template|[a-f0-9]{12})\.png$/i.test(file) ||
        referenced.has(`${folder}/previews/${file}`)) continue;
      fs.unlinkSync(path.join(previewDir, file));
      removed++;
    }
  }
  return removed;
}

async function installRenderer({ skinProjectUrl, rendererUrl, captureUrl }) {
  const { createSkinProject } = await import(skinProjectUrl);
  const { WebGLSceneRenderer } = await import(rendererUrl);
  const { opaquePixelBounds } = await import(captureUrl);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const scene = new WebGLSceneRenderer(canvas);
  const centered = document.createElement('canvas');
  centered.width = centered.height = size;
  const context = centered.getContext('2d');
  const atlas = document.createElement('canvas');
  const view = {
    yaw: -135 * Math.PI / 180, pitch: 45 * Math.PI / 180,
    projection: 'orthographic', zoom: 1, target: [0, 0, 0], panX: 0, panY: 0,
    captureWidth: size, captureHeight: size, capturePixelWidth: size, capturePixelHeight: size,
    captureModelOnly: true, grid: false, wire: false, previewShade: true,
    cubeBirthMs: 0, cubeDeathMs: 0, renderMode: 'textured'
  };
  const loadImage = async source => {
    const image = new Image();
    image.src = source;
    await image.decode();
    return image;
  };

  window.renderSkinPreviewJobs = async ({ record, sourceModel, jobs }) => {
    const output = [];
    for (const job of jobs) {
      const { project, textureAssets } = createSkinProject(record, sourceModel, {
        textureMode: job.template ? 'template' : 'game',
        gameTexture: job.template ? null : { id: job.id, source: job.source }
      });
      const images = await Promise.all(textureAssets.map(asset => loadImage(asset.source)));
      if (images.length === 1) scene.setTexture(images[0]);
      else {
        atlas.width = images.reduce((sum, image) => sum + image.width + 2, 0);
        atlas.height = Math.max(...images.map(image => image.height + 2));
        const atlasContext = atlas.getContext('2d');
        let x = 1;
        const entries = images.map((image, index) => {
          const asset = textureAssets[index];
          atlasContext.drawImage(image, x, 1);
          const entry = {
            uid: asset.uuid, references: [asset.uuid, String(asset.id), String(index)], default: index === 0,
            x, y: 1, width: image.width, height: image.height,
            uvWidth: asset.uvWidth, uvHeight: asset.uvHeight
          };
          x += image.width + 2;
          return entry;
        });
        scene.setTextureAtlas(atlas, entries);
      }
      scene.render(project, null, view);
      const fitted = scene.fitCameraToVisibleModel(project, view, 1, 1.13);
      if (fitted) scene.render(project, null, fitted);
      let rendered = scene.captureImageCanvas();
      let bounds = opaquePixelBounds(rendered);
      if (!bounds && fitted) {
        scene.render(project, null, { ...fitted, renderMode: 'solid' });
        rendered = scene.captureImageCanvas();
        bounds = opaquePixelBounds(rendered);
      }
      context.clearRect(0, 0, size, size);
      if (bounds) context.drawImage(rendered,
        Math.floor((size - bounds.width) / 2) - bounds.x,
        Math.floor((size - bounds.height) / 2) - bounds.y);
      output.push({ id: job.id, template: job.template, image: centered.toDataURL('image/png'),
        visible: Boolean(bounds) });
    }
    return output;
  };
}

async function run() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath));
  const page = path.join(profile, 'preview.html');
  fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>Skin preview renderer</title>');
  const window = new BrowserWindow({ show: false, width: 256, height: 256,
    webPreferences: { backgroundThrottling: false } });
  await window.loadFile(page);
  const url = file => pathToFileURL(path.join(root, 'src', file)).href;
  await window.webContents.executeJavaScript('(' + installRenderer + ')(' + JSON.stringify({
    skinProjectUrl: url('project/skin-project.js'), rendererUrl: url('render/webgl-renderer.js'),
    captureUrl: url('render/model-capture.js')
  }) + ')');
  let completed = 0, renderedCount = 0;
  const limit = Number(process.argv.find(arg => arg.startsWith('--limit='))?.slice(8)) || catalog.entries.length;
  for (const record of catalog.entries.slice(0, limit)) {
    const folder = record.model.split('/')[0];
    const stem = path.basename(record.model, '.bbmodel');
    const previewDir = path.join(library, folder, 'previews');
    fs.mkdirSync(previewDir, { recursive: true });
    const templatePreview = `${folder}/previews/${stem}--template.png`;
    record.templatePreview = templatePreview;
    const jobs = [];
    if (!fs.existsSync(path.join(library, templatePreview)))
      jobs.push({ id: 'template', template: true, path: templatePreview });
    for (const texture of record.textures) {
      const hash = crypto.createHash('sha256').update(texture.id).digest('hex').slice(0, 12);
      const preview = `${folder}/previews/${stem}--${hash}.png`;
      texture.preview = preview;
      // A shared geometry can change its overlay visibility with the chosen
      // entity, so reuse of an older image with the same model/texture name is
      // unsafe when its conditional-layer rules change.
      if (!record.conditionalLayers?.length && fs.existsSync(path.join(library, preview))) continue;
      const bytes = fs.readFileSync(path.join(library, texture.file));
      jobs.push({ id: texture.id, template: false, path: preview,
        source: `data:image/png;base64,${bytes.toString('base64')}` });
    }
    if (jobs.length) {
      const sourceModel = JSON.parse(fs.readFileSync(path.join(library, record.model)));
      for (let start = 0; start < jobs.length; start += 8) {
        const batch = jobs.slice(start, start + 8);
        const rendered = await window.webContents.executeJavaScript('window.renderSkinPreviewJobs(' + JSON.stringify({
          record, sourceModel, jobs: batch
        }) + ')');
        for (let index = 0; index < rendered.length; index++) {
          const { image } = rendered[index];
          fs.writeFileSync(path.join(library, batch[index].path), Buffer.from(image.split(',')[1], 'base64'));
          renderedCount++;
        }
      }
    }
    completed++;
    if (completed % 10 === 0 || completed === limit)
      console.log(`${completed}/${limit} models; ${renderedCount} new previews`);
  }
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Removed ${pruneGeneratedPreviews(catalog)} obsolete generated previews.`);
  window.destroy();
}

app.whenReady().then(async () => {
  try { await run(); app.exit(0); }
  catch (error) { console.error(error.stack); app.exit(1); }
}).finally(() => {
  try { fs.rmSync(profile, { recursive: true, force: true }); }
  catch { /* Chromium may still hold its profile until the process exits. */ }
});
