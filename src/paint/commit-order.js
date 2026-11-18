// Only unfinished pixel work belongs here. Durable journal writes must never
// hold the next brush gesture or a visual undo.
const pending = new WeakMap();
const latest = new WeakMap();
const failures = new WeakMap();
export function beginPaintGesture(project) {
  const token = {};
  latest.set(project, token);
  return token;
}
export function isLatestPaintGesture(project, token) { return latest.get(project) === token; }
export function pendingPaintCommit(project) { return pending.get(project) || null; }
export function consumePaintCommitError(project) {
  const error = failures.get(project) || null;
  failures.delete(project);
  return error;
}
export function trackPaintCommit(project, work) {
  const done = Promise.resolve(work);
  // Other gestures wait for settlement, while callers of this function can
  // still observe a rejected commit. Never strand the next brush stroke.
  const settled = done.then(() => { failures.delete(project); }, error => {
    failures.set(project, error);
    console.error('Paint commit failed', error);
  });
  pending.set(project, settled);
  void settled.then(() => { if (pending.get(project) === settled) pending.delete(project); });
  return done;
}
