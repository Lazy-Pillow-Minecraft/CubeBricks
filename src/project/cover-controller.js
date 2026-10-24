// Covers are a disposable application cache. They never enter cbmodel data or
// the journal, and always use the default camera rather than the edit camera.
export function createProjectCoverController({ projectTabsController, captureProjectCover }) {
  const timers = new Map();
  const revisions = new Map();
  const writes = new Map();

  function update(tab, revision) {
    if (!tab?.journalId || tab.id !== projectTabsController.activeId
      || !window.cubeBricksDesktop?.saveProjectCover) return;
    let dataUrl;
    try { dataUrl = captureProjectCover(); }
    catch (error) { console.warn('項目封面渲染失敗', error); return; }
    const previous = writes.get(tab.journalId) || Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      await tab.journalReady;
      if (revisions.get(tab.id) !== revision) return;
      await window.cubeBricksDesktop.saveProjectCover({ journalId: tab.journalId, dataUrl });
      window.dispatchEvent(new Event('cubebricks:project-cover-updated'));
    });
    writes.set(tab.journalId, write);
    write.catch(error => console.warn('項目封面保存失敗', error));
    return write;
  }

  function schedule(tab, delay = 1800) {
    if (!tab?.journalId) return;
    clearTimeout(timers.get(tab.id));
    const revision = (revisions.get(tab.id) || 0) + 1;
    revisions.set(tab.id, revision);
    timers.set(tab.id, setTimeout(() => {
      timers.delete(tab.id);
      update(tab, revision);
    }, delay));
  }

  function flush(tab) {
    if (!tab?.journalId) return;
    clearTimeout(timers.get(tab.id));
    timers.delete(tab.id);
    const revision = (revisions.get(tab.id) || 0) + 1;
    revisions.set(tab.id, revision);
    return update(tab, revision);
  }

  return { schedule, flush };
}
