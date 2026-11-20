import { CubeBricksProject, exportBlockbench } from '../model.js';
import { constrainProject } from '../common/core/format-constraints.js';
import { modelFormatRegistry } from '../common/config/model-formats.js';
import { bedrockBoneNames } from '../model/formats/bedrock-bones.js';
import { importBedrockAnimations, exportBedrockAnimations } from './bedrock.js';
import { showAppChoice } from '../screen/prompt-dialog.js';

function exportedNames(project) {
  const snapshot = JSON.parse(JSON.stringify(project));
  snapshot.elements = snapshot.elements.filter(element => !element.subdivisionOwnerUid);
  const model = new CubeBricksProject(snapshot);
  constrainProject(model);
  return bedrockBoneNames(exportBlockbench(model)).names;
}

export function createAnimationAssets({ state, $, activeClip, onImported, toast }) {
  function requireModel() {
    if (state.projectHomeActive || !state.project.groups.length
      || !modelFormatRegistry.resolve(state.project.formatId)?.capabilities.animation) throw Error('ui.animation-requires-model');
  }
  function importDocuments(documents) {
    requireModel();
    const names = exportedNames(state.project);
    const clips = documents.flatMap(data => importBedrockAnimations(data, state.project, names));
    if (!clips.length) throw Error('ui.animation-invalid-file');
    const used = new Set(state.project.animations.map(clip => clip.name));
    for (const clip of clips) {
      const base = clip.name; let suffix = 2;
      while (used.has(clip.name)) clip.name = `${base}${suffix++}`;
      used.add(clip.name);
    }
    onImported(clips); toast('ui.animation-imported');
    return clips;
  }
  function report(error, fallback) { toast(String(error.message).startsWith('ui.') ? error.message : fallback); }
  async function exportAnimations() {
    try {
      requireModel();
      const project = state.project;
      if (!project.animations.length) return;
      let clips = [activeClip() || project.animations[0]];
      if (project.animations.length > 1) {
        const choice = await showAppChoice({ title: 'ui.animation-export', message: 'ui.animation-export-scope',
          buttons: ['ui.animation-export-current', 'ui.animation-export-all', 'ui.cancel'], cancelIndex: 2 });
        if (choice.index === 2 || state.project !== project) return;
        if (choice.index === 1) clips = project.animations;
      }
      const content = JSON.stringify(exportBedrockAnimations(clips, exportedNames(project), project.name), null, 2);
      const name = `${String(project.name || 'model').replace(/[\\/:*?"<>|]/g, '_')}.animation`;
      if (window.cubeBricksDesktop?.exportProject) {
        if (!await window.cubeBricksDesktop.exportProject({ name, extension: 'json', modelContent: content, assetType: 'animation' })) return;
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `${name}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toast('ui.animation-exported');
    } catch (error) { report(error, 'ui.animation-export-failed'); }
  }
  const input = $('#animationImportInput');
  $('#animationImport').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const project = state.project, files = [...input.files]; input.value = '';
    try {
      const documents = [];
      for (const file of files) {
        if (file.size > 64 * 1024 * 1024) throw Error('ui.animation-file-too-large');
        documents.push(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
      }
      if (state.project === project && files.length) importDocuments(documents);
    } catch (error) { report(error, 'ui.animation-import-failed'); }
  });
  $('#animationExport').addEventListener('click', exportAnimations);
  return { importDocument: data => importDocuments([data]), exportAnimations };
}
