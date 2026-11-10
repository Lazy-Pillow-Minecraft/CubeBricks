// Only unfinished pixel work belongs here. Durable journal writes must never
// hold the next brush gesture or a visual undo.
const pending = new WeakMap();
const latest = new WeakMap();
export function beginPaintGesture(project) {
  const token = {};
  latest.set(project, token);
  return token;
}
export function isLatestPaintGesture(project, token) { return latest.get(project) === token; }
export function pendingPaintCommit(project) { return pending.get(project) || null; }
export function trackPaintCommit(project, work) {
  const done = Promise.resolve(work).catch(error => console.error('Paint commit failed', error));
  pending.set(project, done);
  void done.then(() => { if (pending.get(project) === done) pending.delete(project); });
  return done;
}
