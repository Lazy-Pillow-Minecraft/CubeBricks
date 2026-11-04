export function bindProjectHistoryProgress() {
  const status = document.getElementById('projectHistoryProgress');
  const label = status?.querySelector('span');
  const bar = status?.querySelector('progress');
  if (!status || !bar) return;
  const pending = new Map();
  const failures = new Map();
  window.cubeBricksDesktop?.onProjectHistoryProgress?.(progress => {
    if (progress.error) {
      pending.delete(progress.journalId);
      failures.set(progress.journalId, progress.error);
      console.warn('歷史記錄讀取失敗', progress.error);
    } else {
      failures.delete(progress.journalId);
      if (progress.value >= 1) pending.delete(progress.journalId);
      else pending.set(progress.journalId, progress);
    }
    status.hidden = pending.size === 0 && failures.size === 0;
    bar.hidden = pending.size === 0;
    status.title = [...failures.values()].join('\n');
    if (!pending.size) { if (failures.size) label.textContent = '歷史記錄讀取失敗'; return; }
    const total = [...pending.values()].reduce((sum,item)=>sum+(item.total||1),0);
    const completed = [...pending.values()].reduce((sum,item)=>sum+(item.completed||0),0);
    bar.value = completed / total;
    label.textContent = `正在讀取歷史記錄 ${Math.floor(bar.value*100)}%`;
  });
}
