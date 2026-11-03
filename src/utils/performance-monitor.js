// Optional CPU timings for interactive bottlenecks. Disabled by default and
// bounded so profiling a long paint session does not retain every frame.
const samples = new Map();
const totals = new Map();
const SAMPLE_LIMIT = 600;
const slowEvents = [];
const SLOW_EVENT_LIMIT = 512;
let capturePromise = null;

export const performanceMonitor = {
  enabled: false,
  session: 0,
  mark(name) {
    if (!this.enabled) return;
    slowEvents.push({ at: Number(performance.now().toFixed(1)), name });
    if (slowEvents.length > SLOW_EVENT_LIMIT) slowEvents.shift();
  },
  record(name, milliseconds) {
    if (!this.enabled || !Number.isFinite(milliseconds)) return;
    let values = samples.get(name);
    if (!values) { values = []; samples.set(name, values); }
    let total = totals.get(name);
    if (!total) { total = { count: 0, max: 0, over40ms: 0 }; totals.set(name, total); }
    total.count++; total.max = Math.max(total.max, milliseconds);
    if (milliseconds >= 40) total.over40ms++;
    values.push(milliseconds);
    if (values.length > SAMPLE_LIMIT) values.shift();
    if (milliseconds >= (name.endsWith('Interval') || name === 'scheduler.sceneQueue' ? 40 : 20)) {
      slowEvents.push({ at: Number(performance.now().toFixed(1)), name,
        ms: Number(milliseconds.toFixed(1)) });
      if (slowEvents.length > SLOW_EVENT_LIMIT) slowEvents.shift();
    }
  },
  reset() { samples.clear(); totals.clear(); slowEvents.length = 0; },
  summary() {
    const result = {};
    for (const [name, values] of samples) {
      const sorted = [...values].sort((a, b) => a - b);
      const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
      result[name] = { count: sorted.length,
        totalCount: totals.get(name).count, max: Number(totals.get(name).max.toFixed(2)),
        over40ms: totals.get(name).over40ms,
        p50: Number(percentile(.5).toFixed(2)),
        p95: Number(percentile(.95).toFixed(2)),
        p99: Number(percentile(.99).toFixed(2)) };
    }
    return result;
  },
  // A short capture is more useful than a lifetime average for regular
  // half-second hitches. Long tasks and camera frame gaps identify work that
  // occurs between renderScene calls, outside its per-stage CPU timings.
  capture(duration = 8000) {
    if (capturePromise) return capturePromise;
    const captureDuration = Math.max(1000, Math.min(30000, Number(duration) || 8000));
    this.reset();
    this.session++;
    this.enabled = true;
    const desktop = typeof window !== 'undefined' ? window.cubeBricksDesktop : null;
    const mainStart = desktop?.beginMainPerfCapture?.().catch(() => null);
    let observer = null;
    let animationFrame = null;
    let previousAnimationFrame = 0;
    let previousCallback = 0;
    let previousHeapSize = 0;
    if (typeof requestAnimationFrame === 'function') {
      const heartbeat = now => {
        const callbackTime = performance.now();
        if (previousCallback) this.record('scheduler.rafCallbackInterval', callbackTime - previousCallback);
        this.record('scheduler.rafLag', Math.max(0, callbackTime - now));
        previousCallback = callbackTime;
        const heapSize = performance.memory?.usedJSHeapSize || 0;
        if (previousAnimationFrame) {
          const interval = now - previousAnimationFrame;
          this.record('scheduler.rafInterval', interval);
          if (interval >= 40 && previousHeapSize && heapSize) {
            slowEvents.push({ at: Number(now.toFixed(1)), name: 'scheduler.heapAcrossGap',
              beforeMb: Number((previousHeapSize / 1048576).toFixed(1)),
              afterMb: Number((heapSize / 1048576).toFixed(1)) });
            if (slowEvents.length > SLOW_EVENT_LIMIT) slowEvents.shift();
          }
        }
        previousAnimationFrame = now;
        previousHeapSize = heapSize;
        animationFrame = requestAnimationFrame(heartbeat);
      };
      animationFrame = requestAnimationFrame(heartbeat);
    }
    try {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          slowEvents.push({ at: Number(entry.startTime.toFixed(1)), name: 'renderer.longTask',
            ms: Number(entry.duration.toFixed(1)) });
          if (slowEvents.length > SLOW_EVENT_LIMIT) slowEvents.shift();
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch { observer?.disconnect(); observer = null; }
    capturePromise = new Promise(resolve => setTimeout(async () => {
      if (animationFrame !== null && typeof cancelAnimationFrame === 'function')
        cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      this.enabled = false;
      let mainProcess = null;
      try {
        if (mainStart) {
          await mainStart;
          mainProcess = await desktop.endMainPerfCapture();
        }
      } catch { /* Browser-only preview or a closing desktop process. */ }
      const report = { duration: captureDuration, summary: this.summary(), slowEvents: [...slowEvents],
        rendererTimeOrigin: performance.timeOrigin, mainProcess };
      capturePromise = null;
      resolve(report);
    }, captureDuration));
    return capturePromise;
  }
};

if (typeof window !== 'undefined') window.cubeBricksPerf = performanceMonitor;
