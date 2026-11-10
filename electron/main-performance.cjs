const { performance, PerformanceObserver } = require('node:perf_hooks');

let active = null;
const pendingOperations = new Set();
const EVENT_LIMIT = 128;
const currentOperations = () => [...pendingOperations].filter(entry => !entry.name.startsWith('app:perf-'));

function append(events, entry) {
  events.push(entry);
  if (events.length > EVENT_LIMIT) events.shift();
}

function startMainPerformanceCapture() {
  if (active) return { startedAt: active.startedAt };
  const startedAt = performance.timeOrigin + performance.now();
  const capture = {
    startedAt,
    cpuStart: process.cpuUsage(),
    threadCpuStart: process.threadCpuUsage?.(),
    previousTick: performance.now(),
    eventLoopGaps: [],
    gcEvents: [],
    pendingAtStart: currentOperations(),
    operations: [],
    timer: null,
    observer: null
  };
  capture.timer = setInterval(() => {
    const now = performance.now();
    const delay = now - capture.previousTick - 10;
    capture.previousTick = now;
    if (delay >= 30) append(capture.eventLoopGaps, {
      at: Number((performance.timeOrigin + now).toFixed(1)),
      delayMs: Number(delay.toFixed(1))
    });
  }, 10);
  capture.timer.unref?.();
  try {
    capture.observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) append(capture.gcEvents, {
        at: Number((performance.timeOrigin + entry.startTime).toFixed(1)),
        durationMs: Number(entry.duration.toFixed(1)), kind: entry.detail?.kind ?? null
      });
    });
    capture.observer.observe({ entryTypes: ['gc'] });
  } catch {
    capture.observer?.disconnect();
    capture.observer = null;
  }
  active = capture;
  return { startedAt };
}

function stopMainPerformanceCapture() {
  if (!active) return null;
  const capture = active;
  active = null;
  clearInterval(capture.timer);
  capture.observer?.disconnect();
  const cpu = process.cpuUsage(capture.cpuStart);
  const threadCpu = capture.threadCpuStart && process.threadCpuUsage(capture.threadCpuStart);
  return {
    startedAt: capture.startedAt,
    endedAt: performance.timeOrigin + performance.now(),
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(1)),
    threadCpuMs: threadCpu ? Number(((threadCpu.user + threadCpu.system) / 1000).toFixed(1)) : null,
    eventLoopGaps: capture.eventLoopGaps,
    gcEvents: capture.gcEvents,
    pendingAtStart: capture.pendingAtStart,
    pendingAtEnd: currentOperations(),
    operations: capture.operations
  };
}

function trackMainOperation(name, handler) {
  return function (...args) {
    const operation = { name, startedAt: performance.timeOrigin + performance.now() };
    pendingOperations.add(operation);
    const finish = () => {
      pendingOperations.delete(operation);
      if (active && !name.startsWith('app:perf-')) append(active.operations, {
        ...operation,
        durationMs: Number((performance.timeOrigin + performance.now() - operation.startedAt).toFixed(1))
      });
    };
    try {
      const result = handler.apply(this, args);
      if (result && typeof result.then === 'function') return result.finally(finish);
      finish();
      return result;
    } catch (error) {
      finish();
      throw error;
    }
  };
}

module.exports = { startMainPerformanceCapture, stopMainPerformanceCapture, trackMainOperation, currentOperations };
