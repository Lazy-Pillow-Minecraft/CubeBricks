export function createTimelineController({ state, $ }) {
let timelineLastTime = 0;
let timelineAnimation = null;
function playTimeline() {
  if (state.timelinePlaying) return;
  state.timelinePlaying = true;
  timelineLastTime = performance.now();
  const playButton = $('[data-action="playTimeline"]');
  if (playButton) playButton.textContent = '❚❚';
  const tick = now => {
    if (!state.timelinePlaying) return;
    state.timelineFrame = (state.timelineFrame + (now - timelineLastTime) / 1000 * 24) % 48;
    timelineLastTime = now;
    updateTimelineUI();
    timelineAnimation = requestAnimationFrame(tick);
  };
  timelineAnimation = requestAnimationFrame(tick);
}

function stopTimeline() {
  state.timelinePlaying = false;
  state.timelineFrame = 0;
  if (timelineAnimation) cancelAnimationFrame(timelineAnimation);
  timelineAnimation = null;
  const playButton = $('[data-action="playTimeline"]');
  if (playButton) playButton.textContent = '▶';
  updateTimelineUI();
}

function updateTimelineUI() {
  const frame = Math.floor(state.timelineFrame);
  const seconds = Math.floor(frame / 24);
  const time = $('#timelineTime');
  const ruler = $('#timelineRuler');
  if (time) time.textContent = `00:00:${String(seconds).padStart(2, '0')}:${String(frame % 24).padStart(2, '0')}`;
  ruler?.style.setProperty('--playhead', `${state.timelineFrame / 48 * 100}%`);
}

return { playTimeline, stopTimeline, updateTimelineUI };
}
