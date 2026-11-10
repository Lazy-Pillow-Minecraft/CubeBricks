import { createBakedBlockbenchExport } from '../texture/export-bake.js';
import { beginTextureExportProgress } from '../texture/export-progress.js';
import { textureAnimationMetadata } from '../texture/file-controller.js';
import { textureSaveFingerprint } from '../texture/save-state.js';
import { encodeNativeJson } from '../model/formats/native-json.js';
import { exportModdedJava, javaClassName } from '../model/formats/modded-java.js';

export function createNativeExportController({ serializableTextureAssets, textureFileController, download, onSaved }) {
  return async function exportNative(kind, project, originalAssets) {
    const assets = structuredClone(await serializableTextureAssets(originalAssets));
    const fingerprints = await Promise.all(assets.map(textureSaveFingerprint));
    const progress = beginTextureExportProgress();
    let bb;
    try {
      bb = await createBakedBlockbenchExport(project, assets, { progress: progress.progress, forceBoxBake: kind === 'java' });
    }
    finally { progress.finish(); }
    const api = window.cubeBricksDesktop, locations = [];
    // The model picker is deliberately last. Cancellation leaves already saved
    // images intact but never writes a JSON/Java file with missing references.
    for (let index = 0; index < bb.textures.length; index++) {
      const texture = bb.textures[index], metadata = textureAnimationMetadata(texture);
      let location;
      const suggestedPng = String(texture.name || `texture_${index}.png`).replace(/\.png$/i, '').toLowerCase().replace(/[^a-z0-9_.-]/g, '_') + '.png';
      if (api?.saveTexture) location = await api.saveTexture({ name: suggestedPng, source: texture.source, metadata, namespace: assets[index]?.namespace });
      else {
        const name = String(texture.name || `texture_${index}.png`).replace(/\.[^.]+$/, '') + '.png';
        const link = document.createElement('a');
        link.href = texture.source;
        link.download = name;
        link.click();
        if (metadata) download(JSON.stringify(metadata, null, 2), `${name}.mcmeta`, 'application/json');
        location = { filePath: name, resource: `${assets[index]?.namespace || 'minecraft'}:${name.replace(/\.png$/i, '')}` };
      }
      if (!location) return false;
      if (project.formatId === 'java_block_item' && !location.resource.includes(':')) {
        location.resource = `${location.namespace || 'minecraft'}:${location.resource.replace(/^textures\//, '')}`;
      }
      locations.push({ ...location, uvWidth: texture.uv_width, uvHeight: texture.uv_height });
    }
    const suggestedName = kind === 'java' ? javaClassName(project.name) : project.name;
    const picked = api?.exportProject ? await api.exportProject({ name: suggestedName, extension: kind }) : { filePath: `${suggestedName}.${kind}` };
    if (!picked) return false;
    const content = kind === 'java' ? await exportModdedJava(bb, picked.filePath.split(/[\\/]/).at(-1), locations)
      : JSON.stringify(encodeNativeJson(bb, locations, project.formatId, project.formatData), null, 2);
    if (api?.exportProject) await api.exportProject({
      extension: kind, filePath: picked.filePath, modelContent: content,
      formatId: project.formatId, textureLocations: locations
    });
    else download(content, picked.filePath, kind === 'java' ? 'text/x-java-source' : 'application/json');
    if (originalAssets.length) await onSaved?.(project);
    await Promise.all(originalAssets.map(async (asset, index) => {
      const location = locations[bb.textures.length === 1 ? 0 : index];
      await textureFileController?.markSaved(asset, fingerprints[index], { ...location, ownFile: false, projectUuid: project.projectUuid });
    }));
    if (originalAssets.length) await onSaved?.(project, true);
    return true;
  };
}
