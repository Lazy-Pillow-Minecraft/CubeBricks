export function beginTextureExportProgress() {
  const dialog = document.getElementById('textureExportProgressDialog');
  const bar = document.getElementById('textureExportProgressBar');
  const percent = document.getElementById('textureExportProgressPercent');
  let finished = false, lastYield = performance.now();
  const timer = setTimeout(() => { if (!finished && dialog && !dialog.open) dialog.showModal(); }, 500);
  if (dialog) dialog.oncancel = event => event.preventDefault();
  if (bar) bar.value = 0;
  if (percent) percent.textContent = '0%';
  return {
    async progress(value) {
      if (bar) bar.value = value;
      if (percent) percent.textContent = `${Math.round(value * 100)}%`;
      if (performance.now() - lastYield > 16) { await new Promise(resolve => setTimeout(resolve, 0)); lastYield = performance.now(); }
    },
    finish() { finished = true; clearTimeout(timer); if (dialog?.open) dialog.close(); }
  };
}
