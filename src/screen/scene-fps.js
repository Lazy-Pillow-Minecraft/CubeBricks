const SAMPLE_MS = 1000;

export function bindSceneFps(label) {
  let active = false;
  let request = null;
  let sampleStart = null;
  let frames = 0;

  function sample(timestamp) {
    if (sampleStart === null) sampleStart = timestamp;
    else {
      frames++;
      const elapsed = timestamp - sampleStart;
      if (elapsed >= SAMPLE_MS) {
        const text = `${Math.round(frames * 1000 / elapsed)} FPS`;
        if (label.textContent !== text) label.textContent = text;
        sampleStart = timestamp;
        frames = 0;
      }
    }
    request = requestAnimationFrame(sample);
  }

  function sync() {
    if (active && !document.hidden) {
      if (request === null) request = requestAnimationFrame(sample);
      return;
    }
    if (request !== null) cancelAnimationFrame(request);
    request = sampleStart = null;
    frames = 0;
  }

  document.addEventListener('visibilitychange', sync);
  return projectOpen => {
    active = projectOpen;
    sync();
  };
}
