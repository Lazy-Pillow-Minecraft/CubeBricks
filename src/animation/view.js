import { ANIMATION_CHANNELS, keyedChannel, lastAnimationFrame } from './model.js';
import { animationOutlinerRows } from '../screen/outliner/animation-tree.js';
import { createAnimationTimeline } from './timeline-view.js';
import { selectedAnimationKeys } from './selection.js';

export function createAnimationView({ state, $, activeClip, escapeHtml }) {
  let lastProject, lastStructure = '', lastProperties = '', lastPropertyLayout = '', lastHighlight = '';
  const timeline = createAnimationTimeline({ state, $, escapeHtml });
  function groupProperties(group) {
    const rows = ANIMATION_CHANNELS.map(channel => {
      const inputs = [0, 1, 2].map(axis => `<label class="axis-${'xyz'[axis]}"><span>${'XYZ'[axis]}</span><input type="number" step="${channel === 'scale' ? '.01' : channel === 'rotation' ? '1' : '.1'}" placeholder="-" data-animation-channel="${channel}" data-group-uid="${group.uid}" data-axis="${axis}" /></label>`).join('');
      return `<div class="animation-vector-row"><span>ui.animation-${channel}</span><div class="axis-inputs">${inputs}</div><button type="button" data-animation-add-key="${channel}" data-group-uid="${group.uid}" title="ui.animation-add-key">＋</button></div>`;
    }).join('');
    return `<section class="animation-group-properties"><strong>${escapeHtml(group.name)}</strong>${rows}</section>`;
  }
  function refresh(revision = 0, structureRevision = revision) {
    if (state.mode !== 'animate') return;
    const clip = activeClip(), keys = selectedAnimationKeys(state, clip);
    const selected = keys.length ? [...new Set(keys.map(key => key.uid))]
      : [...state.selectedUids].filter(uid => state.project.getNode(uid)?.type === 'group');
    const keySelection = keys.map(key => `${key.uid}:${key.frame}`).join(',');
    if (lastProject !== state.project) { lastProject = state.project; lastStructure = ''; lastProperties = ''; lastPropertyLayout = ''; }
    const structure = `${clip?.uid}:${structureRevision}:${state.project.hierarchyRevision}`;
    if (structure !== lastStructure) {
      lastStructure = structure;
      lastHighlight = '';
      $('#animationList').innerHTML = state.project.animations.map(animation => `<div class="animation-list-row${animation === clip ? ' active' : ''}"><button type="button" data-animation-select="${animation.uid}">${escapeHtml(animation.name)}</button><button type="button" data-animation-remove="${animation.uid}" title="ui.animation-delete">×</button></div>`).join('');
      $('#animationSettings').innerHTML = clip ? `<label><span>ui.animation-name</span><input data-animation-info="name" value="${escapeHtml(clip.name)}" /></label><label><span>ui.animation-fps</span><input type="number" min="1" max="120" step="1" data-animation-info="fps" value="${clip.fps}" /></label><label><span>ui.animation-length</span><input type="number" min="${lastAnimationFrame(clip)}" step="any" data-animation-info="length" value="${clip.length}" /></label><label><span>ui.animation-loop-mode</span><select data-animation-info="loop">${['once', 'hold', 'loop'].map(mode => `<option value="${mode}"${(clip.loop || 'loop') === mode ? ' selected' : ''}>ui.animation-loop-${mode}</option>`).join('')}</select></label>${clip.native?.hasDynamic ? '<p class="animation-empty">ui.animation-preserved-content</p>' : ''}` : '<p class="animation-empty">ui.animation-empty</p>';
      const groups = animationOutlinerRows(state.project, new Set(), '', 32, 0).filter(row => row.node);
      timeline.render(clip, groups);
    }
    const frame = keys.length === 1 ? keys[0].frame : state.timelineFrame;
    const propertyKey = `${structure}:${revision}:${keySelection}:${selected.join(',')}:${frame}`;
    const propertyLayout = `${clip?.uid}:${keys.length > 1}:${selected.map(uid => `${uid}:${state.project.getNode(uid).name}`).join(',')}`;
    const properties = $('#animationFrameProperties');
    if (propertyKey !== lastProperties || propertyLayout !== lastPropertyLayout) {
      lastProperties = propertyKey;
      if (propertyLayout !== lastPropertyLayout && !properties.contains(document.activeElement)) {
        lastPropertyLayout = propertyLayout;
        properties.innerHTML = keys.length > 1 ? '' : !clip ? '<p class="animation-empty">ui.animation-empty</p>' : !selected.length ? '<p class="animation-empty">ui.animation-select-group</p>' : selected.map(uid => groupProperties(state.project.getNode(uid))).join('');
      }
      for (const input of properties.querySelectorAll('[data-animation-channel]')) {
        if (input === document.activeElement) continue;
        input.dataset.animationFrame = String(frame);
        const value = keys.length === 1 ? keyedChannel(clip, input.dataset.groupUid, input.dataset.animationChannel, frame)?.[Number(input.dataset.axis)] : undefined;
        input.type = typeof value === 'string' ? 'text' : 'number';
        input.readOnly = typeof value === 'string';
        input.title = typeof value === 'string' ? value : '';
        input.value = value === undefined ? '' : typeof value === 'string' ? value : String(Number(value.toFixed(5)));
      }
      for (const button of properties.querySelectorAll('[data-animation-add-key]')) button.dataset.animationFrame = String(frame);
    }
    timeline.refresh();
    const unbound = $('#animationSettings .animation-unbound');
    if (clip?.native?.unboundNames?.length && !unbound) {
      const note = document.createElement('p'); note.className = 'animation-empty animation-unbound';
      note.textContent = 'ui.animation-unbound-bones'; note.title = clip.native.unboundNames.join(', ');
      $('#animationSettings').append(note);
    }
    $('#animationFrameLabel').textContent = String(Math.floor(state.timelineFrame));
    $('#animationPlay').dataset.playing = String(state.timelinePlaying);
    $('#animationPlay').setAttribute('aria-pressed', String(state.timelinePlaying));
    $('#animationExport').disabled = !state.project.animations.length;
    for (const button of document.querySelectorAll('[data-animation-transport]')) button.disabled = !clip;
    const highlight = `${keySelection}:${[...state.selectedUids].join(',')}`;
    if (highlight !== lastHighlight) {
      lastHighlight = highlight;
      for (const label of $('#animationTimeline').querySelectorAll('[data-animation-bone]')) label.classList.toggle('active', state.selectedUids.has(label.dataset.animationBone));
      for (const key of $('#animationTimeline').querySelectorAll('[data-animation-key]')) key.classList.toggle('active', keys.some(selected => selected.uid === key.dataset.groupUid && selected.frame === Number(key.dataset.animationKey)));
    }
  }
  return { refresh, timeline };
}
