// Both file opening and workspace recovery use the same delayed, themed view.
export function beginProjectOpenProgress({ waitForProgress = false } = {}) {
  const dialog = document.getElementById('projectOpenProgressDialog');
  const bar = document.getElementById('projectOpenProgressBar');
  const status = document.getElementById('projectOpenProgressStatus');
  const percent = document.getElementById('projectOpenProgressPercent');
  if (bar) bar.value = 0;
  if (status) status.textContent = '正在載入項目…';
  if (percent) percent.textContent = '0%';
  if (dialog) dialog.oncancel = event => event.preventDefault();
  let timer = null;
  const start = () => { if (timer === null) timer = setTimeout(() => { if (dialog && !dialog.open) dialog.showModal(); }, 500); };
  if (!waitForProgress) start();
  const unsubscribe = window.cubeBricksDesktop?.onProjectOpenProgress?.(({ value, label }) => {
    start();
    const fraction = Math.max(0, Math.min(1, Number(value) || 0));
    if (bar) bar.value = fraction;
    if (status) status.textContent = label || '正在載入項目…';
    if (percent) percent.textContent = `${Math.round(fraction * 100)}%`;
  });
  return {
    finish() {
      clearTimeout(timer);
      unsubscribe?.();
      if (dialog?.open) dialog.close();
    }
  };
}
