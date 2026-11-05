import { captureExportTexture, bakeCanvas } from './export-raster.js';
import { textureSaveFingerprint, createTextureSaveIndicators } from './save-state.js';

export function textureAnimationMetadata(texture) {
  if (!Number.isFinite(texture.frame_time)) return null;
  const width = texture.width, height = Math.round(width * texture.uv_height / texture.uv_width);
  const animation = { frametime: Math.max(1, Math.round(texture.frame_time)), width, height,
    interpolate: texture.frame_interpolate === true };
  if (texture.frame_order_type === 'custom') animation.frames = texture.frame_order.split(/\s+/).filter(Boolean).map(value => {
    const [index, time] = value.split(':').map(Number); return { index, time: Math.max(1, Math.round(time || animation.frametime)) };
  });
  return { animation };
}

export async function standaloneTextureImage(asset) {
  const snapshot = structuredClone(asset), captured = await captureExportTexture(snapshot);
  const animation = snapshot.animation?.enabled && snapshot.animation.frames?.length;
  const count = animation ? snapshot.animation.frames.length : 1;
  const canvas = bakeCanvas(captured.first.width, captured.first.height * count), context = canvas.getContext('2d');
  for (let frame = 0; frame < count; frame++) context.drawImage(captured.frame(frame), 0, frame * captured.first.height);
  const fps = Number(snapshot.animation?.fps) || 20;
  const metadata = animation ? { animation: { width: captured.first.width, height: captured.first.height,
    frametime: Math.max(1, Math.round(20 / fps)), interpolate: snapshot.animation.interpolate === true,
    frames: snapshot.animation.frames.map((frame, index) => ({ index, time: Math.max(1, Math.round((Number(frame.duration) || 1) * 20 / fps)) })) } } : null;
  return { source: canvas.toDataURL('image/png'), metadata, fingerprint: await textureSaveFingerprint(snapshot) };
}

export function createTextureFileController({ state, toast, noteJournalOperation, markDirty }) {
  const indicators = createTextureSaveIndicators({ state });
  const pending = new WeakMap();
  async function saveTexture(asset, options = {}) {
    if (!asset) return false;
    if (pending.has(asset)) return pending.get(asset);
    const operation = performSaveTexture(asset, options); pending.set(asset, operation);
    try { return await operation; } finally { pending.delete(asset); }
  }
  async function performSaveTexture(asset, { saveAs = false } = {}) {
    if (!asset) return false;
    try {
      const projectUuid = state.project?.projectUuid;
      const snapshot = await standaloneTextureImage(asset);
      if (!window.cubeBricksDesktop?.saveTexture) {
        const link = document.createElement('a'); link.href = snapshot.source; link.download = asset.name || 'texture.png'; link.click();
        if (snapshot.metadata) {
          const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot.metadata, null, 2)], { type: 'application/json' }));
          link.href = url; link.download += '.mcmeta'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 500);
        }
        await indicators.markSaved(asset, snapshot.fingerprint, { ownFile: false }); return true;
      }
      const result = await window.cubeBricksDesktop.saveTexture({ name: asset.name, source: snapshot.source,
        metadata: snapshot.metadata, filePath: !saveAs ? asset.externalFile?.path : null, namespace: asset.namespace });
      if (!result) return false;
      if (state.project?.projectUuid === projectUuid) noteJournalOperation('core.texture.save');
      asset.namespace = result.namespace || asset.namespace || '';
      await indicators.markSaved(asset, snapshot.fingerprint, { ...result, projectUuid });
      if (state.project?.projectUuid === projectUuid) markDirty();
      toast('贴图已保存'); return true;
    } catch (error) { toast(`贴图保存失败：${error.message}`); return false; }
  }
  document.getElementById('textureList')?.addEventListener('click', event => {
    const button = event.target.closest('[data-save-texture]'); if (!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void saveTexture(state.textureAssets.find(asset => asset._uid === button.dataset.saveTexture));
  }, true);
  document.getElementById('textureList')?.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-save-texture]')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.getElementById('textureList')?.addEventListener('keydown', event => {
    const button = event.target.closest('[data-save-texture]');
    if (button && ['Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      void saveTexture(state.textureAssets.find(asset => asset._uid === button.dataset.saveTexture));
    }
  }, true);
  return { ...indicators, saveTexture };
}
