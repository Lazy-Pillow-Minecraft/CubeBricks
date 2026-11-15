export function createLayerPointsDialog({ $, onGenerate }) {
  const dialog = $('#layerPointsDialog');
  const form = $('#layerPointsForm');
  const size = $('#layerPointSize');
  const gap = $('#layerPointGap');
  const symmetry = $('#layerPointsSymmetry');
  const status = $('#layerPointsStatus');
  const targetLabel = $('#layerPointsTarget');
  const swatch = $('#layerPointsSwatch');
  const generate = $('#layerPointsGenerate');
  const cancel = $('#layerPointsCancel');
  let target = null, busy = false;

  function open({ uid, name, color }) {
    if (busy) return;
    target = { uid, color };
    targetLabel.textContent = name;
    swatch.style.backgroundColor = color;
    status.textContent = '最小間隔按兩個圓點的邊緣計算；保留圖層原有像素。';
    if (!dialog.open) dialog.showModal();
    size.focus();
  }

  function setBusy(value) {
    busy = value;
    size.disabled = gap.disabled = symmetry.disabled = generate.disabled = cancel.disabled = value;
    generate.textContent = value ? '生成中…' : '生成';
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !target) return;
    const diameter = Number(size.value), spacing = Number(gap.value);
    if (!Number.isInteger(diameter) || diameter < 1 || diameter > 256
      || !Number.isInteger(spacing) || spacing < 0 || spacing > 4096) {
      status.textContent = '點尺寸須為 1–256 px；最小間隔須為 0–4096 px。';
      return;
    }
    setBusy(true);
    try {
      const count = await onGenerate({ ...target, diameter, gap: spacing, symmetry: symmetry.checked }, message => {
        status.textContent = message;
      });
      if (count === false) throw new Error('目標圖層已改變，請重新打開');
      dialog.close();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { target = null; });
  return { open };
}
