import { ANIMATION_CHANNELS } from './model.js';

const LABEL_WIDTH = 180;
const LEAD_IN = 24;

// The end frame controls playback, not the size of the editing canvas. Grow
// the canvas while scrolling and keep only visible ruler numbers in the DOM.
export function createAnimationTimeline({ state, $, escapeHtml }) {
  const viewport = $('#animationTimeline');
  let content, ruler, ticks, clip, endPreview = null, trackWidth = 0, lastTicks = '', frameWidth = 18;
  const visibleWidth = () => Math.max(1, viewport.clientWidth - LABEL_WIDTH);
  const tickStep = () => Math.max(1, 2 ** Math.ceil(Math.log2(56 / frameWidth)));

  function extend(required = 0) {
    if (!content || !viewport.clientWidth) return;
    const width = visibleWidth(), tickWidth = frameWidth * tickStep();
    if (LEAD_IN + required + frameWidth < trackWidth && viewport.scrollLeft + width + tickWidth < trackWidth) return;
    trackWidth = Math.ceil(Math.max(720, trackWidth, LEAD_IN + required + width, viewport.scrollLeft + width * 2) / tickWidth) * tickWidth;
    content.style.setProperty('--animation-track-width', `${trackWidth}px`);
  }

  function updateRuler() {
    if (!ticks) return;
    const step = tickStep(), tickWidth = frameWidth * step;
    const first = Math.max(0, Math.floor((viewport.scrollLeft - LEAD_IN) / tickWidth) - 1);
    const last = Math.min(Math.ceil((trackWidth - LEAD_IN) / tickWidth), Math.ceil((viewport.scrollLeft + visibleWidth() - LEAD_IN) / tickWidth) + 1);
    const signature = `${first}:${last}:${frameWidth}`;
    if (signature === lastTicks) return;
    lastTicks = signature;
    ticks.innerHTML = Array.from({ length: last - first + 1 }, (_, offset) => {
      const tick = first + offset;
      // Draw the visible ticks individually. Rounding each position avoids
      // fractional repeating-gradient bands when the canvas is highly zoomed.
      const minor = [1, 2, 3].map(part => `<i aria-hidden="true" style="left:${Math.round(LEAD_IN + (tick + part / 4) * tickWidth)}px"></i>`).join('');
      return `<span style="left:${Math.round(LEAD_IN + tick * tickWidth)}px">${tick * step}</span>${minor}`;
    }).join('');
  }

  function refresh() {
    extend(state.timelineFrame * frameWidth);
    viewport.style.setProperty('--animation-time-origin', `${LEAD_IN}px`);
    viewport.style.setProperty('--animation-frame-width', `${frameWidth}px`);
    viewport.style.setProperty('--animation-playhead', `${LEAD_IN + state.timelineFrame * frameWidth}px`);
    if (ruler) {
      ruler.style.setProperty('--animation-end', `${LEAD_IN + (endPreview ?? clip?.length ?? 0) * frameWidth}px`);
      ruler.classList.toggle('has-animation', Boolean(clip));
    }
    updateRuler();
  }

  function render(animation, groups) {
    clip = animation;
    const rows = groups.map(({ node }) => ({ node, frames: [...new Set(ANIMATION_CHANNELS.flatMap(channel =>
      clip?.tracks[node.uid]?.[channel]?.map(key => key.frame) || []))].sort((a, b) => a - b) }));
    const lastKey = rows.reduce((frame, row) => Math.max(frame, row.frames.at(-1) || 0), 0);
    trackWidth = Math.max(trackWidth, LEAD_IN + (lastKey + 8) * frameWidth, 720);
    viewport.innerHTML = `<div class="animation-timeline-content" style="--animation-track-width:${trackWidth}px"><div class="animation-bone-column"><div class="animation-bone-label animation-bone-header">ui.animation-groups</div>${rows.map(({ node }) => `<button type="button" class="animation-bone-label" data-animation-bone="${node.uid}">${escapeHtml(node.name)}</button>`).join('')}</div><div class="animation-track-column"><div class="animation-track animation-ruler" data-animation-track data-animation-ruler><div class="animation-ruler-ticks"></div><div class="animation-ruler-after-end"></div><div class="animation-end-marker"></div></div>${rows.map(({ node, frames }) => `<div class="animation-timeline-row animation-track" data-animation-bone-row="${node.uid}" data-animation-track data-group-uid="${node.uid}">${frames.map(frame => `<button type="button" class="animation-key" data-animation-key="${frame}" data-group-uid="${node.uid}" style="--animation-key-frame:${frame}" aria-label="${frame}"></button>`).join('')}</div>`).join('')}<div class="animation-playhead"></div></div></div>`;
    content = viewport.querySelector('.animation-timeline-content');
    ruler = viewport.querySelector('[data-animation-ruler]');
    ticks = ruler.querySelector('.animation-ruler-ticks');
    lastTicks = '';
    refresh();
  }

  const frameAt = clientX => (clientX - viewport.querySelector('.animation-track-column').getBoundingClientRect().left - LEAD_IN) / frameWidth;
  function zoom(delta, clientX) {
    if (!content) return;
    const bounds = viewport.getBoundingClientRect();
    const x = Math.max(0, LEAD_IN - viewport.scrollLeft, Math.min(visibleWidth(), clientX - bounds.left - LABEL_WIDTH));
    const anchor = (viewport.scrollLeft + x - LEAD_IN) / frameWidth;
    const nextWidth = Math.max(3, Math.min(120, frameWidth * Math.exp(-delta * .002)));
    trackWidth = Math.max(720, LEAD_IN + (trackWidth - LEAD_IN) * nextWidth / frameWidth);
    frameWidth = nextWidth;
    content.style.setProperty('--animation-track-width', `${trackWidth}px`);
    viewport.scrollLeft = Math.max(0, LEAD_IN + anchor * frameWidth - x);
    refresh();
  }

  viewport.addEventListener('scroll', refresh, { passive: true });
  const resizeObserver = new ResizeObserver(refresh);
  resizeObserver.observe(viewport);
  return { render, refresh, frameAt, zoom, ensureFrame: frame => extend(frame * frameWidth),
    previewEnd: frame => { endPreview = frame; refresh(); } };
}
